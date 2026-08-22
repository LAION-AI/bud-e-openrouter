/**
 * @file music.ts
 * @description Generates a whole song with Lyria 3 and hands it to the browser.
 *
 *              Lyria is unlike the other models in three ways, all measured
 *              against the live API rather than assumed:
 *
 *              1. It only answers with `stream: true` - without it the request
 *                 is refused ("Audio output requires stream: true").
 *              2. Despite streaming, the audio does *not* arrive gradually. The
 *                 lyrics sheet comes after about 7 seconds, then nothing, and
 *                 the complete MP3 lands in a single event at around 29
 *                 seconds. So there is nothing to play along with while it
 *                 works; what we can do is show the lyrics early and start the
 *                 moment the audio is there.
 *              3. Every call is a flat 0.08 $ for Lyria 3 Pro, regardless of
 *                 length - the token prices in the catalogue are zero.
 *
 *              This route therefore forwards its own SSE stream: a "lyrics"
 *              event as soon as the sheet is known, then one "audio" event with
 *              the finished MP3, so the page can put up the player and the
 *              words while the music is still being written.
 */

import { Handlers } from "$fresh/server.ts";
import {
  getCatalog,
  isOpenRouterKey,
  orFetch,
  policyFor,
  attemptsFor,
} from "../../utils/openrouter.ts";

/** Hard ceiling for one song. Generation took ~29 s in testing. */
const SONG_TIMEOUT_MS = 300_000;

/** Refuse prompts that could never be a song brief. */
const MAX_PROMPT_CHARS = 8000;

interface SongResult {
  /** The lyrics sheet with section markers and timestamps. */
  lyrics: string;
  /** Base64 MP3. */
  audio: string;
  model: string;
  cost?: number;
}

/**
 * Runs one Lyria request to completion.
 *
 * `onLyrics` fires as soon as the sheet is complete enough to show, which is
 * roughly 20 seconds before the audio exists - the only part of this that can
 * be made to feel responsive.
 */
async function generateSong(
  prompt: string,
  key: string,
  modelId: string,
  policy: unknown,
  referer: string,
  onLyrics: (text: string) => void,
): Promise<SongResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SONG_TIMEOUT_MS);
  try {
    const { resp } = await orFetch(key, "/chat/completions", {
      model: modelId,
      modalities: ["audio", "text"],
      stream: true,
      messages: [{ role: "user", content: prompt }],
      ...(policy ? { provider: policy } : {}),
    }, { referer, signal: ctrl.signal });

    if (!resp.ok || !resp.body) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Lyria ${resp.status}: ${body.slice(0, 300)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lyrics = "";
    let audio = "";
    let cost: number | undefined;
    let lyricsSent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;

        let data: any;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }
        if (data?.error) {
          throw new Error(`Lyria: ${JSON.stringify(data.error).slice(0, 300)}`);
        }

        const delta = data?.choices?.[0]?.delta ?? {};
        if (typeof delta.content === "string" && delta.content) {
          lyrics += delta.content;
        }
        const a = delta.audio;
        if (a && typeof a.data === "string") {
          // Hand the words over before the long silence, not after it.
          if (!lyricsSent && lyrics.trim()) {
            lyricsSent = true;
            onLyrics(lyrics);
          }
          audio += a.data;
        }
        if (data?.usage?.cost != null) cost = data.usage.cost;
      }

      // The sheet is usually complete long before the audio; show it then.
      if (!lyricsSent && lyrics.includes("\n") && lyrics.length > 40) {
        lyricsSent = true;
        onLyrics(lyrics);
      }
    }

    if (!audio) throw new Error("Lyria returned no audio");
    return { lyrics: lyrics.trim(), audio, model: modelId, cost };
  } finally {
    clearTimeout(timer);
  }
}

export const handler: Handlers = {
  async POST(req) {
    let body: { prompt?: string; universalApiKey?: string; orModel?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Bad JSON" }, 400);
    }

    const prompt = String(body.prompt ?? "").trim();
    const key = String(body.universalApiKey ?? "").trim();

    if (!prompt) return json({ error: "No prompt provided" }, 400);
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: "Prompt too long" }, 400);
    }
    // Song generation only exists on the OpenRouter path; the middleware has
    // no music model, so there is nothing to fall back to.
    if (!isOpenRouterKey(key)) {
      return json({ error: "Song generation needs an OpenRouter key" }, 400);
    }

    const origin = (() => {
      try {
        return new URL(req.url).origin;
      } catch {
        return "";
      }
    })();

    let cat;
    try {
      cat = await getCatalog();
    } catch (err) {
      console.error("[music] catalog unavailable:", err);
      return json({ error: "Could not reach OpenRouter" }, 502);
    }

    const attempts = attemptsFor(cat, "music", body.orModel);
    if (attempts.length === 0) {
      return json({ error: "No music model available" }, 502);
    }

    // SSE so the lyrics can be shown ~20 s before the audio exists.
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        let lastError = "";
        for (const { model, level } of attempts) {
          try {
            send("status", { model: model.id, state: "starting" });
            const policy = await policyFor(model, level);
            const result = await generateSong(
              prompt,
              key,
              model.id,
              policy,
              origin,
              (text) => send("lyrics", { lyrics: text, model: model.id }),
            );
            send("audio", {
              audio: result.audio,
              mime: "audio/mpeg",
              lyrics: result.lyrics,
              model: result.model,
              cost: result.cost,
            });
            controller.close();
            return;
          } catch (err) {
            lastError = String(err);
            console.error(`[music] ${model.id}:${level} failed:`, err);
          }
        }
        send("error", { message: lastError || "Song generation failed" });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  },
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
