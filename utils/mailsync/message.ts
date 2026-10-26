/**
 * @file message.ts
 * @description Parsing of ordinary e-mail, as opposed to the snapshot format
 *              in mime.ts. Needed so the assistant can look into a mailbox:
 *              walk the MIME tree, decode the transfer encodings, pick the
 *              readable text and list the attachments.
 *
 *              Deliberately forgiving. Mail in the wild breaks every rule in
 *              the RFCs, and a malformed part must never cost the user the
 *              rest of the message.
 */

import { b64decode } from "./wire.ts";
import { decodeHeaderValue } from "./mime.ts";
import { parseHeaderBlock } from "./imap.ts";

export interface Attachment {
  index: number;
  filename: string;
  contentType: string;
  /** decoded size in bytes */
  size: number;
  /** true for images referenced from the HTML body rather than real files */
  inline: boolean;
}

export interface ParsedMessage {
  headers: Record<string, string>;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  messageId: string;
  /** best readable rendering of the body */
  text: string;
  /** true when the text came from an HTML part */
  fromHtml: boolean;
  attachments: Attachment[];
}

interface Part {
  headers: Record<string, string>;
  /** raw body of this part, still encoded */
  body: string;
  contentType: string;
  charset: string;
  encoding: string;
  disposition: string;
  filename: string;
  children: Part[];
}

const decoder = new TextDecoder("utf-8", { fatal: false });

// ------------------------------------------------------------------ public

/** Parses a complete RFC 5322 message. */
export function parseMessage(raw: Uint8Array): ParsedMessage {
  const text = decoder.decode(raw);
  const root = parsePart(text);

  const headers = root.headers;
  const flat: Part[] = [];
  flatten(root, flat);

  const body = pickBody(flat);
  const attachments: Attachment[] = [];
  let index = 0;
  for (const part of flat) {
    if (!isAttachment(part)) continue;
    const decoded = decodePart(part);
    attachments.push({
      index: index++,
      filename: part.filename || defaultName(part.contentType, index),
      contentType: part.contentType,
      size: decoded.length,
      inline: /inline/i.test(part.disposition) && !part.filename,
    });
  }

  return {
    headers,
    from: decodeHeaderValue(headers["from"] ?? ""),
    to: decodeHeaderValue(headers["to"] ?? ""),
    cc: decodeHeaderValue(headers["cc"] ?? ""),
    subject: decodeHeaderValue(headers["subject"] ?? ""),
    date: headers["date"] ?? "",
    messageId: headers["message-id"] ?? "",
    text: body.text,
    fromHtml: body.fromHtml,
    attachments,
  };
}

/** Returns the bytes of one attachment, counted as parseMessage numbers them. */
export function extractAttachmentAt(
  raw: Uint8Array,
  wanted: number,
): { filename: string; contentType: string; bytes: Uint8Array } | null {
  const root = parsePart(decoder.decode(raw));
  const flat: Part[] = [];
  flatten(root, flat);

  let index = 0;
  for (const part of flat) {
    if (!isAttachment(part)) continue;
    if (index === wanted) {
      return {
        filename: part.filename || defaultName(part.contentType, index + 1),
        contentType: part.contentType,
        bytes: decodePart(part),
      };
    }
    index++;
  }
  return null;
}

/** One line per address, for listings: "Name <mail@host>" -> "Name". */
export function displayName(address: string): string {
  const trimmed = decodeHeaderValue(address).trim();
  const angled = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(trimmed);
  if (angled) {
    const name = angled[1].trim();
    return name || angled[2].trim();
  }
  return trimmed;
}

/** The bare address, for replying. */
export function bareAddress(address: string): string {
  const m = /<([^>]+)>/.exec(decodeHeaderValue(address));
  if (m) return m[1].trim();
  return decodeHeaderValue(address).trim().split(/\s+/)[0] ?? "";
}

// ----------------------------------------------------------------- parsing

function parsePart(text: string): Part {
  const split = splitHeaderBody(text);
  const headers = parseHeaderBlock(new TextEncoder().encode(split.head));
  const contentTypeRaw = headers["content-type"] ?? "text/plain";

  const part: Part = {
    headers,
    body: split.body,
    contentType: contentTypeRaw.split(";")[0].trim().toLowerCase(),
    charset: param(contentTypeRaw, "charset") || "utf-8",
    encoding: (headers["content-transfer-encoding"] ?? "7bit").trim()
      .toLowerCase(),
    disposition: headers["content-disposition"] ?? "",
    filename: decodeHeaderValue(
      param(headers["content-disposition"] ?? "", "filename") ||
        param(contentTypeRaw, "name") || "",
    ),
    children: [],
  };

  if (part.contentType.startsWith("multipart/")) {
    const boundary = param(contentTypeRaw, "boundary");
    if (boundary) {
      for (const chunk of splitOnBoundary(split.body, boundary)) {
        if (!chunk.trim()) continue;
        part.children.push(parsePart(chunk));
      }
    }
  }
  return part;
}

