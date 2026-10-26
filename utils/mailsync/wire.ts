/**
 * @file wire.ts
 * @description Shared low-level plumbing for the IMAP and SMTP clients:
 *              a buffered line/byte reader over a Deno connection plus a few
 *              helpers. Both protocols are line based with occasional binary
 *              payloads, so they share the same reader.
 *
 *              No external dependencies on purpose - the rest of this project
 *              talks to its APIs with plain fetch, and a mail client is small
 *              enough to keep in-tree.
 */

const CR = 13;
const LF = 10;

const decoder = new TextDecoder("utf-8", { fatal: false });
const encoder = new TextEncoder();

/** Minimal surface we need from a connection (Deno.Conn / Deno.TlsConn). */
export interface ByteConn {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
}

export class MailProtocolError extends Error {}
export class MailTimeoutError extends MailProtocolError {}

/**
 * Buffered reader that can hand out either CRLF-terminated lines or an exact
 * number of bytes (IMAP literals, which may be many megabytes).
 *
 * Incoming data is kept as a list of chunks rather than one growing array so
 * that reading a large literal stays O(n) instead of O(n^2).
 */
export class BufferedConn {
  #conn: ByteConn;
  #chunks: Uint8Array[] = [];
  #total = 0;
  #timeoutMs: number;
  #closed = false;

  constructor(conn: ByteConn, timeoutMs: number) {
    this.#conn = conn;
    this.#timeoutMs = timeoutMs;
  }

  /** Swaps the underlying connection (used by STARTTLS). */
  replaceConn(conn: ByteConn) {
    if (this.#total > 0) {
      // Anything buffered before the handshake would be plaintext injected by
      // a man in the middle; refusing is the safe move.
      throw new MailProtocolError(
        "unexpected buffered data before TLS handshake",
      );
    }
    this.#conn = conn;
  }

  get closed() {
    return this.#closed;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#conn.close();
    } catch {
      // already gone
    }
  }

  async #fill(): Promise<void> {
    const buf = new Uint8Array(256 * 1024);
    let timer: number | undefined;
    const n = await new Promise<number | null>((resolve, reject) => {
      timer = setTimeout(() => {
        this.close();
        reject(new MailTimeoutError(`read timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      this.#conn.read(buf).then(resolve, reject);
    }).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });

    if (n === null || n === 0) {
      this.#closed = true;
      throw new MailProtocolError("connection closed by peer");
    }
    this.#chunks.push(buf.subarray(0, n));
    this.#total += n;
  }

  /** Removes and returns the first `n` buffered bytes. */
  #take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      const head = this.#chunks[0];
      const need = n - written;
      if (head.length <= need) {
        out.set(head, written);
        written += head.length;
        this.#chunks.shift();
      } else {
        out.set(head.subarray(0, need), written);
        this.#chunks[0] = head.subarray(need);
        written += need;
      }
    }
    this.#total -= n;
    return out;
  }

  /** Index of the next LF in the buffer, or -1. */
  #indexOfLF(): number {
    let base = 0;
    for (const chunk of this.#chunks) {
      const idx = chunk.indexOf(LF);
      if (idx >= 0) return base + idx;
      base += chunk.length;
    }
    return -1;
  }

  /** Reads one line, without the trailing CRLF. */
  async readLine(): Promise<string> {
    for (;;) {
      const idx = this.#indexOfLF();
      if (idx >= 0) {
        const raw = this.#take(idx + 1);
        let end = raw.length - 1; // drop LF
        if (end > 0 && raw[end - 1] === CR) end--;
        return decoder.decode(raw.subarray(0, end));
      }
      await this.#fill();
    }
  }

  /** Reads exactly `n` bytes (IMAP literal). */
  async readExactly(n: number): Promise<Uint8Array> {
    while (this.#total < n) await this.#fill();
    return this.#take(n);
  }

  async writeBytes(data: Uint8Array): Promise<void> {
    let off = 0;
    while (off < data.length) {
      const written = await this.#conn.write(data.subarray(off));
      if (written <= 0) throw new MailProtocolError("short write");
      off += written;
    }
  }

  async writeLine(line: string): Promise<void> {
    await this.writeBytes(encoder.encode(line + "\r\n"));
  }
}

/** Opens a TCP (optionally TLS) connection. */
export async function openConn(
  hostname: string,
  port: number,
  tls: boolean,
): Promise<ByteConn> {
  if (tls) return await Deno.connectTls({ hostname, port });
  return await Deno.connect({ hostname, port });
}

export function b64encode(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function b64decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
