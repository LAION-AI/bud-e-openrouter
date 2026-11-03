import type { Handlers } from "$fresh/server.ts";
import { validSlug } from "../../utils/classroomStore.ts";
import {
  fromBase64,
  PERSONAL_KDF_ITERATIONS,
  toBase64,
} from "../../utils/personalCrypto.ts";
import {
  personalCookie,
  PersonalError,
  personalSession,
  personalStore,
} from "../../utils/personalStore.ts";

function json(value: unknown, status = 200, cookie?: string) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}
function originAllowed(req: Request) {
  try {
    const origin = new URL(req.headers.get("origin") ?? "");
    return origin.protocol === "https:" &&
      origin.host === new URL(req.url).host;
  } catch {
    return false;
  }
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    throw new PersonalError("JSON-Anfrage erwartet.", 415);
  }
  const reader = req.body?.getReader();
  if (!reader) throw new PersonalError("Leere Anfrage.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 8 * 1024 * 1024) {
        throw new PersonalError(
          "Speicherpaket zu groß. Bitte weniger Bilder auf einmal wählen.",
          413,
        );
      }
      parts.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  try {
    const data = JSON.parse(await new Blob(parts).text());
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error();
    }
    return data;
  } catch {
    throw new PersonalError("Ungültige Anfrage.");
  }
}
function failure(error: unknown) {
  return error instanceof PersonalError
    ? json({ error: error.message }, error.status)
    : json({
      error:
        "Der persönliche Speicher ist gerade nicht verfügbar. Bitte erneut versuchen.",
    }, 500);
}
export const handler: Handlers = {
  async GET(req) {
    try {
      const url = new URL(req.url),
        slug = (url.searchParams.get("slug") ?? "").toLowerCase();
      if (!validSlug(slug)) throw new PersonalError("Ungültiger Raumname.");
      const store = await personalStore();
      if (url.searchParams.get("action") === "public") {
        const row = store.publicInfo(slug);
        if (!row) {
          return json({
            exists: false,
            error: "Diesen persönlichen Raum gibt es nicht.",
          }, 404);
        }
        return json({
          exists: true,
          salt: row.salt,
          kdf: "PBKDF2-SHA256-HKDF-SHA256",
          iterations: PERSONAL_KDF_ITERATIONS,
        });
      }
      store.authenticate(personalSession(req), slug);
      const id = url.searchParams.get("id");
      if (id) {
        const record = store.read(slug, id);
        return json({
          revision: record.revision,
          value: toBase64(record.value),
        });
      }
      return json(store.manifest(slug));
    } catch (error) {
      return failure(error);
    }
  },
  async POST(req) {
    try {
      if (!originAllowed(req)) {
        throw new PersonalError(
          "Nur über die eigene sichere Buddy-Seite nutzbar.",
          403,
        );
      }
      const data = await body(req), store = await personalStore();
      if (
        Object.keys(data).some((key) =>
          !["action", "slug", "salt", "auth", "value"].includes(key)
        )
      ) {
        throw new PersonalError(
          "Unerwartete Anmeldedaten. Das Passwort gehört nicht auf den Server.",
        );
      }
      if (data.action === "logout") {
        store.logout(personalSession(req));
        return json({ ok: true }, 200, personalCookie(""));
      }
      const slug = String(data.slug ?? "").toLowerCase();
      if (!validSlug(slug)) {
        throw new PersonalError(
          "Bitte einen Namen mit 3–24 Kleinbuchstaben oder Ziffern wählen, beginnend mit einem Buchstaben.",
        );
      }
      const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")
        .at(-1)!
        .trim();
      store.limit(
        `personal:${String(data.action)}:${ip}`,
        data.action === "register" ? 10 : 120,
        data.action === "register" ? 3600000 : 600000,
      );
      if (!/^[a-f0-9]{64}$/.test(String(data.auth ?? ""))) {
        throw new PersonalError("Ungültige Anmeldedaten.");
      }
      if (data.action === "register") {
        if (typeof data.value !== "string" || typeof data.salt !== "string") {
          throw new PersonalError("Verschlüsselter Anfangsstand fehlt.");
        }
        store.create(
          slug,
          data.salt,
          String(data.auth),
          fromBase64(data.value),
        );
      } else if (data.action !== "login") {
        throw new PersonalError("Unbekannte Aktion.");
      }
      const session = store.login(slug, String(data.auth));
      return json({ ok: true }, 200, personalCookie(session));
    } catch (error) {
      return failure(error);
    }
  },
  async PUT(req) {
    try {
      if (!originAllowed(req)) {
        throw new PersonalError(
          "Nur über die eigene sichere Buddy-Seite nutzbar.",
          403,
        );
      }
      const data = await body(req),
        slug = String(data.slug ?? "").toLowerCase(),
        store = await personalStore();
      store.authenticate(personalSession(req), slug);
      store.limit("personal-write:" + slug, 120, 60000);
      if (
        Object.keys(data).some((key) =>
          !["slug", "writes", "deletes"].includes(key)
        ) || !Array.isArray(data.writes) ||
        (data.deletes !== undefined && !Array.isArray(data.deletes))
      ) throw new PersonalError("Ungültiges Speicherpaket.");
      const writes = data.writes.map((raw: unknown) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new PersonalError("Ungültige Datei.");
        }
        const row = raw as Record<string, unknown>;
        if (
          typeof row.value !== "string" || typeof row.id !== "string" ||
          typeof row.revision !== "number"
        ) throw new PersonalError("Ungültige Datei.");
        return {
          id: row.id,
          revision: row.revision,
          value: fromBase64(row.value),
        };
      });
      const deletes = ((data.deletes ?? []) as unknown[]).map(
        (raw: unknown) => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new PersonalError("Ungültiger Löschvorgang.");
          }
          const row = raw as Record<string, unknown>;
          return { id: String(row.id ?? ""), revision: Number(row.revision) };
        },
      );
      return json(store.save(slug, writes, deletes));
    } catch (error) {
      return failure(error);
    }
  },
};
