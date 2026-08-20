/**
 * @file mail.ts
 * @description The mailbox as the assistant sees it: list, search, read one
 *              message, fetch an attachment, save a draft, send a reply.
 *
 *              Separate from mailsync.ts on purpose. That route moves BUD-E's
 *              own snapshots around; this one touches the user's actual mail
 *              and is only reachable when they switched the permission on in
 *              the settings.
 *
 *              Listings deliberately carry headers only - sender, date,
 *              subject, size. Bodies cost context and privacy, so they are
 *              fetched one at a time and only when asked for.
 */

import { Handlers } from "$fresh/server.ts";
import { ImapClient, type ImapConfig, quoted } from "../../utils/mailsync/imap.ts";
import { SmtpClient, type SmtpConfig } from "../../utils/mailsync/smtp.ts";
import {
  bareAddress,
  displayName,
  extractAttachmentAt,
  parseMessage,
} from "../../utils/mailsync/message.ts";
import {
  decodeHeaderValue,
  encodeHeaderValue,
  toRfc5322Date,
} from "../../utils/mailsync/mime.ts";
import { b64encode, utf8 } from "../../utils/mailsync/wire.ts";
import { isPrivateHost } from "./mailsync.ts";

// ---------------------------------------------------------------- settings

const ALLOW_INSECURE_HOSTS =
  Deno.env.get("MAILSYNC_ALLOW_INSECURE_HOSTS") === "1";
const STANDARD_PORTS = new Set([25, 143, 465, 587, 993, 2525]);
const EXTRA_PORTS = new Set(
  (Deno.env.get("MAILSYNC_EXTRA_PORTS") ?? "")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p < 65536),
);

/** Hard ceiling for one attachment handed to the browser. */
const MAX_ATTACHMENT_BYTES =
  (Number(Deno.env.get("MAIL_MAX_ATTACHMENT_MB")) || 25) * 1024 * 1024;

/** How many messages a single listing or search may return. */
const MAX_LIST = 200;

class BadRequest extends Error {}

// ------------------------------------------------------------------ account

interface Account {
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapStartTls: boolean;
  imapUser: string;
  imapPass: string;

  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  smtpStartTls: boolean;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
}

