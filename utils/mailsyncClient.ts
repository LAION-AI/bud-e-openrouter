/**
 * @file mailsyncClient.ts
 * @description Browser side of the mailbox sync: the account settings kept in
 *              localStorage, collecting the local state into one snapshot,
 *              writing a snapshot back, and the calls to /api/mailsync.
 *
 *              Runs in the browser only - the server never stores any of this.
 */

import { rehydrateImages, stripImagesForStorage } from "./imageStore.ts";
import { collectNotebooks, restoreNotebooks } from "./notebookStore.ts";

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

/**
 * Prefilled with Schuldock, the mail host the classes here use.
 *
 * Server names and ports are the part people get wrong, so they are filled in
 * and only the login name and password are left to type. Anyone on a different
 * provider picks one from the list in the settings and overwrites all of it.
 */
export const DEFAULT_MAIL_ACCOUNT: MailAccount = {
  imapHost: "imap.mail.schuldock.de",
  imapPort: 993,
  imapTls: true,
  imapStartTls: false,
  imapUser: "",
  imapPass: "",
  folder: "INBOX",

  useSmtp: true,
  smtpHost: "smtp.mail.schuldock.de",
  smtpPort: 465,
  smtpTls: true,
  smtpStartTls: false,
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
    notebooks: collectNotebooks(),
  });
}

export interface ApplyResult {
  chats: number;
  prefs: number;
  notebooks: number;
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

  const notebookCount = restoreNotebooks(data.notebooks);

  return {
    chats: count,
    prefs: prefCount,
    notebooks: notebookCount,
    firstSuffix,
  };
}

// --------------------------------------------------------------- api calls

// ------------------------------------------------------------- key ring

/**
 * One saved set of credentials. URL and model travel with the key because a
 * key on its own is useless - it always belongs to a particular endpoint.
 */
export interface KeyEntry {
  id: string;
  label: string;
  created: string;
  universalApiKey: string;
  apiUrl: string;
  apiKey: string;
  apiModel: string;
  ttsUrl: string;
  ttsKey: string;
  ttsModel: string;
  sttUrl: string;
  sttKey: string;
  sttModel: string;
  vlmUrl: string;
  vlmKey: string;
  vlmModel: string;
  vlmCorrectionModel: string;
}

/** The settings fields a key entry carries. */
export const KEY_FIELDS = [
  "universalApiKey",
  "apiUrl",
  "apiKey",
  "apiModel",
  "ttsUrl",
  "ttsKey",
  "ttsModel",
  "sttUrl",
  "sttKey",
  "sttModel",
  "vlmUrl",
  "vlmKey",
  "vlmModel",
  "vlmCorrectionModel",
] as const;

export type KeySettings = Record<(typeof KEY_FIELDS)[number], string>;

/** Builds an entry from the settings currently active in this browser. */
export function keyEntryFromSettings(
  settings: Partial<KeySettings>,
  label: string,
): KeyEntry {
  const entry = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    label: label.trim() || "Unbenannt",
    created: new Date().toISOString(),
  } as KeyEntry;
  for (const field of KEY_FIELDS) {
    (entry as unknown as Record<string, string>)[field] = settings[field] ?? "";
  }
  return entry;
}

/** True when the entry carries no usable credential at all. */
export function keyEntryIsEmpty(entry: KeyEntry): boolean {
  return !entry.universalApiKey && !entry.apiKey && !entry.ttsKey &&
    !entry.sttKey && !entry.vlmKey;
}

/** Shows a key without revealing it: "sbe-abc...xyz9" */
export function maskKey(value: string): string {
  if (!value) return "-";
  if (value.length <= 12) return value.slice(0, 3) + "...";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/** Which services an entry actually configures, for the picker list. */
export function keyEntryServices(entry: KeyEntry): string[] {
  const out: string[] = [];
  if (entry.universalApiKey) out.push("Universal");
  if (entry.apiKey) out.push("LLM");
  if (entry.ttsKey) out.push("TTS");
  if (entry.sttKey) out.push("STT");
  if (entry.vlmKey) out.push("VLM");
  return out;
}

/**
 * Merges an entry into a ring: same label replaces, everything else is kept.
 * That way "back up my keys" from a second device adds to the ring instead of
 * wiping what the first device stored.
 */
export function mergeIntoKeyring(
  ring: KeyEntry[],
  entry: KeyEntry,
): KeyEntry[] {
  const rest = ring.filter((e) =>
    e.label.trim().toLowerCase() !== entry.label.trim().toLowerCase()
  );
  return [entry, ...rest];
}

export function parseKeyring(json: string): KeyEntry[] {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.keys)) {
    throw new Error("This mail does not contain a BUD-E key ring.");
  }
  return data.keys.filter((k: unknown) =>
    !!k && typeof k === "object" && typeof (k as KeyEntry).label === "string"
  );
}

