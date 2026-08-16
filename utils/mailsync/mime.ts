/**
 * @file mime.ts
 * @description Builds and parses the snapshot mails. One mail carries one
 *              chunk of a gzipped snapshot as a base64 attachment, plus a
 *              short human readable text part so the mailbox stays legible
 *              in a normal mail client.
 */

import { b64decode, b64encode, utf8 } from "./wire.ts";

export interface MimeHeaders {
  from: string;
  to: string;
  subject: string;
  /**
   * Leading part of the subject that must stay literal ASCII. The mailbox is
   * searched with IMAP `HEADER SUBJECT "<marker>"`, and a server matches that
   * against the raw header - so if RFC 2047 encoding swallowed the marker,
   * nothing would ever be found again.
   */
  subjectPrefix?: string;
  date: Date;
  messageId: string;
  extra?: Record<string, string>;
}

export interface BuiltMessage {
  bytes: Uint8Array;
  messageId: string;
}

/** True when the value can go into a header as-is. */
function isPlainAscii(value: string): boolean {
  // deno-lint-ignore no-control-regex
  return /^[\x20-\x7e]*$/.test(value);
}

/**
 * RFC 2047 encoded words, used for header values that are not plain ASCII.
 * An encoded word may be at most 75 characters, so long values are split into
 * several words folded onto continuation lines. Splitting happens on code
 * point boundaries so no multi-byte character is torn apart.
 */
export function encodeHeaderValue(value: string): string {
  if (isPlainAscii(value)) return value;

  const MAX_RAW = 45; // 45 bytes -> 60 base64 chars -> 72 with the ?= wrapper
  const words: string[] = [];
  let buf: number[] = [];
  for (const ch of value) {
    const bytes = utf8(ch);
    if (buf.length + bytes.length > MAX_RAW) {
      words.push(`=?UTF-8?B?${b64encode(new Uint8Array(buf))}?=`);
      buf = [];
    }
    buf.push(...bytes);
  }
  if (buf.length) words.push(`=?UTF-8?B?${b64encode(new Uint8Array(buf))}?=`);
  return words.join("\r\n ");
}

/**
 * Encodes a header value while keeping `prefix` literal.
 * Used for the subject so the `[BUD-E Memory]` marker stays searchable.
 */
export function encodeHeaderValueWithPrefix(
  value: string,
  prefix: string,
): string {
  if (!prefix || !value.startsWith(prefix)) return encodeHeaderValue(value);
  const rest = value.slice(prefix.length);
  if (isPlainAscii(rest)) return value;
  // Keep one literal space so the encoded word is properly delimited.
  return prefix + " " + encodeHeaderValue(rest.replace(/^\s+/, ""));
}

/** Decodes RFC 2047 encoded words (B and Q) inside a header value. */
export function decodeHeaderValue(value: string): string {
  // Whitespace between two adjacent encoded words is a folding artefact and
  // must disappear; do that before decoding, or real spaces get eaten.
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      (all, _charset, enc, payload) => {
        try {
          if (enc.toUpperCase() === "B") {
            return new TextDecoder().decode(b64decode(payload));
          }
          const bytes: number[] = [];
          const text = payload.replace(/_/g, " ");
          for (let i = 0; i < text.length; i++) {
            if (text[i] === "=" && i + 2 < text.length) {
              bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
              i += 2;
            } else {
              bytes.push(text.charCodeAt(i));
            }
          }
          return new TextDecoder().decode(new Uint8Array(bytes));
        } catch {
          return all;
        }
      },
    );
}

/** Wraps base64 at 76 characters, as required for the transfer encoding. */
function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join("\r\n");
}

/**
 * Builds a multipart/mixed message with one gzip attachment.
 * The result is CRLF-terminated and ready for IMAP APPEND or SMTP DATA.
 */
