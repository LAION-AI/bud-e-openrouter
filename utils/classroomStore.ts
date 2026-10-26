import { DatabaseSync } from "node:sqlite";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export type Provider = "openrouter" | "requesty" | "google";
export type Feature = "chat" | "tts" | "asr" | "image" | "music";
export interface ClassroomConfig {
  models: Record<Feature, string>;
  enabled: Record<Feature, boolean>;
  ttsVoice: string;
  ttsStyle: string;
}

export interface ClassroomRecord {
  slug: string;
  salt: string;
  password_hash: string;
  provider: Provider;
  key_hint: string;
  key_iv: string;
  key_ciphertext: string;
  config: string;
  active_until: number;
  disabled: number;
  budget_usd: number;
  spent_usd: number;
  reserved_usd: number;
  active_calls: number;
  last_reservation_at: number;
  failures: number;
  lock_until: number;
}

const COOKIE = "__Host-bude-classroom";
const SESSION_MS = 12 * 60 * 60 * 1000;
const encoder = new TextEncoder();
let state: Promise<{ db: DatabaseSync; key: CryptoKey }> | undefined;

export const defaultConfig = (): ClassroomConfig => ({
  models: { chat: "", tts: "", asr: "", image: "", music: "" },
  enabled: { chat: true, tts: false, asr: false, image: false, music: false },
  ttsVoice: "",
  ttsStyle: "Sprich freundlich, klar und natürlich auf Deutsch.",
});

export function parseConfig(raw: string): ClassroomConfig {
  const saved = JSON.parse(raw) as Partial<ClassroomConfig>;
  const defaults = defaultConfig();
  return {
    models: { ...defaults.models, ...saved.models },
    enabled: { ...defaults.enabled, ...saved.enabled },
    ttsVoice: saved.ttsVoice ?? defaults.ttsVoice,
    ttsStyle: saved.ttsStyle ?? defaults.ttsStyle,
  };
}

export function validSlug(slug: string): boolean {
  return /^[a-z][a-z0-9]{2,23}$/.test(slug) &&
    !new Set([
      "my",
      "api",
      "about",
      "admin",
      "www",
      "static",
      "login",
      "logout",
      "favicon",
      "robots",
    ]).has(slug);
}

export function validPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 256 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) &&
    /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function unhex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (b) => parseInt(b, 16));
}

async function init() {
  const dir = Deno.env.get("CLASSROOM_DATA_DIR") ||
    "/var/lib/bude-classrooms";
  if (!dir.startsWith("/")) {
    throw new Error("CLASSROOM_DATA_DIR muss absolut sein");
  }
  await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
  await Deno.chmod(dir, 0o700);
  const keyPath = `${dir}/master.key`;
  try {
    const file = await Deno.open(keyPath, {
      createNew: true,
      write: true,
      mode: 0o600,
    });
    try {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      let written = 0;
      while (written < raw.length) {
        written += await file.write(raw.subarray(written));
      }
      file.syncSync();
    } finally {
      file.close();
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
  await Deno.chmod(keyPath, 0o600);
  const raw = await Deno.readFile(keyPath);
  if (raw.length !== 32) {
    throw new Error("Ungültiger Verschlüsselungsschlüssel");
  }
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  const db = new DatabaseSync(`${dir}/classrooms.sqlite`);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
  db.exec(`CREATE TABLE IF NOT EXISTS classrooms (
    slug TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    provider TEXT NOT NULL, key_hint TEXT NOT NULL, key_iv TEXT NOT NULL,
    key_ciphertext TEXT NOT NULL, config TEXT NOT NULL,
    active_until INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 1,
    budget_usd REAL NOT NULL DEFAULT 0, spent_usd REAL NOT NULL DEFAULT 0,
    reserved_usd REAL NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
    lock_until INTEGER NOT NULL DEFAULT 0,
    active_calls INTEGER NOT NULL DEFAULT 0,
    last_reservation_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS classroom_sessions (
    token_hash TEXT PRIMARY KEY, slug TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS classroom_rate (
    slug TEXT NOT NULL, minute INTEGER NOT NULL, requests INTEGER NOT NULL,
    PRIMARY KEY(slug, minute)
  );
  CREATE TABLE IF NOT EXISTS classroom_model_checks (
    slug TEXT NOT NULL, feature TEXT NOT NULL, model TEXT NOT NULL,
    checked_at INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(slug, feature, model)
  );`);
  const columns = db.prepare("PRAGMA table_info(classrooms)").all() as Array<
    { name: string }
  >;
  if (!columns.some((column) => column.name === "active_calls")) {
    db.exec(
      "ALTER TABLE classrooms ADD COLUMN active_calls INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!columns.some((column) => column.name === "last_reservation_at")) {
    db.exec(
      "ALTER TABLE classrooms ADD COLUMN last_reservation_at INTEGER NOT NULL DEFAULT 0",
    );
  }
  await Deno.chmod(`${dir}/classrooms.sqlite`, 0o600);
  return { db, key };
}

async function store() {
  return await (state ??= init());
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, unhex(salt), 64, { N: 16384, r: 8, p: 1 })
    .toString("hex");
}

async function tokenHash(token: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(token)),
    ),
  );
}

