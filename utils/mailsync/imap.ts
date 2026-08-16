/**
 * @file imap.ts
 * @description Small IMAP4rev1 client, just large enough for BUD-E's mailbox
 *              based sync: log in, list snapshot mails, fetch one, append a
 *              new one, delete old ones.
 *
 *              Deliberately not a general purpose IMAP library. It parses the
 *              handful of responses we ask for and treats everything else as
 *              opaque.
 */

import {
  b64encode,
  BufferedConn,
  MailProtocolError,
  openConn,
  utf8,
} from "./wire.ts";

export interface ImapConfig {
  host: string;
  port: number;
  /** true = implicit TLS (usually port 993) */
  tls: boolean;
  /** upgrade a plaintext connection via STARTTLS */
  starttls?: boolean;
  user: string;
  pass: string;
  timeoutMs?: number;
}

export interface FetchedHeader {
  uid: number;
  size: number;
  headers: Record<string, string>;
}

interface Response {
  /** untagged lines, with literals replaced by \x00LITn\x00 markers */
  lines: { text: string; literals: Uint8Array[] }[];
  /** the tagged completion line */
  status: "OK" | "NO" | "BAD";
  statusText: string;
}

const DEFAULT_TIMEOUT_MS = 45_000;

export class ImapClient {
  #conn: BufferedConn;
  #tag = 0;
  #capabilities = new Set<string>();
  #config: ImapConfig;
  #selected: string | null = null;

  private constructor(conn: BufferedConn, config: ImapConfig) {
    this.#conn = conn;
    this.#config = config;
  }

  static async connect(config: ImapConfig): Promise<ImapClient> {
    const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const useStartTls = !config.tls && !!config.starttls;
    const raw = useStartTls
      ? await Deno.connect({ hostname: config.host, port: config.port })
      : await openConn(config.host, config.port, config.tls);
    const conn = new BufferedConn(raw, timeout);
    const client = new ImapClient(conn, config);

    const greeting = await conn.readLine();
    if (!/^\*\s+(OK|PREAUTH)/i.test(greeting)) {
      conn.close();
      throw new MailProtocolError(`IMAP server refused connection: ${greeting}`);
    }
    client.#absorbCapabilities(greeting);
    if (client.#capabilities.size === 0) await client.#loadCapabilities();

    if (useStartTls) {
      if (!client.#capabilities.has("STARTTLS")) {
        conn.close();
        throw new MailProtocolError(
          "server does not advertise STARTTLS - refusing to send credentials in the clear",
        );
      }
      await client.#mustCommand("STARTTLS");
      const tls = await Deno.startTls(raw as Deno.TcpConn, {
        hostname: config.host,
      });
      conn.replaceConn(tls);
      // Capabilities announced before the handshake are not trustworthy.
      client.#capabilities.clear();
      await client.#loadCapabilities();
    }
    return client;
  }

  get capabilities(): string[] {
    return [...this.#capabilities];
  }

  close() {
    this.#conn.close();
  }

  async logout() {
    try {
      await this.#command("LOGOUT");
    } catch {
      // the server may just drop the connection; nothing to salvage
    }
    this.#conn.close();
  }

  // ---------------------------------------------------------------- protocol

  #absorbCapabilities(line: string) {
    const m = /\[?CAPABILITY\s+([^\]]*)\]?/i.exec(line);
    if (!m) return;
    for (const cap of m[1].trim().split(/\s+/)) {
      if (cap) this.#capabilities.add(cap.toUpperCase());
    }
  }

