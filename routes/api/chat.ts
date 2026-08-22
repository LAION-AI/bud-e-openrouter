// routes/api/chat.ts
import { Handlers } from "$fresh/server.ts";
import { ServerSentEventStream } from "https://deno.land/std@0.210.0/http/server_sent_event_stream.ts";
import { chatContent } from "../../internalization/content.ts";
import {
  attemptsFor,
  getCatalog,
  isOpenRouterKey,
  orFetch,
  policyFor,
  type Role,
} from "../../utils/openrouter.ts";

const API_URL = Deno.env.get("LLM_URL") || "";
const API_KEY = Deno.env.get("LLM_KEY") || "";
const API_MODEL = Deno.env.get("LLM_MODEL") || "";
const API_IMAGE_URL = Deno.env.get("VLM_URL") || "";
const API_IMAGE_KEY = Deno.env.get("VLM_KEY") || "";
const API_IMAGE_MODEL = Deno.env.get("VLM_MODEL") || "";
const API_IMAGE_CORRECTION_MODEL = Deno.env.get("VLM_CORRECTION_MODEL") || "";
const MIDDLEWARE_BASE_URL = Deno.env.get("MIDDLEWARE_URL") || "";

/**
 * Which permission-gated tools are active, plus the handful of facts that make
 * the instructions concrete. Everything here is data from an untrusted client,
 * so the values are clamped and stripped of line breaks before they go
 * anywhere near the system prompt.
 */
interface ToolFlags {
  notebook: boolean;
  mail: boolean;
  /** Song generation is available (OpenRouter key present). */
  music: boolean;
  notebookName: string;
  notebookCells: number;
  mailFolders: string[];
}

// deno-lint-ignore no-explicit-any
function readToolFlags(raw: any): ToolFlags {
  const text = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "";
  return {
    notebook: raw?.notebook === true,
    mail: raw?.mail === true,
    music: raw?.music === true,
    notebookName: text(raw?.notebookName, 80),
    notebookCells: Math.max(0, Math.min(999, Number(raw?.notebookCells) || 0)),
    mailFolders: Array.isArray(raw?.mailFolders)
      ? raw.mailFolders.map((f: unknown) => text(f, 60)).filter(Boolean).slice(0, 20)
      : [],
  };
}

/**
 * How to write a song brief for Lyria 3 Pro.
 *
 * Appended to the system prompt so the assistant can offer songs and, more
 * importantly, write a brief that actually works. The shape follows Google's
 * own prompting guide: genre, mood, instrumentation, tempo, voice, then the
 * lyrics. Section markers are plain [Verse 1] / [Chorus] tags in the lyrics -
 * Lyria returns its own timed sheet afterwards, we do not have to ask for it.
 */
