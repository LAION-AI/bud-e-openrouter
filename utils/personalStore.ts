import { DatabaseSync } from "node:sqlite";
import { createHash, timingSafeEqual } from "node:crypto";
import { roomDatabase, validSlug } from "./classroomStore.ts";
import { PERSONAL_MAX_OBJECT, PERSONAL_QUOTA } from "./personalCrypto.ts";

export class PersonalError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const validId = (id: string) =>
  id === "index" || /^(?:chat|img):[a-f0-9-]{36}$/.test(id);
export type PersonalWrite = { id: string; revision: number; value: Uint8Array };
export class PersonalStore {
  constructor(private db: DatabaseSync, private quota = PERSONAL_QUOTA) {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(
      `CREATE TABLE IF NOT EXISTS personal_rooms(slug TEXT PRIMARY KEY,salt TEXT NOT NULL,verifier TEXT NOT NULL,failures INTEGER NOT NULL DEFAULT 0,lock_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_objects(slug TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,value BLOB NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(slug,id));
      CREATE TABLE IF NOT EXISTS personal_sessions(token_hash TEXT PRIMARY KEY,slug TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS personal_name_guard BEFORE INSERT ON personal_rooms WHEN EXISTS(SELECT 1 FROM classrooms WHERE slug=NEW.slug) BEGIN SELECT RAISE(ABORT,'UNIQUE constraint: room name'); END;
      CREATE TRIGGER IF NOT EXISTS classroom_personal_name_guard BEFORE INSERT ON classrooms WHEN EXISTS(SELECT 1 FROM personal_rooms WHERE slug=NEW.slug) BEGIN SELECT RAISE(ABORT,'UNIQUE constraint: room name'); END;`,
    );
  }
  publicInfo(slug: string): { salt: string } | null {
    return this.db.prepare("SELECT salt FROM personal_rooms WHERE slug=?").get(
      slug,
    ) as { salt: string } | null ?? null;
  }
  limit(bucket: string, maximum: number, period: number) {
    const now = Date.now();
    this.db.prepare("DELETE FROM personal_limits WHERE until<?").run(now);
    this.db.prepare(
      "INSERT INTO personal_limits(bucket,count,until) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1",
    ).run(digest(bucket), now + period);
    const row = this.db.prepare(
      "SELECT count FROM personal_limits WHERE bucket=?",
    ).get(digest(bucket)) as { count: number };
    if (row.count > maximum) {
      throw new PersonalError(
        "Zu viele Versuche. Bitte später erneut versuchen.",
        429,
      );
    }
  }
  create(slug: string, salt: string, auth: string, value: Uint8Array) {
    if (
      !validSlug(slug) || !/^[a-f0-9]{32}$/.test(salt) ||
      !/^[a-f0-9]{64}$/.test(auth)
    ) throw new PersonalError("Name oder Anmeldedaten sind ungültig.");
    this.checkWrite({ id: "index", revision: 0, value });
    if (value.length > this.quota) {
      throw new PersonalError("Die Speichergrenze ist erreicht.", 413);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        "INSERT INTO personal_rooms(slug,salt,verifier,created_at) VALUES(?,?,?,?)",
      ).run(slug, salt, digest(slug + ":" + auth), Date.now());
      this.db.prepare(
        "INSERT INTO personal_objects(slug,id,revision,value,updated_at) VALUES(?,'index',1,?,?)",
      ).run(slug, value, Date.now());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (String(error).includes("UNIQUE constraint")) {
        throw new PersonalError(
          "Dieser Name ist bereits vergeben. Bitte einen anderen wählen.",
          409,
        );
      }
      throw error;
    }
  }
  login(slug: string, auth: string): string {
    const row = this.db.prepare("SELECT * FROM personal_rooms WHERE slug=?")
      .get(slug) as
        | { verifier: string; failures: number; lock_until: number }
        | undefined;
    const now = Date.now();
    if (row?.lock_until && row.lock_until > now) {
      throw new PersonalError(
        "Nach fünf falschen Versuchen ist der Raum für drei Minuten gesperrt.",
        429,
      );
    }
    const actual = new TextEncoder().encode(digest(slug + ":" + auth)),
      expected = new TextEncoder().encode(row?.verifier ?? digest("missing"));
    if (!row || !timingSafeEqual(actual, expected)) {
      // Increment in SQLite, not in JS: parallel workers must not lose failures.
      this.db.prepare(
        `UPDATE personal_rooms SET
        failures=CASE WHEN lock_until>0 AND lock_until<=? THEN 1 ELSE failures+1 END,
        lock_until=CASE WHEN lock_until>? THEN lock_until WHEN lock_until>0 THEN 0 WHEN failures+1>=5 THEN ? ELSE 0 END
        WHERE slug=?`,
      ).run(now, now, now + 180000, slug);
      throw new PersonalError("Name oder Passwort ist falsch.", 401);
    }
    this.db.prepare(
      "UPDATE personal_rooms SET failures=0,lock_until=0 WHERE slug=?",
    ).run(slug);
    this.db.prepare("DELETE FROM personal_sessions WHERE expires_at<?").run(
      now,
    );
    const session = token();
    this.db.prepare("INSERT INTO personal_sessions VALUES(?,?,?)").run(
      digest(session),
      slug,
      now + 12 * 60 * 60 * 1000,
    );
    return session;
  }
  authenticate(session: string, slug: string) {
    if (!/^[a-f0-9]{64}$/.test(session)) {
      throw new PersonalError(
        "Bitte den persönlichen Raum erneut entsperren.",
        401,
      );
    }
    const row = this.db.prepare(
      "SELECT slug FROM personal_sessions WHERE token_hash=? AND expires_at>?",
    ).get(digest(session), Date.now()) as { slug: string } | undefined;
    if (row?.slug !== slug) {
      throw new PersonalError(
        "Bitte den persönlichen Raum erneut entsperren.",
        401,
      );
    }
  }
  logout(session: string) {
    this.db.prepare("DELETE FROM personal_sessions WHERE token_hash=?").run(
      digest(session),
    );
  }
  manifest(slug: string) {
    const records = this.db.prepare(
      "SELECT id,revision,length(value) AS bytes,updated_at AS updatedAt FROM personal_objects WHERE slug=?",
    ).all(slug) as unknown as {
      id: string;
      revision: number;
      bytes: number;
      updatedAt: number;
    }[];
    return {
      records,
      usedBytes: records.reduce((sum, r) => sum + r.bytes, 0),
      quotaBytes: this.quota,
    };
  }
  read(slug: string, id: string) {
    if (!validId(id)) throw new PersonalError("Ungültige Datei.");
    const row = this.db.prepare(
      "SELECT revision,value FROM personal_objects WHERE slug=? AND id=?",
    ).get(slug, id) as { revision: number; value: Uint8Array } | undefined;
    if (!row) throw new PersonalError("Datei nicht gefunden.", 404);
    return row;
  }
  private checkWrite(write: PersonalWrite) {
    if (
      !validId(write.id) || !Number.isSafeInteger(write.revision) ||
      write.revision < 0 || write.value.length < 29 ||
      write.value.length > PERSONAL_MAX_OBJECT || write.value[0] !== 1
    ) throw new PersonalError("Ungültige oder zu große verschlüsselte Datei.");
  }
  save(
    slug: string,
    writes: PersonalWrite[],
    deletes: { id: string; revision: number }[] = [],
  ) {
    if (
      writes.length + deletes.length < 1 ||
      writes.length > 16 || deletes.length > 5000 ||
      new Set([...writes, ...deletes].map((w) => w.id)).size !==
        writes.length + deletes.length
    ) throw new PersonalError("Ungültiger Speichervorgang.");
    writes.forEach((write) => this.checkWrite(write));
    if (
      deletes.some((d) =>
        !validId(d.id) || d.id === "index" ||
        !Number.isSafeInteger(d.revision) || d.revision < 1
      )
    ) throw new PersonalError("Ungültiger Löschvorgang.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let size = this.manifest(slug).usedBytes;
      for (const change of [...writes, ...deletes]) {
        const old = this.db.prepare(
          "SELECT revision,length(value) AS bytes FROM personal_objects WHERE slug=? AND id=?",
        ).get(slug, change.id) as
          | { revision: number; bytes: number }
          | undefined;
        if ((old?.revision ?? 0) !== change.revision) {
          throw new PersonalError(
            "Dieser Verlauf wurde auf einem anderen Gerät geändert. Bitte zuerst die neue Version laden. Deine lokale Fassung bleibt erhalten.",
            409,
          );
        }
        size -= old?.bytes ?? 0;
      }
      size += writes.reduce((sum, w) => sum + w.value.length, 0);
      if (size > this.quota) {
        throw new PersonalError(
          "Die 100 MB sind voll. Bitte Bilder oder alte Unterhaltungen entfernen.",
          413,
        );
      }
      const count = this.manifest(slug).records.length;
      if (
        count + writes.filter((w) => w.revision === 0).length - deletes.length >
          5000
      ) throw new PersonalError("Zu viele Dateien in diesem Raum.", 413);
      for (const write of writes) {
        this.db.prepare(
          "INSERT INTO personal_objects(slug,id,revision,value,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(slug,id) DO UPDATE SET revision=excluded.revision,value=excluded.value,updated_at=excluded.updated_at",
        ).run(slug, write.id, write.revision + 1, write.value, Date.now());
      }
      for (const entry of deletes) {
        this.db.prepare("DELETE FROM personal_objects WHERE slug=? AND id=?")
          .run(slug, entry.id);
      }
      this.db.exec("COMMIT");
      return this.manifest(slug);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
let personal: Promise<PersonalStore> | undefined;
export function personalStore(): Promise<PersonalStore> {
  return personal ??= roomDatabase().then((db) => new PersonalStore(db)).catch(
    (error) => {
      personal = undefined;
      throw error;
    },
  );
}
export const PERSONAL_COOKIE = "__Host-bude-personal";
export function personalCookie(session: string) {
  return `${PERSONAL_COOKIE}=${session}; Path=/; Max-Age=${
    session ? 43200 : 0
  }; Secure; HttpOnly; SameSite=Strict`;
}
export function personalSession(req: Request) {
  return req.headers.get("cookie")?.match(
    new RegExp(`(?:^|;\\s*)${PERSONAL_COOKIE}=([a-f0-9]{64})(?:;|$)`),
  )?.[1] ?? "";
}