// deno-lint-ignore no-explicit-any
function readAccount(raw: any): Account {
  if (!raw || typeof raw !== "object") {
    throw new BadRequest("no mailbox configured");
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const imapTls = raw.imapTls !== false;
  const account: Account = {
    imapHost: str(raw.imapHost),
    imapPort: num(raw.imapPort, imapTls ? 993 : 143),
    imapTls,
    imapStartTls: !!raw.imapStartTls,
    imapUser: str(raw.imapUser),
    imapPass: typeof raw.imapPass === "string" ? raw.imapPass : "",

    smtpHost: str(raw.smtpHost),
    smtpPort: num(raw.smtpPort, 587),
    smtpTls: !!raw.smtpTls,
    smtpStartTls: raw.smtpStartTls !== false,
    smtpUser: str(raw.smtpUser),
    smtpPass: typeof raw.smtpPass === "string" ? raw.smtpPass : "",
    fromAddress: str(raw.fromAddress),
  };
  if (!account.imapHost) throw new BadRequest("IMAP host is missing");
  if (!account.imapUser) throw new BadRequest("IMAP user is missing");
  assertAllowed(account.imapHost, account.imapPort, "IMAP");
  return account;
}

function assertAllowed(host: string, port: number, what: string) {
  if (ALLOW_INSECURE_HOSTS) return;
  if (!STANDARD_PORTS.has(port) && !EXTRA_PORTS.has(port)) {
    throw new BadRequest(`${what}: port ${port} is not allowed`);
  }
  if (isPrivateHost(host)) {
    throw new BadRequest(`${what}: refusing to connect to "${host}"`);
  }
}

function imapConfig(a: Account): ImapConfig {
  return {
    host: a.imapHost,
    port: a.imapPort,
    tls: a.imapTls,
    starttls: a.imapStartTls,
    user: a.imapUser,
    pass: a.imapPass,
  };
}

async function withImap<T>(
  account: Account,
  fn: (client: ImapClient) => Promise<T>,
): Promise<T> {
  const client = await ImapClient.connect(imapConfig(account));
  try {
    await client.login();
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// -------------------------------------------------------------- IMAP search

const LIST_FIELDS = ["FROM", "TO", "CC", "DATE", "SUBJECT", "MESSAGE-ID"];

/** Quotes a value for an IMAP search term, rejecting line breaks. */
function searchString(value: string): string {
  if (/[\r\n]/.test(value)) throw new BadRequest("invalid search term");
  return quoted(value);
}

/** IMAP wants dates as 12-Aug-2026. */
function imapDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new BadRequest(`invalid date: ${value}`);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getUTCDate()}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/**
 * Builds the IMAP SEARCH criteria. Several terms combine with AND, which is
 * what IMAP does when they are simply listed one after another.
 */
// deno-lint-ignore no-explicit-any
function buildCriteria(body: any): string {
  const terms: string[] = [];
  if (typeof body.from === "string" && body.from.trim()) {
    terms.push(`FROM ${searchString(body.from.trim())}`);
  }
  if (typeof body.to === "string" && body.to.trim()) {
    terms.push(`TO ${searchString(body.to.trim())}`);
  }
  if (typeof body.subject === "string" && body.subject.trim()) {
    terms.push(`SUBJECT ${searchString(body.subject.trim())}`);
  }
  if (typeof body.text === "string" && body.text.trim()) {
    // TEXT searches headers and body - the broad "anything about X" case.
    terms.push(`TEXT ${searchString(body.text.trim())}`);
  }
  if (typeof body.since === "string" && body.since.trim()) {
    terms.push(`SINCE ${imapDate(body.since.trim())}`);
  }
  if (typeof body.before === "string" && body.before.trim()) {
    terms.push(`BEFORE ${imapDate(body.before.trim())}`);
  }
  if (body.unseen === true) terms.push("UNSEEN");
  if (body.flagged === true) terms.push("FLAGGED");
  if (body.withAttachments === true) {
    // No portable "has attachment" search; this is the usual approximation.
    terms.push('HEADER Content-Type "multipart/mixed"');
  }
  return terms.length ? terms.join(" ") : "ALL";
}

// ----------------------------------------------------------------- actions

async function actionFolders(account: Account) {
  const folders = await withImap(account, (c) => c.listFolders());
  return { ok: true, folders };
}

/**
 * Headers of the newest messages matching the criteria.
 * Never returns bodies - that is what "read" is for.
 */
// deno-lint-ignore no-explicit-any
async function actionSearch(account: Account, body: any) {
  const folder = typeof body.folder === "string" && body.folder.trim()
    ? body.folder.trim()
    : "INBOX";
  if (/[\r\n]/.test(folder)) throw new BadRequest("invalid folder");
  const limit = Math.min(
    Math.max(1, Number(body.limit) || 25),
    MAX_LIST,
  );
  const criteria = buildCriteria(body);

  const result = await withImap(account, async (client) => {
    await client.select(folder);
    const uids = await client.searchUids(criteria);
    // Newest first, and only as many as asked for.
    const wanted = uids.slice(-limit).reverse();
    if (wanted.length === 0) return { total: uids.length, messages: [] };
    const headers = await client.fetchHeaders(wanted, LIST_FIELDS);
    const byUid = new Map(headers.map((h) => [h.uid, h]));
    const messages = wanted.map((uid) => {
      const h = byUid.get(uid);
      const fields = h?.headers ?? {};
      return {
        uid,
        from: decodeHeaderValue(fields["from"] ?? ""),
        fromName: displayName(fields["from"] ?? ""),
        to: decodeHeaderValue(fields["to"] ?? ""),
        date: fields["date"] ?? "",
        subject: decodeHeaderValue(fields["subject"] ?? ""),
        size: h?.size ?? 0,
      };
    }).filter((m) => m.subject || m.from);
    return { total: uids.length, messages };
  });

  return { ok: true, folder, criteria, ...result };
}

/** One message with its body, truncated to what the caller asked for. */
// deno-lint-ignore no-explicit-any
async function actionRead(account: Account, body: any) {
  const folder = typeof body.folder === "string" && body.folder.trim()
    ? body.folder.trim()
    : "INBOX";
  const uid = Number(body.uid);
  if (!Number.isInteger(uid) || uid <= 0) throw new BadRequest("invalid uid");
  // An explicit limit is honoured as given - the caller may deliberately want
  // just the opening lines. Only the absent case falls back to a default.
  const requested = Number(body.maxChars);
  const maxChars = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), 100_000)
    : 4000;

  const raw = await withImap(account, async (client) => {
    await client.select(folder);
    return await client.fetchMessage(uid);
  });

  const parsed = parseMessage(raw);
  const truncated = parsed.text.length > maxChars;

  return {
    ok: true,
    uid,
    folder,
    from: parsed.from,
    fromName: displayName(parsed.from),
    fromAddress: bareAddress(parsed.from),
    to: parsed.to,
    cc: parsed.cc,
    subject: parsed.subject,
    date: parsed.date,
    messageId: parsed.messageId,
    text: truncated ? parsed.text.slice(0, maxChars) : parsed.text,
    truncated,
    fullLength: parsed.text.length,
    fromHtml: parsed.fromHtml,
    attachments: parsed.attachments,
  };
}