  async #loadCapabilities() {
    const res = await this.#command("CAPABILITY");
    for (const l of res.lines) this.#absorbCapabilities(l.text);
  }

  /**
   * Reads one logical response line. IMAP literals ({N} at end of line) are
   * pulled out as raw bytes and replaced by a marker so the remaining text
   * stays easy to regex over.
   */
  async #readResponseLine(): Promise<{ text: string; literals: Uint8Array[] }> {
    let text = "";
    const literals: Uint8Array[] = [];
    for (;;) {
      const line = await this.#conn.readLine();
      const m = /\{(\d+)\+?\}$/.exec(line);
      if (!m) return { text: text + line, literals };
      text += line.slice(0, line.length - m[0].length) +
        `\x00LIT${literals.length}\x00`;
      literals.push(await this.#conn.readExactly(Number(m[1])));
    }
  }

  /**
   * Sends a command and collects the response.
   *
   * `literal` turns the call into the two-step literal form: the command line
   * ends with {N}, we wait for the server's "+" continuation, then push the
   * bytes. Used for APPEND.
   */
  async #command(
    command: string,
    literal?: Uint8Array,
  ): Promise<Response> {
    const tag = `A${String(++this.#tag).padStart(4, "0")}`;
    await this.#conn.writeLine(`${tag} ${command}`);

    if (literal) {
      const cont = await this.#conn.readLine();
      if (!cont.startsWith("+")) {
        throw new MailProtocolError(
          `IMAP server rejected literal: ${cont}`,
        );
      }
      await this.#conn.writeBytes(literal);
      await this.#conn.writeLine("");
    }

    const lines: { text: string; literals: Uint8Array[] }[] = [];
    for (;;) {
      const res = await this.#readResponseLine();
      if (res.text.startsWith(`${tag} `)) {
        const m = /^\S+\s+(OK|NO|BAD)\s*(.*)$/i.exec(res.text);
        if (!m) throw new MailProtocolError(`bad IMAP response: ${res.text}`);
        this.#absorbCapabilities(res.text);
        return {
          lines,
          status: m[1].toUpperCase() as "OK" | "NO" | "BAD",
          statusText: m[2],
        };
      }
      if (res.text.startsWith("+")) {
        // Unexpected continuation - unblock the server and keep going.
        await this.#conn.writeLine("");
        continue;
      }
      this.#absorbCapabilities(res.text);
      lines.push(res);
    }
  }

  async #mustCommand(command: string, literal?: Uint8Array): Promise<Response> {
    const res = await this.#command(command, literal);
    if (res.status !== "OK") {
      throw new MailProtocolError(
        `IMAP ${command.split(" ")[0]} failed: ${res.status} ${res.statusText}`,
      );
    }
    return res;
  }

  // ------------------------------------------------------------------ public

  /**
   * Authenticates. Prefers SASL PLAIN because it carries the credentials
   * base64 encoded and therefore side-steps all IMAP string quoting rules;
   * falls back to the LOGIN command.
   */
  async login() {
    const { user, pass } = this.#config;
    if (this.#capabilities.has("AUTH=PLAIN")) {
      const tag = `A${String(++this.#tag).padStart(4, "0")}`;
      await this.#conn.writeLine(`${tag} AUTHENTICATE PLAIN`);
      const cont = await this.#conn.readLine();
      if (cont.startsWith("+")) {
        const payload = new Uint8Array([
          0,
          ...utf8(user),
          0,
          ...utf8(pass),
        ]);
        await this.#conn.writeLine(b64encode(payload));
        for (;;) {
          const res = await this.#readResponseLine();
          if (!res.text.startsWith(`${tag} `)) {
            this.#absorbCapabilities(res.text);
            continue;
          }
          const m = /^\S+\s+(OK|NO|BAD)\s*(.*)$/i.exec(res.text);
          if (m && m[1].toUpperCase() === "OK") {
            this.#absorbCapabilities(res.text);
            return;
          }
          throw new MailProtocolError(
            `IMAP login failed: ${m?.[2] ?? res.text}`,
          );
        }
      }
      // No continuation - fall through to LOGIN below.
    }

    if (/[\r\n]/.test(user) || /[\r\n]/.test(pass)) {
      throw new MailProtocolError("credentials must not contain line breaks");
    }
    const res = await this.#command(`LOGIN ${quoted(user)} ${quoted(pass)}`);
    if (res.status !== "OK") {
      throw new MailProtocolError(`IMAP login failed: ${res.statusText}`);
    }
  }

  /** Creates the folder if it does not exist yet. Never throws on "exists". */
  async ensureFolder(folder: string) {
    const res = await this.#command(`CREATE ${quoted(folder)}`);
    if (res.status !== "OK" && !/exist/i.test(res.statusText)) {
      // Some servers report ALREADYEXISTS, others just NO - only surface real
      // problems by re-checking with SELECT below.
      const check = await this.#command(`SELECT ${quoted(folder)}`);
      if (check.status !== "OK") {
        throw new MailProtocolError(
          `cannot create or open folder "${folder}": ${res.statusText}`,
        );
      }
      this.#selected = folder;
    }
  }

  async select(folder: string) {
    if (this.#selected === folder) return;
    await this.#mustCommand(`SELECT ${quoted(folder)}`);
    this.#selected = folder;
  }

  /** UID SEARCH; returns matching UIDs. */
  async searchUids(criteria: string): Promise<number[]> {
    const res = await this.#mustCommand(`UID SEARCH ${criteria}`);
    const uids: number[] = [];
    for (const line of res.lines) {
      const m = /^\*\s+SEARCH\s*(.*)$/i.exec(line.text);
      if (!m) continue;
      for (const part of m[1].trim().split(/\s+/)) {
        const n = Number(part);
        if (Number.isFinite(n) && n > 0) uids.push(n);
      }
    }
    return uids;
  }

  /** Fetches selected header fields plus size for the given UIDs. */
  async fetchHeaders(
    uids: number[],
    fields: string[],
  ): Promise<FetchedHeader[]> {
    if (uids.length === 0) return [];
    const set = compactUidSet(uids);
    const res = await this.#mustCommand(
      `UID FETCH ${set} (UID RFC822.SIZE BODY.PEEK[HEADER.FIELDS (${
        fields.join(" ")
      })])`,
    );

    const out: FetchedHeader[] = [];
    for (const line of res.lines) {
      if (!/FETCH\s*\(/i.test(line.text)) continue;
      const uid = Number(/\bUID\s+(\d+)/i.exec(line.text)?.[1] ?? 0);
      if (!uid) continue;
      const size = Number(
        /\bRFC822\.SIZE\s+(\d+)/i.exec(line.text)?.[1] ?? 0,
      );
      const raw = line.literals[0];
      out.push({
        uid,
        size,
        headers: raw ? parseHeaderBlock(raw) : {},
      });
    }
    return out;
  }

  /** Fetches one complete message (RFC822 source). */
  async fetchMessage(uid: number): Promise<Uint8Array> {
    const res = await this.#mustCommand(`UID FETCH ${uid} (BODY.PEEK[])`);
    for (const line of res.lines) {
      if (!/FETCH\s*\(/i.test(line.text)) continue;
      if (line.literals[0]) return line.literals[0];
    }
    throw new MailProtocolError(`message UID ${uid} not found`);
  }

  /** Appends a message to the folder. */
  async append(folder: string, message: Uint8Array) {
    await this.#mustCommand(
      `APPEND ${quoted(folder)} (\\Seen) {${message.length}}`,
      message,
    );
  }

  /** Flags the UIDs deleted and expunges them. */
  async deleteUids(uids: number[]) {
    if (uids.length === 0) return;
    const set = compactUidSet(uids);
    await this.#mustCommand(`UID STORE ${set} +FLAGS (\\Deleted)`);
    if (this.#capabilities.has("UIDPLUS")) {
      await this.#mustCommand(`UID EXPUNGE ${set}`);
    } else {
      await this.#mustCommand("EXPUNGE");
    }
  }
}

// ------------------------------------------------------------------ helpers

/** IMAP quoted string. Callers must not pass CR/LF. */
export function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, (c) => "\\" + c)}"`;
}

/** Turns [1,2,3,7] into "1:3,7" to keep command lines short. */
export function compactUidSet(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}:${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(",");
}

/** Parses a raw header block into a lower-cased field map (unfolding lines). */
export function parseHeaderBlock(raw: Uint8Array): Record<string, string> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
  const out: Record<string, string> = {};
  let field = "";
  let value = "";
  const flush = () => {
    if (field) out[field.toLowerCase()] = value.trim();
    field = "";
    value = "";
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === "") continue;
    if (/^[ \t]/.test(line)) {
      value += " " + line.trim();
      continue;
    }
    flush();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    field = line.slice(0, idx);
    value = line.slice(idx + 1);
  }
  flush();
  return out;
}
