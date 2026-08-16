// routes/api/tts.ts
import { Handlers } from "$fresh/server.ts";
import { Buffer } from "npm:buffer";

/* ========================= ENV CONFIG ========================= */
const TTS_KEY   = (Deno.env.get("TTS_KEY")   || "").trim();
const TTS_URL   = (Deno.env.get("TTS_URL")   || "").trim();
const TTS_MODEL = (Deno.env.get("TTS_MODEL") || "").trim();
/** Optional: bevorzugte Middleware-Basis (wenn kein Key-Suffix) */
const MIDDLEWARE_BASE_URL = (Deno.env.get("MIDDLEWARE_URL") || "").trim();

/* ================================================================
   Universal-Key-Suffix
   Backend kodiert "<host>:<port>" als:
     token = "v1" + Base32( bytes(host:port) XOR 0x5A )   (ohne '=' Padding)
   Wir unterstützen zusätzlich:
     - http(s)://<host>[:port]
     - <host>:<port> (bare)
   und bauen daraus "http(s)://host[:port]" (IPv6 bekommt Klammern).
================================================================ */

/** RFC 4648 Base32 decode, Padding optional. Wirft bei ungültigen Zeichen. */
function base32DecodeNoPadding(s: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.trim().toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const idx = alphabet.indexOf(ch);
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

/** Wandelt "host:port" in "http://host:port" (IPv6 → [host]) */
function hostPortToHttpBase(hostPort: string): string {
  // letztes ":" trennt Port; IPv6 hat mehrere ":"
  const last = hostPort.lastIndexOf(":");
  let host = hostPort;
  let port = "";
  if (last !== -1) {
    host = hostPort.slice(0, last);
    port = hostPort.slice(last + 1);
  }
  const isIPv6 = host.includes(":");
  const bracketHost = isIPv6 ? `[${host}]` : host;
  const portPart = port ? `:${port}` : "";
  return `http://${bracketHost}${portPart}`;
}

/** Entfernt alle überzähligen Slashes am Ende. */
function stripTrailingSlashes(u: string): string {
  return u.replace(/\/+$/g, "");
}

/** Decode Middleware-Base aus universalApiKey (oder null). */
function decodeMiddlewareBaseFromUniversalKey(
  universalApiKey: string | undefined | null,
): string | null {
  const raw = (universalApiKey || "").trim();
  const hash = raw.indexOf("#");
  if (hash < 0) return null;
  const suffixRaw = raw.slice(hash + 1).trim();
  if (!suffixRaw) return null;

  // 1) http(s)://...
  if (/^https?:\/\/.+/i.test(suffixRaw)) {
    try {
      const u = new URL(suffixRaw);
      return stripTrailingSlashes(`${u.protocol}//${u.host}`);
    } catch {
      return null;
    }
  }

  // 2) Bare host:port (z. B. 138.199.174.173:8787 oder myhost.local:8787)
  if (/^[A-Za-z0-9.\-]+:\d+$/.test(suffixRaw)) {
    return stripTrailingSlashes(hostPortToHttpBase(suffixRaw));
  }

  // 3) Kodiertes Schema "v1" + Base32(no padding) der XOR-Bytes
  if (!suffixRaw.startsWith("v1")) return null;
  try {
    const b32 = suffixRaw.slice(2);
    const bytes = base32DecodeNoPadding(b32);
    for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] ^ 0x5a; // un-XOR
    const hostPort = new TextDecoder().decode(bytes).trim();
    if (!/^[A-Za-z0-9.\-]+:\d+$/.test(hostPort)) return null;
    return stripTrailingSlashes(hostPortToHttpBase(hostPort));
  } catch {
    return null;
  }
}

/* ========================= JSON-BLOCK STRIPPER ========================= */
/** Entfernt alle Inhalte innerhalb von geschweiften Klammern (inkl. verschachtelt). */
function stripJsonLikeBlocks(text: string): string {
  let result = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) result += ch;
  }
  return result;
}