/** The bytes of one attachment, base64 encoded for the browser. */
// deno-lint-ignore no-explicit-any
async function actionAttachment(account: Account, body: any) {
  const folder = typeof body.folder === "string" && body.folder.trim()
    ? body.folder.trim()
    : "INBOX";
  const uid = Number(body.uid);
  const index = Number(body.index ?? 0);
  if (!Number.isInteger(uid) || uid <= 0) throw new BadRequest("invalid uid");
  if (!Number.isInteger(index) || index < 0) throw new BadRequest("invalid index");

  const raw = await withImap(account, async (client) => {
    await client.select(folder);
    return await client.fetchMessage(uid);
  });

  const found = extractAttachmentAt(raw, index);
  if (!found) throw new BadRequest(`attachment ${index} not found`);
  if (found.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new BadRequest(
      `attachment is ${mb(found.bytes.length)} MB, the limit is ${
        mb(MAX_ATTACHMENT_BYTES)
      } MB`,
    );
  }

  return {
    ok: true,
    filename: found.filename,
    contentType: found.contentType,
    size: found.bytes.length,
    data: b64encode(found.bytes),
  };
}

// --------------------------------------------------------------- composing

interface Draft {
  to: string;
  cc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
}

// deno-lint-ignore no-explicit-any
function readDraft(raw: any): Draft {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const draft: Draft = {
    to: str(raw.to),
    cc: str(raw.cc),
    subject: str(raw.subject),
    body: typeof raw.body === "string" ? raw.body : "",
    inReplyTo: str(raw.inReplyTo),
    references: str(raw.references),
  };
  if (!draft.to) throw new BadRequest("no recipient given");
  if (/[\r\n]/.test(draft.to) || /[\r\n]/.test(draft.cc)) {
    throw new BadRequest("invalid recipient");
  }
  return draft;
}