function flatten(part: Part, out: Part[]) {
  out.push(part);
  for (const child of part.children) flatten(child, out);
}

/**
 * Picks what a human would read: the plain text alternative if there is one,
 * otherwise the HTML with its tags stripped.
 */
function pickBody(parts: Part[]): { text: string; fromHtml: boolean } {
  const plain = parts.find((p) =>
    p.contentType === "text/plain" && !isAttachment(p)
  );
  if (plain) return { text: decodeText(plain).trim(), fromHtml: false };

  const html = parts.find((p) =>
    p.contentType === "text/html" && !isAttachment(p)
  );
  if (html) return { text: htmlToText(decodeText(html)), fromHtml: true };

  // Not multipart and not text: at least try the root.
  const root = parts[0];
  if (root && !root.contentType.startsWith("multipart/")) {
    return { text: decodeText(root).trim(), fromHtml: false };
  }
  return { text: "", fromHtml: false };
}

function isAttachment(part: Part): boolean {
  if (part.contentType.startsWith("multipart/")) return false;
  if (/attachment/i.test(part.disposition)) return true;
  if (part.filename) return true;
  // An inline image in an HTML mail is still something the user may want.
  if (/inline/i.test(part.disposition) && !part.contentType.startsWith("text/")) {
    return true;
  }
  return false;
}

function decodePart(part: Part): Uint8Array {
  if (part.encoding === "base64") {
    try {
      return b64decode(part.body);
    } catch {
      return new Uint8Array(0);
    }
  }
  if (part.encoding === "quoted-printable") {
    return decodeQuotedPrintable(part.body);
  }
  return new TextEncoder().encode(part.body);
}

function decodeText(part: Part): string {
  const bytes = decodePart(part);
  try {
    return new TextDecoder(normaliseCharset(part.charset), { fatal: false })
      .decode(bytes);
  } catch {
    return decoder.decode(bytes);
  }
}

function normaliseCharset(charset: string): string {
  const c = charset.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!c || c === "us-ascii" || c === "ansi_x3.4-1968") return "utf-8";
  return c;
}

// ----------------------------------------------------------------- helpers

function splitHeaderBody(text: string): { head: string; body: string } {
  const crlf = text.indexOf("\r\n\r\n");
  const lf = text.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
    return { head: text.slice(0, crlf), body: text.slice(crlf + 4) };
  }
  if (lf >= 0) return { head: text.slice(0, lf), body: text.slice(lf + 2) };
  return { head: text, body: "" };
}

function splitOnBoundary(body: string, boundary: string): string[] {
  const marker = "--" + boundary;
  const out: string[] = [];
  const lines = body.split(/\r?\n/);
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.trimEnd() === marker) {
      if (current) out.push(current.join("\r\n"));
      current = [];
      continue;
    }
    if (line.trimEnd() === marker + "--") {
      if (current) out.push(current.join("\r\n"));
      current = null;
      break;
    }
    if (current) current.push(line);
  }
  if (current) out.push(current.join("\r\n"));
  return out;
}

/** `name="value"` or `name=value` out of a header value. */
function param(headerValue: string, name: string): string {
  const quoted = new RegExp(name + '\\s*=\\s*"([^"]*)"', "i").exec(headerValue);
  if (quoted) return quoted[1];
  const bare = new RegExp(name + "\\s*=\\s*([^;\\s]+)", "i").exec(headerValue);
  return bare ? bare[1] : "";
}

export function decodeQuotedPrintable(text: string): Uint8Array {
  // Soft line breaks first, then the =XX escapes.
  const joined = text.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    const code = joined.charCodeAt(i);
    if (code < 256) {
      out.push(code);
    } else {
      // Should not occur in valid QP, but keep the character rather than
      // dropping it.
      for (const b of new TextEncoder().encode(joined[i])) out.push(b);
    }
  }
  return new Uint8Array(out);
}

/** Good enough to read an HTML mail as text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function defaultName(contentType: string, n: number): string {
  const ext = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  return `anhang-${n}.${ext}`;
}
