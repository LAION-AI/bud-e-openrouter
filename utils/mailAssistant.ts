/**
 * @file mailAssistant.ts
 * @description Browser side of the mailbox skill: the permission, the limits
 *              and the calls to /api/mail.
 *
 *              The guiding rule is that a listing costs little and a body
 *              costs a lot. Searching returns headers only; the assistant then
 *              opens the one or two messages that actually matter.
 */

import { type MailAccount } from "./mailsyncClient.ts";

export const MAIL_PERMISSION_KEY = "bude-mail-allow-assistant";
export const MAIL_LIMITS_KEY = "bude-mail-limits";

export interface MailLimits {
  /** how many headers one search may return */
  listLimit: number;
  /** characters of body text handed to the model */
  bodyChars: number;
  /** largest attachment offered for download, in MB */
  attachmentMb: number;
  /** folders the assistant may look into */
  folders: string[];
  /** allow saving drafts */
  allowDrafts: boolean;
  /** allow actually sending mail */
  allowSend: boolean;
}

export const DEFAULT_MAIL_LIMITS: MailLimits = {
  listLimit: 25,
  bodyChars: 4000,
  attachmentMb: 25,
  folders: ["INBOX", "Sent", "Drafts"],
  allowDrafts: true,
  // Sending is off by default: reading is recoverable, a sent mail is not.
  allowSend: false,
};

export function isMailAllowed(): boolean {
  return localStorage.getItem(MAIL_PERMISSION_KEY) === "1";
}

export function setMailAllowed(allowed: boolean) {
  if (allowed) localStorage.setItem(MAIL_PERMISSION_KEY, "1");
  else localStorage.removeItem(MAIL_PERMISSION_KEY);
}

export function loadMailLimits(): MailLimits {
  try {
    const raw = localStorage.getItem(MAIL_LIMITS_KEY);
    if (!raw) return { ...DEFAULT_MAIL_LIMITS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_MAIL_LIMITS,
      ...parsed,
      folders: Array.isArray(parsed.folders) && parsed.folders.length
        ? parsed.folders
        : DEFAULT_MAIL_LIMITS.folders,
    };
  } catch {
    return { ...DEFAULT_MAIL_LIMITS };
  }
}

export function saveMailLimits(limits: MailLimits) {
  localStorage.setItem(MAIL_LIMITS_KEY, JSON.stringify(limits));
}

// -------------------------------------------------------------- data shapes

export interface MailHeader {
  uid: number;
  from: string;
  fromName: string;
  to: string;
  date: string;
  subject: string;
  size: number;
}

export interface MailAttachment {
  index: number;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
}

export interface MailBody {
  uid: number;
  folder: string;
  from: string;
  fromName: string;
  fromAddress: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  messageId: string;
  text: string;
  truncated: boolean;
  fullLength: number;
  attachments: MailAttachment[];
}

/** What the model may ask for. */
export type MailAction =
  | { action: "folders" }
  | {
    action: "search";
    folder?: string;
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    since?: string;
    before?: string;
    unseen?: boolean;
    limit?: number;
  }
  | { action: "read"; folder?: string; uid: number; maxChars?: number }
  | { action: "attachment"; folder?: string; uid: number; index?: number }
  | {
    action: "draft";
    to: string;
    cc?: string;
    subject?: string;
    body: string;
    inReplyTo?: string;
  }
  | {
    action: "send";
    to: string;
    cc?: string;
    subject?: string;
    body: string;
    inReplyTo?: string;
  };

// ------------------------------------------------------------------- calls

/** Only the fields the mail route needs - the sync flags stay here. */
export function mailAccountForRequest(a: MailAccount) {
  return {
    imapHost: a.imapHost,
    imapPort: a.imapPort,
    imapTls: a.imapTls,
    imapStartTls: a.imapStartTls,
    imapUser: a.imapUser,
    imapPass: a.imapPass,
    smtpHost: a.smtpHost,
    smtpPort: a.smtpPort,
    smtpTls: a.smtpTls,
    smtpStartTls: a.smtpStartTls,
    smtpUser: a.smtpUser,
    smtpPass: a.smtpPass,
    fromAddress: a.fromAddress || a.imapUser,
  };
}

// deno-lint-ignore no-explicit-any
async function callMail(account: MailAccount, payload: any): Promise<any> {
  const res = await fetch("/api/mail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, account: mailAccountForRequest(account) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Postfach-Fehler (${res.status})`);
  }
  return data;
}

/**
 * Runs one assistant request against the mailbox, enforcing the user's limits.
 * Returns text for the model plus, for attachments, the bytes for the UI.
 */
