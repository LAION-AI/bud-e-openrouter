/**
 * @file smtp.ts
 * @description Minimal SMTP submission client (EHLO, optional STARTTLS,
 *              AUTH PLAIN/LOGIN, MAIL/RCPT/DATA).
 *
 *              Only used when the user configures an outgoing server; the
 *              default sync path writes snapshots straight into the mailbox
 *              with IMAP APPEND, which is faster and cannot be eaten by a
 *              spam filter.
 */

import {
  b64encode,
  BufferedConn,
  MailProtocolError,
  openConn,
  utf8,
} from "./wire.ts";

export interface SmtpConfig {
  host: string;
  port: number;
  /** implicit TLS (usually port 465) */
  tls: boolean;
  /** upgrade via STARTTLS (usually port 587) */
  starttls?: boolean;
  user?: string;
  pass?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

interface Reply {
  code: number;
  lines: string[];
}

export class SmtpClient {
  #conn: BufferedConn;
  #config: SmtpConfig;
  #extensions = new Set<string>();

  private constructor(conn: BufferedConn, config: SmtpConfig) {
    this.#conn = conn;
    this.#config = config;
  }

  static async connect(config: SmtpConfig): Promise<SmtpClient> {
    const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const useStartTls = !config.tls && !!config.starttls;
    const raw = useStartTls
      ? await Deno.connect({ hostname: config.host, port: config.port })
      : await openConn(config.host, config.port, config.tls);
    const conn = new BufferedConn(raw, timeout);
    const client = new SmtpClient(conn, config);

    const greeting = await client.#readReply();
    if (greeting.code !== 220) {
      conn.close();
      throw new MailProtocolError(
        `SMTP server refused connection: ${greeting.code} ${greeting.lines[0]}`,
      );
    }

    await client.#ehlo();

    if (useStartTls) {
      if (!client.#extensions.has("STARTTLS")) {
        conn.close();
        throw new MailProtocolError(
          "server does not advertise STARTTLS - refusing to send credentials in the clear",
        );
      }
      await client.#expect("STARTTLS", 220);
      const tls = await Deno.startTls(raw as Deno.TcpConn, {
        hostname: config.host,
      });
      conn.replaceConn(tls);
      client.#extensions.clear();
      await client.#ehlo();
    }
    return client;
  }

  async #readReply(): Promise<Reply> {
    const lines: string[] = [];
    let code = 0;
    for (;;) {
      const line = await this.#conn.readLine();
      const m = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!m) throw new MailProtocolError(`bad SMTP reply: ${line}`);
      code = Number(m[1]);
      lines.push(m[3]);
      if (m[2] === " ") return { code, lines };
    }
  }

  async #send(line: string): Promise<Reply> {
    await this.#conn.writeLine(line);
    return await this.#readReply();
  }

  async #expect(line: string, ...codes: number[]): Promise<Reply> {
    const reply = await this.#send(line);
    if (!codes.includes(reply.code)) {
      throw new MailProtocolError(
        `SMTP ${line.split(" ")[0]} failed: ${reply.code} ${reply.lines.join(" ")}`,
      );
    }
    return reply;
  }

  async #ehlo() {
    const reply = await this.#send(`EHLO ${ehloName(this.#config.host)}`);
    if (reply.code !== 250) {
      // Very old servers only speak HELO; then there are no extensions.
      await this.#expect(`HELO ${ehloName(this.#config.host)}`, 250);
      return;
    }
    for (const line of reply.lines.slice(1)) {
      const [name, ...rest] = line.trim().split(/\s+/);
      this.#extensions.add(name.toUpperCase());
      if (name.toUpperCase() === "AUTH") {
        for (const mech of rest) this.#extensions.add(`AUTH=${mech.toUpperCase()}`);
      }
    }
  }

  async login() {
    const { user, pass } = this.#config;
    if (!user) return;
    if (this.#extensions.has("AUTH=PLAIN")) {
      const payload = new Uint8Array([0, ...utf8(user), 0, ...utf8(pass ?? "")]);
      await this.#expect(`AUTH PLAIN ${b64encode(payload)}`, 235);
      return;
    }
    if (this.#extensions.has("AUTH=LOGIN")) {
      await this.#expect("AUTH LOGIN", 334);
      await this.#expect(b64encode(utf8(user)), 334);
      await this.#expect(b64encode(utf8(pass ?? "")), 235);
      return;
    }
    throw new MailProtocolError(
      "SMTP server offers no supported authentication mechanism (PLAIN or LOGIN)",
    );
  }

  /** Sends one message. `message` must already be CRLF-terminated MIME. */
  async send(from: string, to: string[], message: Uint8Array) {
    await this.#expect(`MAIL FROM:<${from}>`, 250);
    for (const rcpt of to) {
      await this.#expect(`RCPT TO:<${rcpt}>`, 250, 251);
    }
    await this.#expect("DATA", 354);
    await this.#conn.writeBytes(dotStuff(message));
    await this.#conn.writeLine(".");
    const reply = await this.#readReply();
    if (reply.code !== 250) {
      throw new MailProtocolError(
        `SMTP delivery failed: ${reply.code} ${reply.lines.join(" ")}`,
      );
    }
  }

  async quit() {
    try {
      await this.#send("QUIT");
    } catch {
      // server may hang up first
    }
    this.#conn.close();
  }

  close() {
    this.#conn.close();
  }
}

/**
 * RFC 5321 transparency: a line starting with "." gets an extra dot, and the
 * payload is CRLF terminated so the closing "." lands on its own line.
 *
 * Written in two passes (count, then fill) because snapshot attachments are
 * multi-megabyte and building a number[] would be ruinous.
 */
export function dotStuff(message: Uint8Array): Uint8Array {
  const DOT = 0x2e, LF = 0x0a, CR = 0x0d;
  let extra = 0;
  let atLineStart = true;
  for (let i = 0; i < message.length; i++) {
    if (atLineStart && message[i] === DOT) extra++;
    atLineStart = message[i] === LF;
  }
  const needsEol = message.length === 0 ||
    !(message[message.length - 2] === CR && message[message.length - 1] === LF);
  const out = new Uint8Array(message.length + extra + (needsEol ? 2 : 0));

  let w = 0;
  atLineStart = true;
  for (let i = 0; i < message.length; i++) {
    const b = message[i];
    if (atLineStart && b === DOT) out[w++] = DOT;
    out[w++] = b;
    atLineStart = b === LF;
  }
  if (needsEol) {
    out[w++] = CR;
    out[w++] = LF;
  }
  return out;
}

function ehloName(host: string): string {
  // A syntactically valid domain literal is always accepted and leaks nothing.
  return /^[A-Za-z0-9.-]+$/.test(host) ? host : "bud-e.local";
}
