import { Handlers } from "$fresh/server.ts";
import {
  getCatalog,
  isOpenRouterKey,
  orFetch,
  routeHeader,
  withAttempts,
} from "../../utils/openrouter.ts";

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

/* ==================== OpenRouter transcription ==================== */

/**
 * Keeps the model transcribing instead of answering.
 *
 * Handed an audio clip, a chat model's first instinct is to reply to what was
 * said. The middleware guards against that with the same kind of instruction,
 * and it is the reason a plain "transcribe this" prompt is not enough.
 */
const TRANSCRIBE_GUARD =
  "ROLE: You are a strict speech-to-text transcriber.\n" +
  "TASK: Transcribe the spoken words in the audio verbatim.\n" +
  "RULES: Do NOT answer questions, do NOT summarise, do NOT translate, do NOT " +
  "add speaker labels or prefixes such as 'Assistant:'. Keep the original " +
  "language. Return ONLY the transcript text, nothing else.";

/** Audio formats OpenRouter's input_audio part accepts, by file extension. */
function audioFormat(file: File): string {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (name.endsWith(".wav") || type.includes("wav")) return "wav";
  if (name.endsWith(".mp3") || type.includes("mpeg")) return "mp3";
  if (name.endsWith(".ogg") || type.includes("ogg")) return "ogg";
  if (name.endsWith(".flac") || type.includes("flac")) return "flac";
  if (name.endsWith(".m4a") || type.includes("m4a")) return "m4a";
  if (name.endsWith(".webm") || type.includes("webm")) return "webm";
  return "wav";
}

function toBase64(bytes: Uint8Array): string {
  // Chunked so a long recording does not blow the argument limit of apply().
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Transcribes via OpenRouter.
 *
 * OpenRouter has no Whisper-style endpoint for these models - asking
 * /audio/transcriptions for a Gemini model answers "model does not exist" - so
 * the audio goes into a chat completion as an `input_audio` part and the
 * transcript comes back as the assistant's text.
 */
async function transcribeWithOpenRouter(
  audioFile: File,
  key: string,
  overrideModel: string,
  referer: string,
): Promise<{ text: string; route: string }> {
  const bytes = new Uint8Array(await audioFile.arrayBuffer());
  const data = toBase64(bytes);
  const format = audioFormat(audioFile);
  const cat = await getCatalog();

  const outcome = await withAttempts(cat, "asr", overrideModel, async (model, policy, level) => {
    const { resp } = await orFetch(key, "/chat/completions", {
      model: model.id,
      temperature: 0,
      ...(policy ? { provider: policy } : {}),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: TRANSCRIBE_GUARD },
          { type: "input_audio", input_audio: { data, format } },
        ],
      }],
    }, { model, level, referer });

    const body = await resp.json().catch(() => null);
    if (!resp.ok || body?.error) {
      const msg = body?.error?.message ?? `HTTP ${resp.status}`;
      throw new Error(`OpenRouter ASR: ${msg}`);
    }
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("OpenRouter ASR: no text in response");
    return text;
  });

  // Some models still lead with a label despite the guard.
  const cleaned = outcome.value.trim().replace(/^(assistant|transcript)\s*:\s*/i, "");
  return { text: cleaned, route: routeHeader(outcome) };
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
      // Nur für OpenRouter; getrennt gehalten, damit ein alter
      // Whisper-Modellname nicht als OpenRouter-Modell verstanden wird.
      const orModel = ((formData.get("orModel") as string | null) ?? "").trim();

      if (!audioFile) {
        return new Response("No audio file uploaded", { status: 400 });
      }

      // An OpenRouter key skips the middleware entirely: we transcribe here.
      if (isOpenRouterKey(universalApiKey)) {
        const origin = (() => {
          try {
            return new URL(req.url).origin;
          } catch {
            return "";
          }
        })();
        try {
          const { text, route } = await transcribeWithOpenRouter(
            audioFile,
            universalApiKey,
            orModel,
            origin,
          );
          return new Response(text, {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-OpenRouter-Route": route,
            },
          });
        } catch (err) {
          console.error("[OR] STT failed:", err);
          return new Response(`STT failed: ${err}`, { status: 502 });
        }
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