export function buildSnapshotMessage(
  headers: MimeHeaders,
  humanText: string,
  attachmentName: string,
  attachment: Uint8Array,
): BuiltMessage {
  const boundary = `budE_${headers.messageId.replace(/[^A-Za-z0-9]/g, "")}`;
  const lines: string[] = [];

  lines.push(`From: ${headers.from}`);
  lines.push(`To: ${headers.to}`);
  lines.push(
    `Subject: ${
      encodeHeaderValueWithPrefix(headers.subject, headers.subjectPrefix ?? "")
    }`,
  );
  lines.push(`Date: ${toRfc5322Date(headers.date)}`);
  lines.push(`Message-ID: <${headers.messageId}>`);
  for (const [k, v] of Object.entries(headers.extra ?? {})) {
    lines.push(`${k}: ${encodeHeaderValue(v)}`);
  }
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push("");
  lines.push("This is a multi-part message in MIME format.");
  lines.push("");
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset="utf-8"');
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(wrapBase64(b64encode(utf8(humanText))));
  lines.push("");
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: application/gzip; name="${attachmentName}"`);
  lines.push("Content-Transfer-Encoding: base64");
  lines.push(
    `Content-Disposition: attachment; filename="${attachmentName}"`,
  );
  lines.push("");

  const head = utf8(lines.join("\r\n") + "\r\n");
  const body = utf8(wrapBase64(b64encode(attachment)));
  const tail = utf8(`\r\n\r\n--${boundary}--\r\n`);

  const bytes = new Uint8Array(head.length + body.length + tail.length);
  bytes.set(head, 0);
  bytes.set(body, head.length);
  bytes.set(tail, head.length + body.length);
  return { bytes, messageId: headers.messageId };
}

export function toRfc5322Date(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${
    months[d.getUTCMonth()]
  } ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${
    p(d.getUTCSeconds())
  } +0000`;
}

/**
 * Pulls the gzip attachment out of a raw message.
 * Falls back to the first base64 encoded part if no attachment disposition
 * is present, so mails rewritten by a provider still load.
 */
export function extractAttachment(raw: Uint8Array): Uint8Array {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
  const sep = findHeaderBodySplit(text);
  const headerText = text.slice(0, sep.headerEnd);
  const body = text.slice(sep.bodyStart);

  const ctype = headerFieldFromBlock(headerText, "content-type") ?? "";
  const boundaryMatch = /boundary="?([^";\s]+)"?/i.exec(ctype);
  if (!boundaryMatch) {
    // Not multipart: the whole body is the payload.
    const enc = (headerFieldFromBlock(headerText, "content-transfer-encoding") ?? "")
      .toLowerCase();
    if (enc.includes("base64")) return b64decode(body);
    throw new Error("message has no base64 attachment");
  }

  const boundary = boundaryMatch[1];
  // Non-capturing group: a capture would put its match into split()'s output.
  const parts = body.split(
    new RegExp(`\r?\n?--${escapeRe(boundary)}(?:--)?\r?\n?`),
  );
  let fallback: string | null = null;

  for (const part of parts) {
    if (!part.trim()) continue;
    const split = findHeaderBodySplit(part);
    if (split.headerEnd === 0) continue;
    const ph = part.slice(0, split.headerEnd);
    const pb = part.slice(split.bodyStart);
    const enc = (headerFieldFromBlock(ph, "content-transfer-encoding") ?? "")
      .toLowerCase();
    if (!enc.includes("base64")) continue;

    const disp = headerFieldFromBlock(ph, "content-disposition") ?? "";
    const pct = headerFieldFromBlock(ph, "content-type") ?? "";
    if (/attachment/i.test(disp) || /gzip|octet-stream/i.test(pct)) {
      return b64decode(pb);
    }
    if (fallback === null) fallback = pb;
  }

  if (fallback !== null) return b64decode(fallback);
  throw new Error("no snapshot attachment found in message");
}

function findHeaderBodySplit(text: string): {
  headerEnd: number;
  bodyStart: number;
} {
  const crlf = text.indexOf("\r\n\r\n");
  const lf = text.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
    return { headerEnd: crlf, bodyStart: crlf + 4 };
  }
  if (lf >= 0) return { headerEnd: lf, bodyStart: lf + 2 };
  return { headerEnd: text.length, bodyStart: text.length };
}

function headerFieldFromBlock(block: string, field: string): string | null {
  const lines = block.split(/\r?\n/);
  let current: string | null = null;
  let value = "";
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current !== null) {
      value += " " + line.trim();
      continue;
    }
    if (current !== null && current === field) return value.trim();
    const idx = line.indexOf(":");
    if (idx < 0) {
      current = null;
      continue;
    }
    current = line.slice(0, idx).trim().toLowerCase();
    value = line.slice(idx + 1);
  }
  return current === field ? value.trim() : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