export function serialiseKeyring(keys: KeyEntry[]): string {
  return JSON.stringify({
    budeKeyring: 1,
    updated: new Date().toISOString(),
    keys,
  });
}

/** Writes one entry into this browser's settings. */
export function applyKeyEntry(entry: KeyEntry): number {
  const storageKeys: Record<string, string> = {
    universalApiKey: "bud-e-universal-api-key",
    apiUrl: "bud-e-api-url",
    apiKey: "bud-e-api-key",
    apiModel: "bud-e-model",
    ttsUrl: "bud-e-tts-url",
    ttsKey: "bud-e-tts-key",
    ttsModel: "bud-e-tts-model",
    sttUrl: "bud-e-stt-url",
    sttKey: "bud-e-stt-key",
    sttModel: "bud-e-stt-model",
    vlmUrl: "bud-e-vlm-url",
    vlmKey: "bud-e-vlm-key",
    vlmModel: "bud-e-vlm-model",
    vlmCorrectionModel: "bud-e-vlm-correction-model",
  };
  let applied = 0;
  for (const field of KEY_FIELDS) {
    const value = (entry as unknown as Record<string, string>)[field];
    if (typeof value !== "string") continue;
    localStorage.setItem(storageKeys[field], value);
    if (value) applied++;
  }
  return applied;
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
  kind: "memory" | "keys" = "memory",
): Promise<SnapshotSummary[]> {
  const data = await unwrap(
    await postJson({
      action: "list",
      account: accountForRequest(account),
      kind,
    }),
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
  kind: "memory" | "keys" = "memory",
) {
  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({
      account: accountForRequest(account),
      label,
      device: account.deviceName,
      kind,
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

// ------------------------------------------------------- key ring transport

/** Newest key-ring mail in the folder, or null when there is none. */
export async function keyringNewest(
  account: MailAccount,
): Promise<SnapshotSummary | null> {
  const list = await mailsyncList(account, "keys");
  return list.find((s) => s.complete) ?? null;
}

/** Loads the ring from a specific mail (or the newest one). */
export async function keyringLoad(
  account: MailAccount,
  uids?: number[],
): Promise<KeyEntry[]> {
  let ids = uids;
  if (!ids) {
    const newest = await keyringNewest(account);
    if (!newest) return [];
    ids = newest.uids;
  }
  return parseKeyring(await mailsyncDownload(account, ids));
}

/**
 * Stores the current settings in the mailbox under `label`.
 *
 * Reads the existing ring first and merges, so backing up from a second
 * device adds to the collection rather than replacing it. The old mails are
 * removed afterwards - only the newest ring is ever needed, and leaving the
 * previous copies around would leave the old keys readable in the mailbox.
 */
export async function keyringSave(
  account: MailAccount,
  settings: Partial<KeySettings>,
  label: string,
): Promise<{ entries: number; replaced: boolean }> {
  const entry = keyEntryFromSettings(settings, label);
  if (keyEntryIsEmpty(entry)) {
    throw new Error("There is no API key configured in this browser yet.");
  }

  let existing: SnapshotSummary[] = [];
  let ring: KeyEntry[] = [];
  try {
    existing = await mailsyncList(account, "keys");
    const newest = existing.find((s) => s.complete);
    if (newest) ring = parseKeyring(await mailsyncDownload(account, newest.uids));
  } catch {
    // An unreadable old ring must not block storing a new one.
    ring = [];
  }

  const replaced = ring.some((e) =>
    e.label.trim().toLowerCase() === entry.label.trim().toLowerCase()
  );
  const merged = mergeIntoKeyring(ring, entry);

  await mailsyncUpload(
    account,
    serialiseKeyring(merged),
    `Keys (${merged.length})`,
    "keys",
  );

  const stale = existing.flatMap((s) => s.uids);
  if (stale.length) {
    await mailsyncDelete(account, stale).catch(() => {
      // The new ring is stored; a leftover old mail is not worth failing over.
    });
  }
  return { entries: merged.length, replaced };
}

/** Removes one entry from the ring and writes it back. */
export async function keyringRemove(
  account: MailAccount,
  entryId: string,
): Promise<number> {
  const existing = await mailsyncList(account, "keys");
  const newest = existing.find((s) => s.complete);
  if (!newest) return 0;

  const ring = parseKeyring(await mailsyncDownload(account, newest.uids));
  const remaining = ring.filter((e) => e.id !== entryId);

  if (remaining.length > 0) {
    await mailsyncUpload(
      account,
      serialiseKeyring(remaining),
      `Keys (${remaining.length})`,
      "keys",
    );
  }
  await mailsyncDelete(account, existing.flatMap((s) => s.uids));
  return remaining.length;
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
