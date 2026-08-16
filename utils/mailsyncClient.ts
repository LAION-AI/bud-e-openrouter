/**
 * @file mailsyncClient.ts
 * @description Browser side of the mailbox sync: the account settings kept in
 *              localStorage, collecting the local state into one snapshot,
 *              writing a snapshot back, and the calls to /api/mailsync.
 *
 *              Runs in the browser only - the server never stores any of this.
 */

import { rehydrateImages, stripImagesForStorage } from "./imageStore.ts";

export const MAIL_SETTINGS_KEY = "bud-e-mail-sync";
export const LAST_SYNC_KEY = "bud-e-mail-sync-last";
export const DIRTY_KEY = "bud-e-mail-sync-dirty";
/** Label used for snapshots written by the background upload. */
export const AUTO_LABEL = "Auto";
/** How many automatic snapshots to keep in the mailbox. */
export const KEEP_AUTO_SNAPSHOTS = 5;
export const CHAT_PREFIX = "bude-chat-";
export const SNAPSHOT_FORMAT = 1;

export interface MailAccount {
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapStartTls: boolean;
  imapUser: string;
  imapPass: string;
  folder: string;

  useSmtp: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  smtpStartTls: boolean;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  toAddress: string;

  /** upload a fresh snapshot in the background after changes */
  autoUpload: boolean;
  /** offer/pull the newest snapshot when the app starts */
  autoDownload: boolean;
  deviceName: string;
}

export const DEFAULT_MAIL_ACCOUNT: MailAccount = {
  imapHost: "",
  imapPort: 993,
  imapTls: true,
  imapStartTls: false,
  imapUser: "",
  imapPass: "",
  folder: "INBOX",

  useSmtp: false,
  smtpHost: "",
  smtpPort: 587,
  smtpTls: false,
  smtpStartTls: true,
  smtpUser: "",
  smtpPass: "",
  fromAddress: "",
  toAddress: "",

  autoUpload: false,
  autoDownload: false,
  deviceName: "",
};

export interface SnapshotSummary {
  id: string;
  created: string;
  label: string;
  device: string;
  parts: number;
  uids: number[];
  totalBytes: number;
  rawBytes: number;
  complete: boolean;
  subject: string;
}

/** Settings that describe preferences, never credentials. */
const SYNCED_PREF_KEYS = [
  "bud-e-system-prompt",
  "bud-e-model",
  "bud-e-api-url",
  "bud-e-tts-url",
  "bud-e-tts-model",
  "bud-e-stt-url",
  "bud-e-stt-model",
  "bud-e-vlm-url",
  "bud-e-vlm-model",
  "bud-e-vlm-correction-model",
];

// ------------------------------------------------------------- persistence

export function loadMailAccount(): MailAccount {
  try {
    const raw = localStorage.getItem(MAIL_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_MAIL_ACCOUNT };
    return { ...DEFAULT_MAIL_ACCOUNT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_MAIL_ACCOUNT };
  }
}

export function saveMailAccount(account: MailAccount) {
  localStorage.setItem(MAIL_SETTINGS_KEY, JSON.stringify(account));
}

/** Enough configured to talk to the mailbox at all. */
export function isMailSyncConfigured(a: MailAccount): boolean {
  return !!(a.imapHost && a.imapUser && a.imapPass);
}

export function getLastSync(): string {
  return localStorage.getItem(LAST_SYNC_KEY) ?? "";
}

export function setLastSync(created: string) {
  localStorage.setItem(LAST_SYNC_KEY, created);
}

/**
 * "There are local changes that are not in the mailbox yet." Kept in
 * localStorage so a page reload does not lose the information - otherwise the
 * start-up check could silently pull a remote snapshot over unsaved work.
 */
export function markDirty() {
  localStorage.setItem(DIRTY_KEY, "1");
}

export function clearDirty() {
  localStorage.removeItem(DIRTY_KEY);
}

export function isDirty(): boolean {
  return localStorage.getItem(DIRTY_KEY) === "1";
}

/** Only the fields the server needs; the UI-only flags stay here. */
export function accountForRequest(a: MailAccount) {
  const {
    autoUpload: _u,
    autoDownload: _d,
    deviceName: _n,
    ...rest
  } = a;
  return rest;
}

// ----------------------------------------------------------------- snapshot

/**
 * Collects everything this browser holds: every chat with its images pulled
 * back out of IndexedDB, plus the non-secret preferences.
 */