export async function runMailAction(
  account: MailAccount,
  raw: unknown,
  limits: MailLimits = loadMailLimits(),
): Promise<{
  text: string;
  attachment?: { filename: string; contentType: string; dataUrl: string; size: number };
}> {
  const act = raw as MailAction;
  if (!act || typeof act !== "object" || !("action" in act)) {
    return { text: "Kein gültiger Postfach-Befehl." };
  }

  const folderAllowed = (folder: string) =>
    limits.folders.some((f) => f.toLowerCase() === folder.toLowerCase());

  switch (act.action) {
    case "folders": {
      const r = await callMail(account, { action: "folders" });
      const names = (r.folders as { name: string }[])
        .map((f) => f.name)
        .filter((n) => folderAllowed(n));
      return { text: `Freigegebene Ordner: ${names.join(", ") || "keine"}` };
    }

    case "search": {
      const folder = (act.folder ?? "INBOX").trim() || "INBOX";
      if (!folderAllowed(folder)) {
        return {
          text:
            `Der Ordner "${folder}" ist nicht freigegeben. Erlaubt: ${
              limits.folders.join(", ")
            }.`,
        };
      }
      const limit = Math.min(Number(act.limit) || limits.listLimit, limits.listLimit);
      const r = await callMail(account, { ...act, folder, limit });
      return { text: formatHeaders(r.messages ?? [], folder, r.total ?? 0) };
    }

    case "read": {
      const folder = (act.folder ?? "INBOX").trim() || "INBOX";
      if (!folderAllowed(folder)) {
        return { text: `Der Ordner "${folder}" ist nicht freigegeben.` };
      }
      const maxChars = Math.min(
        Number(act.maxChars) || limits.bodyChars,
        limits.bodyChars,
      );
      const r = await callMail(account, { ...act, folder, maxChars });
      return { text: formatBody(r as MailBody) };
    }

    case "attachment": {
      const folder = (act.folder ?? "INBOX").trim() || "INBOX";
      if (!folderAllowed(folder)) {
        return { text: `Der Ordner "${folder}" ist nicht freigegeben.` };
      }
      const r = await callMail(account, { ...act, folder });
      const maxBytes = limits.attachmentMb * 1024 * 1024;
      if (r.size > maxBytes) {
        return {
          text:
            `Der Anhang "${r.filename}" ist ${mb(r.size)} MB groß, erlaubt sind ${limits.attachmentMb} MB.`,
        };
      }
      return {
        text:
          `Anhang "${r.filename}" (${r.contentType}, ${mb(r.size)} MB) steht zum Herunterladen bereit.`,
        attachment: {
          filename: r.filename,
          contentType: r.contentType,
          size: r.size,
          dataUrl: `data:${r.contentType};base64,${r.data}`,
        },
      };
    }

    case "draft": {
      if (!limits.allowDrafts) {
        return { text: "Entwürfe zu speichern ist nicht freigegeben." };
      }
      const r = await callMail(account, act);
      return {
        text: `Entwurf an ${r.to} im Ordner "${r.folder}" gespeichert.`,
      };
    }

    case "send": {
      if (!limits.allowSend) {
        return {
          text:
            "Mails zu versenden ist nicht freigegeben. Ich kann stattdessen einen Entwurf speichern.",
        };
      }
      const r = await callMail(account, act);
      return {
        text: `Mail an ${(r.to ?? []).join(", ")} gesendet.` +
          (r.copiedTo ? ` Kopie in "${r.copiedTo}".` : ""),
      };
    }

    default:
      // deno-lint-ignore no-explicit-any
      return { text: `Unbekannter Postfach-Befehl "${(act as any).action}".` };
  }
}

// --------------------------------------------------------------- formatting

/** A listing the model can reason over: one line per message, with the UID. */
function formatHeaders(
  messages: MailHeader[],
  folder: string,
  total: number,
): string {
  if (messages.length === 0) return `Keine Treffer in "${folder}".`;
  const lines = messages.map((m) =>
    `[${m.uid}] ${shortDate(m.date)} | ${m.fromName || m.from} | ${
      m.subject || "(kein Betreff)"
    }`
  );
  const head = total > messages.length
    ? `${messages.length} von ${total} Treffern in "${folder}" (neueste zuerst):`
    : `${messages.length} Treffer in "${folder}" (neueste zuerst):`;
  return [head, ...lines].join("\n");
}

function formatBody(m: MailBody): string {
  const parts = [
    `Von: ${m.from}`,
    `An: ${m.to}`,
    m.cc ? `Kopie: ${m.cc}` : "",
    `Datum: ${m.date}`,
    `Betreff: ${m.subject}`,
    "",
    m.text || "(kein Text)",
  ].filter(Boolean);

  if (m.truncated) {
    parts.push("", `[gekürzt - die Mail hat ${m.fullLength} Zeichen]`);
  }
  if (m.attachments.length) {
    parts.push("", "Anhänge:");
    for (const a of m.attachments) {
      parts.push(`  ${a.index}: ${a.filename} (${a.contentType}, ${kb(a.size)})`);
    }
  }
  return parts.join("\n");
}

function shortDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value.slice(0, 16);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${
    p(d.getHours())
  }:${p(d.getMinutes())}`;
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