/* ========================= RETRY-HELPER ========================= */
async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 3,
  backoffMs = 500,
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fn();
      if (attempt > 1) {
        console.log(`[TTS] ${label} succeeded on attempt ${attempt}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      console.error(`[TTS] ${label} attempt ${attempt} failed:`, err);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
      }
    }
  }
  throw lastErr ?? new Error(`[TTS] ${label} failed after ${maxAttempts} attempts`);
}

/* ========================= MARS6 Client ========================= */
async function callMARS6API(
  text: string,
  ttsUrl: string,
  ttsKey: string,
) {
  async function createTTSTask(
    url: string,
    key: string,
    voiceID: number = 20299,
    language: number = 1,
  ) {
    const resp = await fetch(`${stripTrailingSlashes(url)}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({ text, voice_id: voiceID, language }),
    });
    const js = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error(`MARS6 create error: ${resp.status} ${resp.statusText}`, js);
      throw new Error(`MARS6 create error: ${resp.status} ${resp.statusText}`);
    }
    return js.task_id as string;
  }

  // Bounded polling: the old `for(;;)` loop only ever exited on SUCCESS, so a
  // failed or stuck task kept the HTTP request (and a client pool slot) open
  // forever.
  const POLL_TIMEOUT_MS = 60_000;
  const POLL_INTERVAL_MS = 1500;

  async function pollTTSTask(url: string, key: string, taskID: string): Promise<number> {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const resp = await fetch(`${stripTrailingSlashes(url)}/tts/${taskID}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", "x-api-key": key },
      });
      const js = await resp.json().catch(() => ({}));
      const status = String(js?.status ?? "").toUpperCase();
      console.log(`MARS6 polling: ${status || "?"}`);

      if (status === "SUCCESS") {
        return js.run_id as number;
      }
      // Terminal failure states must abort instead of polling on forever.
      if (["FAILED", "FAILURE", "ERROR", "CANCELLED", "CANCELED", "REVOKED"].includes(status)) {
        throw new Error(`MARS6 task ${taskID} ended with status ${status}`);
      }
      if (!resp.ok && resp.status >= 400 && resp.status !== 429) {
        throw new Error(`MARS6 polling error: ${resp.status} ${resp.statusText}`);
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new Error(`MARS6 task ${taskID} timed out after ${POLL_TIMEOUT_MS}ms`);
  }

  async function getTTSAudioResult(url: string, key: string, runID: number) {
    const resp = await fetch(`${stripTrailingSlashes(url)}/tts-result/${runID}`, {
      method: "GET",
      headers: { "x-api-key": key },
    });
    if (!resp.ok) {
      console.error(`MARS6 result error: ${resp.status} ${resp.statusText}`);
      throw new Error(`MARS6 result error: ${resp.status} ${resp.statusText}`);
    }
    return await resp.arrayBuffer();
  }

  const taskID = await createTTSTask(ttsUrl, ttsKey);
  const runID = await pollTTSTask(ttsUrl, ttsKey, taskID);
  const data = await getTTSAudioResult(ttsUrl, ttsKey, runID);
  if (!data) throw new Error("MARS6: no audio result");
  return data;
}

/* ========================= TTS Dispatcher ========================= */
async function textToSpeech(
  text: string,
  textPosition: string,
  ttsUrl: string,
  ttsKey: string,
  ttsModel: string,
): Promise<Buffer | null> {
  // JSON-Blöcke komplett entfernen + Markup entschärfen
  text = stripJsonLikeBlocks(String(text))
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/bud-e/gi, "buddy");

  const useThisTtsUrl   = (ttsUrl   || TTS_URL);
  const useThisTtsKey   = (ttsKey   || TTS_KEY);
  const useThisTtsModel = (ttsModel || TTS_MODEL);

  console.log("[TTS] textPos=", textPosition);
  console.log("[TTS] url=", useThisTtsUrl);
  console.log("[TTS] model=", useThisTtsModel || "(none)");

  try {
    // Fish-Audio Heuristik: 32-Hex → behandelt als Referenz-ID
    if (useThisTtsModel && /^[a-fA-F0-9]{32}$/.test(useThisTtsModel)) {
      const audioBuf = await withRetries<ArrayBuffer>("Fish", async () => {
        const t0 = Date.now();
        const resp = await fetch(useThisTtsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${useThisTtsKey}`,
          },
          body: JSON.stringify({
            text,
            normalize: true,
            format: "mp3",
            reference_id: useThisTtsModel,
            mp3_bitrate: 64,
            opus_bitrate: -1000,
            latency: "normal",
          }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Fish TTS failed: ${resp.status} ${resp.statusText} ${body}`);
        }
        const audio = await resp.arrayBuffer();
        console.log(`[TTS] Fish OK, latency=${Date.now() - t0}ms`);
        return audio;
      });
      return Buffer.from(audioBuf);
    }

    // Provider-Switch
    switch (useThisTtsModel) {
      case "MARS6": {
        const audio = await withRetries<ArrayBuffer>("MARS6", async () =>
          callMARS6API(text, useThisTtsUrl, useThisTtsKey)
        );
        return Buffer.from(audio);
      }

      case "aura-helios-en": {
        const audio = await withRetries<ArrayBuffer>("aura-helios-en", async () => {
          const t0 = Date.now();
          const resp = await fetch(useThisTtsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${useThisTtsKey}`,
            },
            body: JSON.stringify({
              model: useThisTtsModel,
              input: text,
            }),
          });
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`aura-helios-en failed: ${resp.status} ${resp.statusText} ${body}`);
          }
          const audio = await resp.arrayBuffer();
          console.log(`[TTS] aura-helios-en OK, latency=${Date.now() - t0}ms`);
          return audio;
        });
        return Buffer.from(audio);
      }

      default: {
        // OpenAI-kompatibles /v1/audio/speech (Binary-MP3)
        const audio = await withRetries<ArrayBuffer>("default", async () => {
          const t0 = Date.now();
          const resp = await fetch(useThisTtsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${useThisTtsKey}`,
            },
            body: JSON.stringify({
              model: useThisTtsModel || "tts-1",
              input: text,
            }),
          });
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`TTS default failed: ${resp.status} ${resp.statusText} ${body}`);
          }
          const audioBuf = await resp.arrayBuffer();
          console.log(`[TTS] default OK, latency=${Date.now() - t0}ms`);
          return audioBuf;
        });
        return Buffer.from(audio);
      }
    }
  } catch (err) {
    console.error("textToSpeech error:", err);
    return null;
  }
}

export const handler: Handlers = {
  async POST(req) {
    // Payload: { text, textPosition?, ttsUrl?, ttsKey?, ttsModel?, universalApiKey? }
    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    let {
      text,
      textPosition = "",
      ttsUrl = "",
      ttsKey = "",
      ttsModel = "",
      universalApiKey = "",
    } = payload || {};

    if (!text || typeof text !== "string") {
      return new Response("No text provided", { status: 400 });
    }

    // Ziel-URL/-Key bestimmen
    let useThisTtsUrl = (ttsUrl || TTS_URL);
    let useThisTtsKey = (ttsKey || TTS_KEY);
    const envBase = MIDDLEWARE_BASE_URL; // optional ENV-Basis
    const originBase = (() => {
      try { return new URL(req.url).origin; } catch { return ""; }
    })();

    if (universalApiKey) {
      const base =
        decodeMiddlewareBaseFromUniversalKey(universalApiKey) ||
        envBase ||
        originBase;

      if (!base) {
        return new Response("Middleware base unavailable", { status: 400 });
      }

      useThisTtsUrl = `${stripTrailingSlashes(base)}/v1/audio/speech`;
      useThisTtsKey = universalApiKey;
    }

    // Model finalisieren (ENV-Default erlaubt)
    const finalModel = (ttsModel || TTS_MODEL || "tts-1");

    const audioData = await textToSpeech(
      text,
      textPosition,
      useThisTtsUrl,
      useThisTtsKey,
      finalModel,
    );

    // An empty buffer is still a truthy object – checking the length matters,
    // otherwise a 0-byte "success" reaches the client as an unplayable clip.
    if (!audioData || audioData.byteLength === 0) {
      console.error("[TTS] no audio produced for textPosition=", textPosition);
      return new Response("Failed to synthesize speech", { status: 500 });
    }

    return new Response(audioData, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  },
};