export async function collectSnapshot(deviceName: string): Promise<string> {
  const chats: Record<string, unknown> = {};
  const keys = Object.keys(localStorage).filter((k) => k.startsWith(CHAT_PREFIX));

  for (const key of keys) {
    const suffix = key.slice(CHAT_PREFIX.length);
    let messages: unknown;
    try {
      messages = JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      continue;
    }
    if (!Array.isArray(messages)) continue;
    try {
      chats[key] = await rehydrateImages(messages, suffix);
    } catch {
      // Better an export without one image than no export at all.
      chats[key] = messages;
    }
  }

  const prefs: Record<string, string> = {};
  for (const key of SYNCED_PREF_KEYS) {
    const value = localStorage.getItem(key);
    if (value) prefs[key] = value;
  }

  return JSON.stringify({
    budeSnapshot: SNAPSHOT_FORMAT,
    created: new Date().toISOString(),
    device: deviceName,
    chats,
    prefs,
  });
}

export interface ApplyResult {
  chats: number;
  prefs: number;
  firstSuffix: string;
}

/**
 * Writes a snapshot into this browser. Existing chats with the same key are
 * overwritten; chats that only exist locally are kept.
 */
export async function applySnapshot(
  json: string,
  options: { replaceAll?: boolean; restorePrefs?: boolean } = {},
): Promise<ApplyResult> {
  const data = JSON.parse(json);
  if (!data || typeof data !== "object" || !data.chats) {
    throw new Error("This mail does not contain a valid BUD-E snapshot.");
  }

  if (options.replaceAll) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(CHAT_PREFIX)) localStorage.removeItem(key);
    }
  }

  let count = 0;
  let firstSuffix = "0";
  const suffixes: string[] = [];

  for (const [key, messages] of Object.entries(data.chats)) {
    if (!key.startsWith(CHAT_PREFIX) || !Array.isArray(messages)) continue;
    const suffix = key.slice(CHAT_PREFIX.length);
    suffixes.push(suffix);
    // Images go back to IndexedDB, localStorage only keeps the placeholders.
    const stripped = await stripImagesForStorage(messages, suffix);
    localStorage.setItem(key, JSON.stringify(stripped));
    count++;
  }
  if (suffixes.length) {
    firstSuffix = suffixes.sort((a, b) => Number(a) - Number(b))[0];
  }

  let prefCount = 0;
  if (options.restorePrefs && data.prefs && typeof data.prefs === "object") {
    for (const [key, value] of Object.entries(data.prefs)) {
      if (!SYNCED_PREF_KEYS.includes(key) || typeof value !== "string") continue;
      localStorage.setItem(key, value);
      prefCount++;
    }
  }

  return { chats: count, prefs: prefCount, firstSuffix };
}

// --------------------------------------------------------------- api calls

async function postJson(payload: unknown): Promise<Response> {
  return await fetch("/api/mailsync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function unwrap(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function mailsyncTest(account: MailAccount) {
  return await unwrap(
    await postJson({ action: "test", account: accountForRequest(account) }),
  );
}

export async function mailsyncList(
  account: MailAccount,
): Promise<SnapshotSummary[]> {
  const data = await unwrap(
    await postJson({ action: "list", account: accountForRequest(account) }),
  );
  return data.snapshots ?? [];
}

export async function mailsyncDelete(account: MailAccount, uids: number[]) {
  return await unwrap(
    await postJson({
      action: "delete",
      account: accountForRequest(account),
      uids,
    }),
  );
}

/** Returns the raw snapshot JSON text. */
export async function mailsyncDownload(
  account: MailAccount,
  uids: number[],
): Promise<string> {
  const res = await fetch("/api/mailsync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "download",
      account: accountForRequest(account),
      uids,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Download failed (${res.status})`);
  }
  return await res.text();
}

export async function mailsyncUpload(
  account: MailAccount,
  snapshotJson: string,
  label: string,
) {
  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({
      account: accountForRequest(account),
      label,
      device: account.deviceName,
    }),
  );
  form.append(
    "snapshot",
    new Blob([snapshotJson], { type: "application/json" }),
    "snapshot.json",
  );

  const res = await fetch("/api/mailsync", { method: "POST", body: form });
  return await unwrap(res);
}

// ----------------------------------------------------------------- display

export function formatBytes(bytes: number): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCreated(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${
    p(d.getHours())
  }:${p(d.getMinutes())}`;
}

/** A stable-ish name for this browser, so snapshots say where they came from. */
export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
    ? "Chrome"
    : /Safari\//.test(ua)
    ? "Safari"
    : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
    ? "macOS"
    : /Linux/.test(ua)
    ? "Linux"
    : "";
  return os ? `${browser} on ${os}` : browser;
}