function buildOutgoing(draft: Draft, from: string): Uint8Array {
  const lines = [
    `From: ${from}`,
    `To: ${draft.to}`,
  ];
  if (draft.cc) lines.push(`Cc: ${draft.cc}`);
  lines.push(`Subject: ${encodeHeaderValue(draft.subject || "(kein Betreff)")}`);
  lines.push(`Date: ${toRfc5322Date(new Date())}`);
  lines.push(
    `Message-ID: <${crypto.randomUUID()}@bud-e>`,
  );
  if (draft.inReplyTo) {
    lines.push(`In-Reply-To: ${draft.inReplyTo}`);
    lines.push(`References: ${draft.references || draft.inReplyTo}`);
  }
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="utf-8"');
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");

  const head = utf8(lines.join("\r\n") + "\r\n");
  const b64 = b64encode(utf8(draft.body));
  const wrapped: string[] = [];
  for (let i = 0; i < b64.length; i += 76) wrapped.push(b64.slice(i, i + 76));
  const payload = utf8(wrapped.join("\r\n") + "\r\n");

  const out = new Uint8Array(head.length + payload.length);
  out.set(head, 0);
  out.set(payload, head.length);
  return out;
}

/** Saves a draft into the Drafts folder, found via its special-use flag. */
// deno-lint-ignore no-explicit-any
async function actionDraft(account: Account, body: any) {
  const draft = readDraft(body);
  const from = account.fromAddress || account.imapUser;
  const message = buildOutgoing(draft, from);

  const folder = await withImap(account, async (client) => {
    const folders = await client.listFolders();
    const target = folders.find((f) => f.specialUse === "drafts")?.name ??
      folders.find((f) => /^(drafts|entw)/i.test(f.name))?.name ??
      "Drafts";
    await client.ensureFolder(target);
    await client.append(target, message);
    return target;
  });

  return { ok: true, folder, to: draft.to, subject: draft.subject };
}

/** Sends a message over SMTP and files a copy in Sent when there is one. */
// deno-lint-ignore no-explicit-any
async function actionSend(account: Account, body: any) {
  if (!account.smtpHost) {
    throw new BadRequest(
      "No outgoing server configured. Add the SMTP settings to send mail.",
    );
  }
  assertAllowed(account.smtpHost, account.smtpPort, "SMTP");

  const draft = readDraft(body);
  const from = account.fromAddress || account.imapUser;
  const message = buildOutgoing(draft, from);

  const config: SmtpConfig = {
    host: account.smtpHost,
    port: account.smtpPort,
    tls: account.smtpTls,
    starttls: account.smtpStartTls,
    user: account.smtpUser || account.imapUser,
    pass: account.smtpPass || account.imapPass,
  };

  const recipients = [draft.to, draft.cc]
    .filter(Boolean)
    .flatMap((field) => field.split(","))
    .map((a) => bareAddress(a))
    .filter(Boolean);

  const client = await SmtpClient.connect(config);
  try {
    await client.login();
    await client.send(bareAddress(from) || from, recipients, message);
  } finally {
    await client.quit();
  }

  // Best effort: a copy in Sent. Failing to file it must not look like a
  // failure to send.
  let copiedTo = "";
  try {
    copiedTo = await withImap(account, async (imap) => {
      const folders = await imap.listFolders();
      const sent = folders.find((f) => f.specialUse === "sent")?.name ??
        folders.find((f) => /^(sent|gesendet)/i.test(f.name))?.name ?? "";
      if (!sent) return "";
      await imap.append(sent, message);
      return sent;
    });
  } catch {
    copiedTo = "";
  }

  return { ok: true, to: recipients, subject: draft.subject, copiedTo };
}

// ----------------------------------------------------------------- handler

export const handler: Handlers = {
  async POST(req) {
    try {
      const body = await req.json();
      const action = String(body.action ?? "");
      const account = readAccount(body.account);

      switch (action) {
        case "folders":
          return json(await actionFolders(account));
        case "search":
        case "list":
          return json(await actionSearch(account, body));
        case "read":
          return json(await actionRead(account, body));
        case "attachment":
          return json(await actionAttachment(account, body));
        case "draft":
          return json(await actionDraft(account, body));
        case "send":
          return json(await actionSend(account, body));
        default:
          throw new BadRequest(`unknown action "${action}"`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof BadRequest ? 400 : 502;
      console.error("[mail]", message);
      return json({ ok: false, error: message }, status);
    }
  },
};

// deno-lint-ignore no-explicit-any
function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