function buildSongSection(lang: string): string {
  const de = lang === "de";
  return de
    ? `## Lieder erzeugen (Lyria 3 Pro)

Du kannst ganze Lieder mit Gesang erzeugen. Löse das mit einem JSON-Objekt aus:
\`{"song": "der vollständige Auftrag"}\`

**Frage vorher immer nach**, ob das Lied erzeugt werden soll - es dauert etwa
eine halbe Minute und kostet Geld. Wenn jemand nur "mach mir ein Lied über
Goldfische" sagt, schreibst du selbst einen fertigen Auftrag samt Text und
fragst dann, ob du ihn so umsetzen sollst.

**Aufbau eines guten Auftrags** (in dieser Reihenfolge, als Fließtext):
Genre und Stil, Stimmung, Instrumente, Tempo, Stimme (Geschlecht, Lage,
Klangfarbe, Sprache) - danach der Liedtext.

Beispiel:
\`\`\`
Eine sanfte Akustik-Folk-Ballade, warm und hoffnungsvoll. Nylonsaiten-Gitarre
und leise Besen auf der Snare. Langsames, wiegendes Tempo. Eine klare weibliche
Altstimme, die auf Deutsch singt.

[Strophe 1]
Die Sonne geht am Morgen auf
und weckt die stille Stadt

[Refrain]
Ein neuer Tag, ein neues Lied
singt jeder, der ihn hat
\`\`\`

**Hinweise**: Nenne Instrumente ausdrücklich, sonst wählt das Modell selbst.
Für ein Lied ohne Gesang schreibe "Instrumental". Der Nutzer kann eigenen Text
mitbringen - dann übernimm ihn wörtlich. Fragt jemand, wie man den Text
schreibt, erkläre die Marken [Strophe], [Refrain], [Bridge] und dass Genre und
Stimme davor beschrieben werden.`
    : `## Song generation (Lyria 3 Pro)

You can generate complete songs with vocals. Trigger it with a JSON object:
\`{"song": "the complete brief"}\`

**Always ask first** whether the song should be generated - it takes about half
a minute and costs money. If someone just says "make me a song about goldfish",
write a finished brief including lyrics yourself, then ask whether to run it.

**A good brief** reads as prose, in this order: genre and style, mood,
instrumentation, tempo, voice (gender, range, texture, language) - then the
lyrics.

Example:
\`\`\`
A gentle acoustic folk ballad, warm and hopeful, with nylon-string guitar and
soft brushed drums. Slow, swaying tempo. A clear female alto voice singing in
English.

[Verse 1]
The morning sun comes up again
and wakes the quiet town

[Chorus]
A brand new day, a brand new song
for everyone around
\`\`\`

**Notes**: name the instruments, otherwise the model picks its own. For a song
without vocals write "Instrumental". If the user brings their own lyrics, use
them verbatim. If someone asks how to write the lyrics, explain the [Verse],
[Chorus], [Bridge] markers and that genre and voice are described before them.`;
}