async function seal(
  secret: string,
  slug: string,
): Promise<{ iv: string; ciphertext: string }> {
  const { key } = await store();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(slug) },
      key,
      encoder.encode(secret),
    ),
  );
  return { iv: hex(iv), ciphertext: hex(bytes) };
}

async function unseal(row: ClassroomRecord): Promise<string> {
  const { key } = await store();
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unhex(row.key_iv),
      additionalData: encoder.encode(row.slug),
    },
    key,
    unhex(row.key_ciphertext),
  );
  return new TextDecoder().decode(plain);
}

export async function findClassroom(
  slug: string,
): Promise<ClassroomRecord | null> {
  const { db } = await store();
  return (db.prepare("SELECT * FROM classrooms WHERE slug=?").get(
    slug,
  ) as unknown as ClassroomRecord | undefined) ?? null;
}

export async function createClassroom(
  slug: string,
  password: string,
  provider: Provider,
  secret: string,
): Promise<boolean> {
  const { db } = await store();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const encrypted = await seal(secret, slug);
  try {
    db.prepare(`INSERT INTO classrooms
      (slug, salt, password_hash, provider, key_hint, key_iv, key_ciphertext, config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      slug,
      salt,
      hashPassword(password, salt),
      provider,
      `••••${secret.slice(-4)}`,
      encrypted.iv,
      encrypted.ciphertext,
      JSON.stringify(defaultConfig()),
    );
    return true;
  } catch (error) {
    if (String(error).includes("UNIQUE constraint")) return false;
    throw error;
  }
}

export async function verifyPassword(
  slug: string,
  password: string,
): Promise<boolean> {
  const { db } = await store();
  const row = await findClassroom(slug);
  const now = Date.now();
  if (row?.lock_until && row.lock_until > now) return false;
  const expected = row?.password_hash ??
    hashPassword("not-the-password", "00000000000000000000000000000000");
  const actual = hashPassword(
    password,
    row?.salt ?? "00000000000000000000000000000000",
  );
  const okay = !!row &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  if (row) {
    if (okay) {
      db.prepare("UPDATE classrooms SET failures=0, lock_until=0 WHERE slug=?")
        .run(slug);
    } else {db.prepare(`UPDATE classrooms SET failures=failures+1,
      lock_until=CASE WHEN failures+1>=5 THEN ? ELSE lock_until END WHERE slug=?`)
        .run(now + 180_000, slug);}
  }
  return okay;
}

export async function issueSession(slug: string): Promise<string> {
  const { db } = await store();
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  db.prepare(
    "INSERT INTO classroom_sessions (token_hash, slug, expires_at) VALUES (?, ?, ?)",
  )
    .run(await tokenHash(token), slug, Date.now() + SESSION_MS);
  return token;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${
    SESSION_MS / 1000
  }`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function sessionSlug(req: Request): Promise<string | null> {
  const token = req.headers.get("cookie")?.match(
    new RegExp(`(?:^|; )${COOKIE}=([0-9a-f]{64})`),
  )?.[1];
  if (!token) return null;
  const { db } = await store();
  const session = db.prepare(
    "SELECT slug FROM classroom_sessions WHERE token_hash=? AND expires_at>?",
  )
    .get(await tokenHash(token), Date.now()) as { slug: string } | undefined;
  return session?.slug ?? null;
}

export async function revokeSession(req: Request): Promise<void> {
  const token = req.headers.get("cookie")?.match(
    new RegExp(`(?:^|; )${COOKIE}=([0-9a-f]{64})`),
  )?.[1];
  if (!token) return;
  const { db } = await store();
  db.prepare("DELETE FROM classroom_sessions WHERE token_hash=?").run(
    await tokenHash(token),
  );
}

export async function updateClassroom(
  slug: string,
  config: ClassroomConfig,
  budgetUsd: number,
  activeUntil: number,
  disabled: boolean,
): Promise<void> {
  const { db } = await store();
  db.prepare(
    `UPDATE classrooms SET config=?, budget_usd=?, active_until=?, disabled=? WHERE slug=?`,
  )
    .run(
      JSON.stringify(config),
      budgetUsd,
      activeUntil,
      Number(disabled),
      slug,
    );
}

export async function replaceSecret(
  slug: string,
  provider: Provider,
  secret: string,
): Promise<void> {
  const { db } = await store();
  const encrypted = await seal(secret, slug);
  db.prepare(
    `UPDATE classrooms SET provider=?, key_hint=?, key_iv=?, key_ciphertext=?,
    config=?, disabled=1, active_until=0 WHERE slug=?`,
  )
    .run(
      provider,
      `••••${secret.slice(-4)}`,
      encrypted.iv,
      encrypted.ciphertext,
      JSON.stringify(defaultConfig()),
      slug,
    );
  db.prepare("DELETE FROM classroom_model_checks WHERE slug=?").run(slug);
}

export async function modelChecks(slug: string): Promise<
  Array<{
    feature: Feature;
    model: string;
    checked_at: number;
    ok: number;
    error: string;
  }>
> {
  const { db } = await store();
  return db.prepare(
    "SELECT feature, model, checked_at, ok, error FROM classroom_model_checks WHERE slug=?",
  ).all(slug) as unknown as Array<{
    feature: Feature;
    model: string;
    checked_at: number;
    ok: number;
    error: string;
  }>;
}

export async function recordModelCheck(
  slug: string,
  feature: Feature,
  model: string,
  ok: boolean,
  error = "",
): Promise<void> {
  const { db } = await store();
  db.prepare(`INSERT INTO classroom_model_checks
    (slug, feature, model, checked_at, ok, error) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug, feature, model) DO UPDATE SET
    checked_at=excluded.checked_at, ok=excluded.ok, error=excluded.error`).run(
    slug,
    feature,
    model,
    Date.now(),
    Number(ok),
    error.slice(0, 250),
  );
}

export async function reserveSpend(
  slug: string,
  amount: number,
  requireActive = true,
): Promise<{ row: ClassroomRecord; secret: string } | null> {
  const { db } = await store();
  db.exec("BEGIN IMMEDIATE");
  let row: ClassroomRecord | null = null;
  try {
    const now = Date.now();
    db.prepare(`UPDATE classrooms SET reserved_usd=0, active_calls=0
      WHERE slug=? AND last_reservation_at<?`).run(slug, now - 10 * 60_000);
    row = db.prepare("SELECT * FROM classrooms WHERE slug=?")
      .get(slug) as unknown as ClassroomRecord | null;
    const minute = Math.floor(now / 60_000);
    db.prepare("DELETE FROM classroom_rate WHERE slug=? AND minute<?").run(
      slug,
      minute - 2,
    );
    const rate = db.prepare(
      "SELECT requests FROM classroom_rate WHERE slug=? AND minute=?",
    )
      .get(slug, minute) as { requests: number } | undefined;
    if (
      !row ||
      (requireActive && (row.disabled || row.active_until <= Date.now())) ||
      row.budget_usd <= 0 ||
      row.spent_usd + row.reserved_usd + amount > row.budget_usd ||
      row.active_calls >= 50 || (rate?.requests ?? 0) >= 90
    ) {
      db.exec("ROLLBACK");
      return null;
    }
    db.prepare(
      "UPDATE classrooms SET reserved_usd=reserved_usd+?, active_calls=active_calls+1, last_reservation_at=? WHERE slug=?",
    )
      .run(amount, now, slug);
    db.prepare(
      `INSERT INTO classroom_rate (slug, minute, requests) VALUES (?, ?, 1)
      ON CONFLICT(slug, minute) DO UPDATE SET requests=requests+1`,
    ).run(slug, minute);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  try {
    return { row: row!, secret: await unseal(row!) };
  } catch (error) {
    await finishSpend(slug, amount, amount);
    throw error;
  }
}

export async function finishSpend(
  slug: string,
  reserved: number,
  actual: number,
): Promise<void> {
  const { db } = await store();
  db.prepare(`UPDATE classrooms SET reserved_usd=MAX(0, reserved_usd-?),
    active_calls=MAX(0, active_calls-1), spent_usd=spent_usd+? WHERE slug=?`)
    .run(reserved, Math.max(0, actual), slug);
}

/** Only call after authenticating the teacher. Never return this to a client. */
export async function serverSecret(row: ClassroomRecord): Promise<string> {
  return await unseal(row);
}
