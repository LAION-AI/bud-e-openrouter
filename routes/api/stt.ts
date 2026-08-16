import { Handlers } from "$fresh/server.ts";

/* ========================= ENV CONFIG ========================= */
const STT_KEY          = (Deno.env.get("STT_KEY")          || "").trim();
const STT_MODEL        = (Deno.env.get("STT_MODEL")        || "").trim();
const STT_URL          = (Deno.env.get("STT_URL")          || "").trim();
const MIDDLEWARE_BASE  = (Deno.env.get("MIDDLEWARE_URL")   || "").trim();

/* ================================================================
   Universal-Key Suffix decoding
   Backend encodes "<host>:<port>" as:
     token = "v1" + Base32( bytes(host:port) XOR 0x5A )   (no '=' padding)
   We also support:
     - http(s)://<host>[:port]
     - <host>:<port>
================================================================ */

/** RFC4648 Base32 decode (padding optional). Throws on bad chars. */
function base32DecodeNoPadding(s: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.trim().toUpperCase().replace(/=+$/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) throw new Error("Invalid Base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** "host:port" → "http://host:port" (IPv6 → [host]) */
function hostPortToHttpBase(hostPort: string): string {
  const last = hostPort.lastIndexOf(":");
  let host = hostPort, port = "";
  if (last !== -1) {
    host = hostPort.slice(0, last);
    port = hostPort.slice(last + 1);
  }
  const isIPv6 = host.includes(":");
  const bracketHost = isIPv6 ? `[${host}]` : host;
  const portPart = port ? `:${port}` : "";
  return `http://${bracketHost}${portPart}`;
}

function stripTrailingSlashes(u: string): string {
  return u.replace(/\/+$/g, "");
}

/** Decode middleware base URL from the composite universal key (or null). */
function decodeMiddlewareBaseFromUniversalKey(universalApiKey: string | undefined | null): string | null {
  const raw = (universalApiKey || "").trim();
  const hash = raw.indexOf("#");
  if (hash < 0) return null;
  const suffix = raw.slice(hash + 1).trim();
  if (!suffix) return null;

  // 1) http(s)://...
  if (/^https?:\/\/.+/i.test(suffix)) {
    try {
      const u = new URL(suffix);
      return stripTrailingSlashes(`${u.protocol}//${u.host}`);
    } catch {
      return null;
    }
  }

  // 2) bare host:port
  if (/^[A-Za-z0-9.\-]+:\d+$/.test(suffix)) {
    return stripTrailingSlashes(hostPortToHttpBase(suffix));
  }

  // 3) encoded form: v1 + Base32(no padding) of XOR'd bytes
  if (!suffix.startsWith("v1")) return null;
  try {
    const b32 = suffix.slice(2);
    const bytes = base32DecodeNoPadding(b32);
    for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] ^ 0x5a; // un-XOR
    const hostPort = new TextDecoder().decode(bytes).trim();
    if (!/^[A-Za-z0-9.\-]+:\d+$/.test(hostPort)) return null;
    return stripTrailingSlashes(hostPortToHttpBase(hostPort));
  } catch {
    return null;
  }
}

export const handler: Handlers = {
  async POST(req) {
    try {
      const formData = await req.formData();

      // Accept both "audio" and "file" as input field names
      const audioFile =
        (formData.get("audio") as File | null) ??
        (formData.get("file") as File | null);

      const universalApiKey = (formData.get("universalApiKey") as string | null)?.trim() || "";

      // User-specified overrides (optional)
      let useThisSttUrl   = ((formData.get("sttUrl")   as string | null) ?? STT_URL).trim();
      let useThisSttKey   = ((formData.get("sttKey")   as string | null) ?? STT_KEY).trim();
      let useThisSttModel = ((formData.get("sttModel") as string | null) ?? STT_MODEL).trim();

      if (!audioFile) {
        return new Response("No audio file uploaded", { status: 400 });
      }

      // If a universal key is present, it overrides URL+KEY and picks middleware route
      if (universalApiKey) {
        const envBase   = MIDDLEWARE_BASE;
        const origin    = (() => { try { return new URL(req.url).origin; } catch { return ""; } })();
        const base =
          decodeMiddlewareBaseFromUniversalKey(universalApiKey) ||
          envBase ||
          origin;

        if (!base) {
          return new Response("Middleware base unavailable", { status: 400 });
        }

        useThisSttUrl   = `${stripTrailingSlashes(base)}/v1/audio/transcriptions`;
        useThisSttKey   = universalApiKey;
        if (!useThisSttModel) useThisSttModel = "whisper-1"; // safe default for middleware
      }

      // Special case: direct Groq usage when a gsk_ key is provided
      if (useThisSttKey.startsWith("gsk_")) {
        if (!useThisSttUrl) {
          useThisSttUrl = "https://api.groq.com/openai/v1/audio/transcriptions";
        }
        if (!useThisSttModel) {
          useThisSttModel = "whisper-large-v3-turbo";
        }
      }

      if (!useThisSttUrl) {
        return new Response("Missing STT URL", { status: 400 });
      }
      if (!useThisSttKey) {
        return new Response("Missing STT API key", { status: 400 });
      }
      if (!useThisSttModel) {
        // final safety default if nothing else set
        useThisSttModel = "whisper-1";
      }

      // Forward as OpenAI/Whisper-compatible multipart: file + model
      const sttFormData = new FormData();
      sttFormData.append("file", audioFile);
      sttFormData.append("model", useThisSttModel);

      const resp = await fetch(useThisSttUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${useThisSttKey}` },
        body: sttFormData,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        console.error("STT upstream error:", resp.status, resp.statusText, body);
        return new Response(`STT upstream error: ${resp.status}`, { status: 502 });
      }

      // Whisper-compatible: { text, ... }
      const json = await resp.json().catch(() => null);
      if (!json || typeof json.text !== "string") {
        // Some backends return raw text; try that before failing.
        const asText = json ? JSON.stringify(json) : await resp.text().catch(() => "");
        return new Response(asText || "", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      return new Response(json.text, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    } catch (err) {
      console.error("STT handler error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