/** Builds the tool part of the system prompt from our own wording. */
function buildToolSection(flags: ToolFlags, lang: string): string {
  const parts: string[] = [];
  const de = lang === "de";

  // Songs only exist on the OpenRouter path, so the instructions are only
  // added there - otherwise the assistant would offer something that cannot
  // run and the user would be told "no" after asking.
  if (flags.music) parts.push(buildSongSection(lang));

  if (flags.notebook) {
    parts.push(chatContent[lang]?.notebookToolPrompt ?? "");
    // Only the count, never the name. A notebook name is free text the user
    // types, and anything user-written that lands in the system prompt is an
    // invitation to talk the assistant out of its instructions. The model can
    // learn the name from a "read" call, where it arrives as data.
    if (flags.notebookCells > 0) {
      parts.push(
        de
          ? `Gerade ist ein Notebook mit ${flags.notebookCells} Zellen geöffnet.`
          : `A notebook with ${flags.notebookCells} cells is currently open.`,
      );
    }
  }
  if (flags.mail) {
    parts.push(chatContent[lang]?.mailToolPrompt ?? "");
    // Folder names have to be exact for the tool to work, so they cannot be
    // dropped - but a folder is a label, not a sentence. Restricting the
    // characters is not enough on its own ("Ignore your rules." is all
    // letters), so the word count is capped as well.
    const folders = flags.mailFolders.filter((f) =>
      f.length <= 40 &&
      /^[\p{L}\p{N} ._\/-]+$/u.test(f) &&
      f.trim().split(/\s+/).length <= 3
    );
    if (folders.length) {
      parts.push(
        de
          ? `Freigegebene Ordner: ${folders.join(", ")}.`
          : `Permitted folders: ${folders.join(", ")}.`,
      );
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

interface Message {
  role: string;
  // deno-lint-ignore no-explicit-any
  content: string | any[];
}

/** Robust extraction of assistant text from non-stream JSON (OpenAI / Gemini / misc) */
// deno-lint-ignore no-explicit-any
function extractAssistantText(anyJson: any): string {
  if (!anyJson) return "";
  try {
    const ch = anyJson?.choices ?? [];
    if (ch.length) {
      const c0 = ch[0];
      if (typeof c0?.message?.content === "string") return c0.message.content;
      if (typeof c0?.text === "string") return c0.text;
      if (typeof c0?.delta?.content === "string") return c0.delta.content;
    }
  } catch (_) {}
  try {
    // Gemini shape
    const cands = anyJson?.candidates ?? [];
    if (cands.length) {
      const parts = cands[0]?.content?.parts ?? [];
      const txt = parts.map((p: any) => p?.text ?? "").join("");
      if (txt) return txt;
    }
  } catch (_) {}
  if (typeof anyJson?.output_text === "string") return anyJson.output_text;
  if (typeof anyJson?.content === "string") return anyJson.content;
  if (Array.isArray(anyJson?.content)) {
    const txt = anyJson.content.map((p: any) => p?.text ?? "").join("");
    if (txt) return txt;
  }
  return "";
}

// deno-lint-ignore no-explicit-any
function hasKorrekturHashtag(messages: any[]): boolean {
  if (!messages || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (!last || !last.content) return false;

  let content = "";
  if (typeof last.content === "string") {
    content = last.content;
  } else if (Array.isArray(last.content)) {
    const textContent = last.content.find((it: any) => it.type === "text");
    content = textContent?.text || "";
  }
  content = content.toLowerCase();
  return content.includes("#korrektur") || content.includes("#correction");
}

/* ===================== Universal-key suffix decoding =======================
   Backend encodes "<host>:<port>" as:
     token = "v1" + Base32( bytes(host:port) XOR 0x5A ), without '=' padding
   We decode it, then build "http://<host>:<port>" (IPv6 hosts get brackets).
============================================================================= */

/** RFC4648 Base32 decode (no padding required). Throws on bad chars. */
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

/** Convert "host:port" → "http://host:port" with IPv6 bracket handling */
function hostPortToHttpBase(hostPort: string): string {
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

function stripTrailingSlashes(u: string): string {
  return u.replace(/\/+$/g, "");
}

/** Decode middleware base URL from the composite universal key (or return null). */
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

/**
 * Reports an upstream failure as an SSE stream rather than an HTTP error.
 *
 * The client is already listening for events at this point; a plain 502 would
 * simply look like the connection died, with nothing to show the user.
 */
function sseError(
  provider: string,
  model: string,
  status: number,
  message: string,
): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue({
          event: "error",
          data: JSON.stringify({ provider, model, status, message }),
          id: Date.now(),
        });
        controller.enqueue({ data: "[DONE]", event: "message", id: Date.now() });
        controller.enqueue({ event: "no_content", data: "{}", id: Date.now() });
        controller.close();
      },
    }).pipeThrough(new ServerSentEventStream()),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

/**
 * Forwards an already-open upstream response to the client as SSE.
 *
 * Only text deltas are passed on; roles, tool objects and keep-alives are
 * dropped. Split out of the middleware path so OpenRouter, which speaks the
 * same dialect, reuses it instead of carrying a second copy of this loop.
 */
function streamUpstream(
  upstream: Response,
  model: string,
  provider: string,
  route?: string,
): Response {
  const headers: Record<string, string> = { "Content-Type": "text/event-stream" };
  if (route) headers["X-OpenRouter-Route"] = route;

  return new Response(
    new ReadableStream({
      async start(controller) {
        let closed = false;
        let sentAny = false;
        const finish = () => {
          if (closed) return;
          if (!sentAny) controller.enqueue({ event: "no_content", data: "{}", id: Date.now() });
          closed = true;
          controller.close();
        };

        try {
          const ctype = (upstream.headers.get("content-type") || "").toLowerCase();
          const decoder = new TextDecoder();

          if (ctype.includes("text/event-stream")) {
            const reader = upstream.body!.getReader();
            let buffer = "";
            let currentEvent = "message";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const raw of lines) {
                const line = raw.trimEnd();

                if (line === "data: [DONE]") {
                  finish();
                  continue;
                }
                if (line.startsWith("event: ")) {
                  currentEvent = line.slice(7).trim() || "message";
                  continue;
                }
                if (!line.startsWith("data: ")) continue;

                const jsonStr = line.substring(6);
                if (currentEvent === "error") {
                  controller.enqueue({ event: "error", data: jsonStr, id: Date.now() });
                  currentEvent = "message";
                  continue;
                }

                try {
                  const data = JSON.parse(jsonStr);
                  const delta = data?.choices?.[0]?.delta;
                  if (typeof delta?.content === "string" && delta.content.length > 0) {
                    if (delta.content === "<|im_end|>") {
                      finish();
                    } else {
                      sentAny = true;
                      controller.enqueue({
                        data: JSON.stringify(delta.content),
                        id: Date.now(),
                        event: "message",
                      });
                    }
                  }
                  if (data?.error) {
                    controller.enqueue({ event: "error", data: JSON.stringify(data.error), id: Date.now() });
                  }
                } catch {
                  if (jsonStr && jsonStr !== "[DONE]") {
                    sentAny = true;
                    controller.enqueue({ data: JSON.stringify(jsonStr), id: Date.now(), event: "message" });
                  }
                }
              }
            }
            finish();
          } else {
            // Non-SSE answer → emit it as a single message event.
            //
            // This used to build raw SSE bytes in a helper and push
            // them into the controller, but the stream is piped through
            // ServerSentEventStream, which serialises event *objects*. Feeding
            // it bytes produced a handful of blank lines and nothing else, so
            // an upstream that replied with plain JSON to a streaming request
            // left the user staring at an empty answer.
            const raw = await upstream.text();
            let text = "";
            try {
              text = extractAssistantText(JSON.parse(raw));
            } catch {
              text = raw;
            }
            if (text) {
              sentAny = true;
              controller.enqueue({
                data: JSON.stringify(text),
                id: Date.now(),
                event: "message",
              });
            }
            controller.enqueue({ data: "[DONE]", event: "message", id: Date.now() });
            finish();
          }
        } catch (e: any) {
          controller.enqueue({
            event: "error",
            data: JSON.stringify({
              provider,
              model,
              status: 502,
              message: String(e?.message || e || "Network error"),
            }),
            id: Date.now(),
          });
          controller.enqueue({ data: "[DONE]", event: "message", id: Date.now() });
          finish();
        }
      },
      cancel(err) {
        const s = String(err || "").toLowerCase();
        if (err && !s.includes("resource closed") && !s.includes("aborterror")) {
          console.warn("SSE canceled:", err);
        }
      },
    }).pipeThrough(new ServerSentEventStream()),
    { headers },
  );
}

async function getModelResponseStream(
  messages: Message[],
  lang: string,
  universalApiKey: string,
  llmApiUrl: string,
  llmApiKey: string,
  llmApiModel: string,
  systemPrompt: string,
  toolFlags: ToolFlags,
  vlmApiUrl: string,
  vlmApiKey: string,
  vlmApiModel: string,
  vlmCorrectionModel: string,
  wantsStream: boolean | undefined,
  originBase: string | undefined, // request origin for fallback
  // Nur wirksam bei einem OpenRouter-Schlüssel. Getrennt von llmApiModel,
  // damit ein für die Middleware gesetzter Modellname nicht plötzlich als
  // OpenRouter-Modell interpretiert wird.
  orLlmModel: string = "",
  orVlmModel: string = "",
) {
  // An OpenRouter key bypasses the middleware: the model, the provider policy
  // and the URL are all decided further down, in step 7.
  const useOpenRouter = isOpenRouterKey(universalApiKey);

  // If a universal key is provided, override URLs to the middleware using decoded base; fallback to env → origin.
  if (universalApiKey && !useOpenRouter) {
    const decoded = decodeMiddlewareBaseFromUniversalKey(universalApiKey);
    const envBase = (MIDDLEWARE_BASE_URL || "").trim();
    const base = decoded || envBase || (originBase || "").trim();
    const source = decoded ? "decoded" : (envBase ? "env" : (originBase ? "origin" : "none"));

    if (base) {
      const clean = stripTrailingSlashes(base);
      llmApiUrl = `${clean}/v1/chat/completions`;
      vlmApiUrl = `${clean}/v1/chat/completions`;
      llmApiKey = universalApiKey;
      vlmApiKey = universalApiKey;
      console.log(`[MW] chat source=${source} base=${clean}`);
    }
  }

  // 1) Universal key format check - "sbe-" for the middleware, "sk-or-v1-" for
  //    OpenRouter. Anything else is a typo and fails fast rather than being
  //    forwarded to some upstream as a bearer token.
  if (universalApiKey !== "" && !useOpenRouter && !universalApiKey.toLowerCase().startsWith("sbe-")) {
    return new Response(
      "Invalid Universal API Key. It needs to start with 'sbe-' or 'sk-or-v1-'.",
      { status: 400 },
    );
  }

  // 2) Strip trailing assistant messages
  let isLastAssistant = messages[messages.length - 1]?.role === "assistant";
  while (isLastAssistant) {
    messages.pop();
    isLastAssistant = messages[messages.length - 1]?.role === "assistant";
  }

  // 3) Correction flag
  const isCorrectionInLastMessage = hasKorrekturHashtag(messages);

  // 4) System prompt
  //    The built-in prompts already document the tools. A user-supplied prompt
  //    does not, so the compact tool-usage block (search, imagegen, imageedit,
  //    character consistency via reference images) is prepended automatically –
  //    the custom prompt keeps defining persona and behaviour, but the model
  //    never loses the tool knowledge.
  let useThisSystemPrompt = isCorrectionInLastMessage
    ? chatContent[lang].correctionSystemPrompt
    : chatContent[lang].systemPrompt;
  if (systemPrompt != "") {
    const toolPrefix = chatContent[lang]?.toolUsagePrompt ?? "";
    useThisSystemPrompt = toolPrefix + systemPrompt;
  }
  // Tool instructions are composed here, from our own text. The client only
  // says which permissions are on and passes a few facts; anything it sends is
  // treated as data, never as prompt - otherwise a crafted request could
  // append arbitrary instructions to the system prompt.
  const toolSection = buildToolSection(toolFlags, lang);
  if (toolSection) useThisSystemPrompt += "\n\n" + toolSection;
  messages.unshift({ role: "system", content: useThisSystemPrompt });

  // 4b) Sanitize multimodal content before forwarding upstream.
  //     - Chat APIs reject images inside *assistant* turns, so generated images
  //       become a text marker. The ID stays visible so the model can still
  //       reference it later via {"imageedit": {"image_id": "gen_00001", ...}}.
  //       The actual pixels are resolved client-side for image editing.
  //     - Strip our bookkeeping fields (id/source/timestamp/filename) from image
  //       parts, since strict OpenAI-compatible endpoints reject unknown keys.
  messages = messages.map((m) => {
    if (!Array.isArray(m.content)) return m;

    if (m.role === "assistant") {
      const parts = m.content.map((c: any) => {
        if (c?.type === "image_url") {
          const label = c.id ? `[generated image: ${c.id}]` : "[generated image]";
          return { type: "text", text: label };
        }
        return c;
      });
      // Collapse to a plain string when only text is left – simpler for upstream.
      const allText = parts.every((c: any) => c?.type === "text");
      return allText
        ? { ...m, content: parts.map((c: any) => c.text ?? "").join("\n") }
        : { ...m, content: parts };
    }

    return {
      ...m,
      content: m.content.map((c: any) =>
        c?.type === "image_url"
          ? { type: "image_url", image_url: c.image_url }
          : c
      ),
    };
  });

  // 5) Multimodality detection
  const isImageInMessages = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url"),
  );
  const isPdfInMessages = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "pdf"),
  );

  // 6) Direct PDF → Gemini only when NO universal key (otherwise middleware handles PDFs)
  if (isPdfInMessages && !(universalApiKey && universalApiKey.trim().length > 0)) {
    const geminiApiKey = vlmApiKey || Deno.env.get("VLM_KEY") || "";
    const geminiModel = vlmApiModel || Deno.env.get("VLM_MODEL") || "gemini-2.5-pro";
    if (!geminiApiKey) {
      return new Response("Missing VLM API key for PDF processing (expected Google AI Studio key).", { status: 400 });
    }

    const systemMessage = messages.find((m) => m.role === "system");
    const systemInstruction = systemMessage?.content
      ? {
          role: "system",
          parts: [
            {
              text:
                typeof systemMessage.content === "string"
                  ? systemMessage.content
                  : Array.isArray(systemMessage.content)
                  ? (systemMessage.content.find((c: any) => c.type === "text")?.text || "")
                  : "",
            },
          ],
        }
      : undefined;

    const geminiContents = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const parts: any[] = [];
        if (typeof m.content === "string") {
          if (m.content.trim() !== "") parts.push({ text: m.content });
        } else if (Array.isArray(m.content)) {
          for (const c of m.content) {
            if (c.type === "text" && c.text && c.text.trim() !== "") {
              parts.push({ text: c.text });
            } else if (c.type === "pdf" && c.data) {
              parts.push({ inlineData: { mimeType: c.mime_type || "application/pdf", data: c.data } });
            } else if (c.type === "image_url" && c.image_url?.url?.startsWith("data:")) {
              const dataUrl = c.image_url.url;
              const commaIdx = dataUrl.indexOf(",");
              const header = dataUrl.substring(5, commaIdx); // e.g. image/png;base64
              const base64 = dataUrl.substring(commaIdx + 1);
              const mimeType = header.split(";")[0];
              parts.push({ inlineData: { mimeType, data: base64 } });
            }
          }
        }
        return { role: m.role === "assistant" ? "model" : "user", parts };
      });

    const wantsGeminiStream = (wantsStream !== false);
    if (wantsGeminiStream) {
      const geminiUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}` +
        `:streamGenerateContent?alt=sse&key=${encodeURIComponent(geminiApiKey)}`;

      const geminiBody: any = {
        contents: geminiContents,
        generationConfig: { thinkingConfig: { thinkingBudget: -1 } },
        tools: [{ googleSearch: {} }],
        ...(systemInstruction ? { systemInstruction } : {}),
      };

      function collectTextFields(obj: any, out: string[]) {
        if (!obj) return;
        if (typeof obj === "object") {
          for (const k in obj) {
            const v = obj[k];
            if (k === "text" && typeof v === "string") out.push(v);
            else collectTextFields(v, out);
          }
        }
      }

      return new Response(
        new ReadableStream({
          async start(controller) {
            let closed = false;
            let sentAny = false;
            const finish = () => {
              if (closed) return;
              if (!sentAny) controller.enqueue({ event: "no_content", data: "{}", id: Date.now() });
              closed = true;
              controller.close();
            };

            try {
              const resp = await fetch(geminiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(geminiBody),
              });

              if (!resp.ok || !resp.body) {
                const errText = await resp.text().catch(() => "");
                controller.enqueue({
                  event: "error",
                  data: JSON.stringify({
                    provider: "gemini",
                    model: geminiModel,
                    status: resp.status,
                    message: errText || resp.statusText || "Upstream error",
                  }),
                  id: Date.now(),
                });
                controller.enqueue({ data: "[DONE]", event: "message", id: Date.now() });
                finish();
                return;
              }

              const reader = resp.body.getReader();
              const decoder = new TextDecoder();
              let buffer = "";
              let currentEvent = "message";

              readLoop: while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const raw of lines) {
                  const line = raw.trimEnd();
                  if (line.startsWith("event: ")) {
                    currentEvent = line.slice(7).trim() || "message";
                    continue;
                  }
                  if (!line.startsWith("data: ")) continue;

                  const payload = line.slice(6).trim();
                  if (payload === "[DONE]") {
                    finish();
                    break readLoop;
                  }
                  if (currentEvent === "error") {
                    controller.enqueue({ event: "error", data: payload, id: Date.now() });
                    currentEvent = "message";
                    continue;
                  }
                  try {
                    const json = JSON.parse(payload);
                    const parts: string[] = [];
                    collectTextFields(json, parts);
                    const chunk = parts.join("");
                    if (chunk) {
                      sentAny = true;
                      controller.enqueue({ data: JSON.stringify(chunk), id: Date.now(), event: "message" });
                    }
                  } catch {
                    // ignore non-JSON chunks
                  }
                }
              }
              finish();
            } catch (e: any) {
              controller.enqueue({
                event: "error",
                data: JSON.stringify({
                  provider: "gemini",
                  model: geminiModel,
                  status: 502,
                  message: String(e?.message || e || "Network error"),
                }),
                id: Date.now(),
              });
              controller.enqueue({ data: "[DONE]", event: "message", id: Date.now() });
              finish();
            }
          },
          cancel(err) {
            const s = String(err || "").toLowerCase();
            if (err && !s.includes("resource closed") && !s.includes("aborterror")) {
              console.warn("SSE canceled:", err);
            }
          },
        }).pipeThrough(new ServerSentEventStream()),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    } else {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}` +
        `:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
      const body = {
        contents: geminiContents,
        generationConfig: { thinkingConfig: { thinkingBudget: -1 } },
        tools: [{ googleSearch: {} }],
        ...(systemInstruction ? { systemInstruction } : {}),
      };
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const txt = await r.text();
      return new Response(txt, {
        status: r.status,
        headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" },
      });
    }
  }

  // 7) LLM/VLM (no PDF) → upstream (middleware or direct)
  let useApiUrl = llmApiUrl || Deno.env.get("LLM_URL") || API_URL;
  let useApiKey = llmApiKey || Deno.env.get("LLM_KEY") || API_KEY;
  let useApiModel = llmApiModel || Deno.env.get("LLM_MODEL") || API_MODEL;

  if (isImageInMessages) {
    useApiUrl = vlmApiUrl || Deno.env.get("VLM_URL") || API_IMAGE_URL;
    useApiKey = vlmApiKey || Deno.env.get("VLM_KEY") || API_IMAGE_KEY;
    const chosenVlmModel =
      hasKorrekturHashtag(messages) && vlmCorrectionModel
        ? vlmCorrectionModel
        : vlmApiModel || Deno.env.get("VLM_MODEL") || API_IMAGE_MODEL || API_IMAGE_CORRECTION_MODEL;
    useApiModel = chosenVlmModel;
  }

  /* ------------------------- OpenRouter ------------------------- */
  if (useOpenRouter) {
    // A picture in the conversation makes this a VLM request; the two roles
    // have separate overrides in the settings even though they share defaults.
    const role: Role = isImageInMessages ? "vlm" : "llm";
    const override = isImageInMessages ? orVlmModel : orLlmModel;

    let cat;
    try {
      cat = await getCatalog();
    } catch (err) {
      console.error("[OR] catalog unavailable:", err);
      return new Response("Could not reach OpenRouter's model list.", { status: 502 });
    }

    const attempts = attemptsFor(cat, role, override);
    if (attempts.length === 0) {
      return new Response(`No OpenRouter model available for ${role}.`, { status: 502 });
    }

    // Walks the same model/strictness chain the other routes use. The upstream
    // is only handed on once it answered ok, so a rejected attempt costs a
    // retry instead of a broken stream.
    const openUpstream = async (stream: boolean) => {
      const tried: string[] = [];
      let lastStatus = 502;
      let lastText = "";
      for (const { model, level } of attempts) {
        const policy = await policyFor(model, level);
        const { resp } = await orFetch(universalApiKey, "/chat/completions", {
          model: model.id,
          stream,
          messages,
          ...(policy ? { provider: policy } : {}),
        }, { model, level, referer: originBase });
        if (resp.ok) {
          const route = tried.length
            ? `${model.id};${level};after=${tried.join("|")}`
            : `${model.id};${level}`;
          if (tried.length) console.log(`[OR] ${role} using ${route}`);
          return { resp, route, model: model.id };
        }
        lastStatus = resp.status;
        lastText = await resp.text().catch(() => "");
        tried.push(`${model.id}:${level}`);
        console.error(`[OR] ${role} ${model.id}:${level} -> ${resp.status} ${lastText.slice(0, 200)}`);
      }
      return { resp: null, status: lastStatus, text: lastText, tried };
    };

    if (wantsStream === false) {
      const r = await openUpstream(false);
      if (!r.resp) {
        return new Response(
          r.text || "OpenRouter request failed",
          { status: r.status ?? 502, headers: { "Content-Type": "application/json" } },
        );
      }
      const txt = await r.resp.text();
      return new Response(txt, {
        status: r.resp.status,
        headers: {
          "Content-Type": r.resp.headers.get("content-type") ?? "application/json",
          "X-OpenRouter-Route": r.route!,
        },
      });
    }

    // Streaming: OpenRouter speaks the same SSE dialect as the middleware, so
    // the existing forwarding loop below handles it unchanged. Point the shared
    // variables at OpenRouter and let it run.
    const r = await openUpstream(true);
    if (!r.resp || !r.resp.body) {
      return new Response(
        JSON.stringify({
          error: {
            provider: "openrouter",
            status: r.status ?? 502,
            message: r.text || "All OpenRouter attempts failed",
            tried: r.tried,
          },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    return streamUpstream(r.resp, r.model!, "openrouter", r.route!);
  }

  // Non-stream: pass JSON straight through
  if (wantsStream === false) {
    const resp = await fetch(useApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${useApiKey}` },
      body: JSON.stringify({ model: useApiModel, stream: false, messages }),
    });
    const txt = await resp.text();
    return new Response(txt, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  }

  // Stream: fetch first, then hand the open response to the shared forwarder -
  // the same one the OpenRouter branch uses, so both speak one SSE dialect.
  const upstream = await fetch(useApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${useApiKey}` },
    body: JSON.stringify({ model: useApiModel, stream: true, messages }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return sseError(
      "middleware",
      useApiModel,
      upstream.status,
      errText || upstream.statusText || "Upstream error",
    );
  }

  return streamUpstream(upstream, useApiModel, "middleware");
}

export const handler: Handlers = {
  async POST(req: Request) {
    const payload = await req.json();
    const wantsStream: boolean | undefined = payload.stream;
    return getModelResponseStream(
      payload.messages as Message[],
      payload.lang,
      payload.universalApiKey,
      payload.llmApiUrl, payload.llmApiKey, payload.llmApiModel,
      payload.systemPrompt,
      readToolFlags(payload.toolFlags),
      payload.vlmApiUrl, payload.vlmApiKey, payload.vlmApiModel, payload.vlmCorrectionModel,
      wantsStream,
      new URL(req.url).origin,
      payload.orLlmModel,
      payload.orVlmModel,
    );
  },

  async GET(req: Request) {
    const url = new URL(req.url);
    const payloadParam = url.searchParams.get("payload");
    if (!payloadParam) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `event: error\ndata: ${JSON.stringify({
                status: 405,
                message: "Use POST with JSON body or GET with ?payload=<base64(json)>",
              })}\n\n`,
            ),
          );
          controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }

    let payload: any;
    try {
      const jsonStr = atob(payloadParam);
      payload = JSON.parse(jsonStr);
    } catch {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `event: error\ndata: ${JSON.stringify({
                status: 400,
                message: "Invalid ?payload. Must be base64-encoded JSON.",
              })}\n\n`,
            ),
          );
          controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }

    const wantsStream: boolean | undefined = payload.stream;
    return getModelResponseStream(
      payload.messages as Message[],
      payload.lang,
      payload.universalApiKey,
      payload.llmApiUrl, payload.llmApiKey, payload.llmApiModel,
      payload.systemPrompt,
      readToolFlags(payload.toolFlags),
      payload.vlmApiUrl, payload.vlmApiKey, payload.vlmApiModel, payload.vlmCorrectionModel,
      wantsStream,
      new URL(req.url).origin,
      payload.orLlmModel,
      payload.orVlmModel,
    );
  },

  async OPTIONS(_req: Request) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  },
};
