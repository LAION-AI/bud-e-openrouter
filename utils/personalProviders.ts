/** Personal inference goes directly to the provider. No Buddy proxy or API key storage. */
import {
  buildSpeechPrompt,
  type CatalogModel,
  getCatalog,
  parsePcmContentType,
  pcmToWav,
  preferredAudioFormat,
  styleChannelFor,
  voiceFor,
} from "./openrouter.ts";
import { getRequestyCatalog } from "./requesty.ts";
import {
  getGoogleModels,
  getGoogleVoices,
  googleGenerateContent,
  googleText,
} from "./googleAi.ts";
import type { PersonalRole, PersonalSettings } from "./personalClient.ts";
import { fromBase64, toBase64 } from "./personalCrypto.ts";
import { validPdfBase64 } from "./uploadLimits.ts";
import { type GradingFormat, GradingFailure, GradingTruncated, gradingResponseFormat } from "./gradingProtocol.ts";

export type PersonalModel = {
  id: string;
  name: string;
  roles: PersonalRole[];
  vision: boolean;
  free: boolean;
  price: string;
  maxOutput?: number;
  privacy?: CatalogModel;
};
const OR = "https://openrouter.ai/api/v1", RQ = "https://router.requesty.ai/v1";
export function providerBase(settings: PersonalSettings): string {
  if (settings.provider === "openrouter") return OR;
  if (settings.provider === "requesty") return RQ;
  if (settings.provider === "google") {
    return "https://generativelanguage.googleapis.com/v1beta";
  }
  let url: URL;
  try {
    url = new URL(settings.baseUrl);
  } catch {
    throw new Error("Bitte eine vollständige HTTPS-API-Adresse angeben.");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.search ||
    url.hash || /(?:^|\.)bud-e\.ai$/i.test(url.hostname)
  ) {
    throw new Error(
      "Bitte eine direkte HTTPS-Adresse deines KI-Anbieters verwenden, keinen Buddy-Proxy.",
    );
  }
  return url.href.replace(/\/$/, "");
}
export function personalProviderError(status: number): string {
  if (status === 401 || status === 403) {
    return "Der Anbieter hat den API-Key oder den Zugriff auf dieses Modell abgelehnt.";
  }
  if (status === 402) {
    return "Beim Anbieter fehlt Guthaben oder der Key hat sein Ausgabenlimit erreicht.";
  }
  if (status === 404) {
    return "Dieses Modell oder diese Funktion ist beim Anbieter nicht verfügbar.";
  }
  if (status === 429) {
    return "Das Anfragelimit des Anbieters ist erreicht. Bitte später erneut versuchen.";
  }
  return status >= 500
    ? "Der KI-Anbieter ist gerade nicht erreichbar."
    : `Der Anbieter hat die Anfrage abgelehnt (${status}). Bitte Modell und Einstellungen prüfen.`;
}
async function direct(
  settings: PersonalSettings,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  try {
    const response = await fetch(providerBase(settings) + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        Authorization: "Bearer " + settings.key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      if ([400, 404, 422].includes(response.status) && body && typeof body === "object" && "response_format" in body) {
        const data = await response.clone().json().catch(() => ({}));
        if (/response.format|json.schema|structured|schema/i.test(String(data?.error?.message ?? ""))) {
          await response.body?.cancel();
          throw new GradingFailure("Dieses Modell unterstützt das JSON-Schema nicht.", true, "format_unsupported");
        }
      }
      await response.body?.cancel();
      throw new GradingFailure(personalProviderError(response.status), ![400, 401, 402, 403, 404, 413].includes(response.status), "request");
    }
    return response;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Der direkte Browserzugriff ist nicht möglich (Netzwerk oder CORS-Freigabe des Anbieters). Aus Datenschutzgründen wird kein Buddy-Proxy verwendet.",
      );
    }
    throw error;
  }
}
export async function personalModels(
  settings: PersonalSettings,
  force = false,
): Promise<PersonalModel[]> {
  if (!settings.key.trim()) {
    throw new Error("Bitte zuerst einen API-Key eintragen.");
  }
  if (settings.provider === "google") {
    return (await getGoogleModels(settings.key, force)).filter((m) =>
      m.roles.some((r) => r !== "music")
    ).map((m) => ({
      id: m.id,
      name: m.name,
      roles: m.roles.filter((role): role is PersonalRole => role !== "music"),
      vision: m.vision,
      free: false,
      price: "Preis/Freikontingent im Google-Projekt prüfen",
      maxOutput: m.outputTokenLimit,
    }));
  }
  if (settings.provider === "openrouter") {
    const models: PersonalModel[] = (await getCatalog(force)).models.filter((
      m,
    ) => m.roles.some((r) => r !== "music")).map((m) => ({
      id: m.id,
      name: m.name,
      roles: [
        ...(m.roles.includes("llm") ? ["chat" as const] : []),
        ...m.roles.filter((role): role is "tts" | "asr" | "image" =>
          ["tts", "asr", "image"].includes(role)
        ),
      ],
      vision: m.roles.includes("vlm"),
      free: m.free === true &&
        !m.roles.some((role) =>
          ["tts", "image", "music", "asr"].includes(role)
        ),
      price: m.roles.some((role) => ["tts", "image"].includes(role))
        ? "Medienpreise beim Anbieter prüfen"
        : m.free
        ? "kostenlos"
        : `$${m.promptPrice.toFixed(3)} / $${
          m.completionPrice.toFixed(3)
        } je Mio. Tokens (Medien ggf. separat)`,
      maxOutput: m.maxOutputTokens,
      privacy: m,
    })).filter((m) => m.roles.length);
    // Native transcription models declare `transcription`, not `text` output.
    // Keep them discoverable even when the older shared catalog has no role.
    try {
      const data = await (await direct(
        settings,
        "/models?output_modalities=transcription",
      )).json();
      const native: PersonalModel[] =
        (Array.isArray(data.data) ? data.data : []).filter(
          (raw: Record<string, unknown>) => {
            const arch = raw.architecture as
              | { output_modalities?: string[] }
              | undefined;
            return typeof raw.id === "string" &&
              arch?.output_modalities?.includes("transcription");
          },
        ).map((raw: Record<string, unknown>) => ({
          id: String(raw.id),
          name: String(raw.name ?? raw.id),
          roles: ["asr"],
          vision: false,
          free: false,
          price: "Audiopreise beim Anbieter prüfen",
        }));
      if (native.length) {
        for (const model of models) {
          model.roles = model.roles.filter((role) => role !== "asr");
        }
        for (const model of native) {
          const known = models.find((item) => item.id === model.id);
          if (known) known.roles.push("asr");
          else models.push(model);
        }
      }
    } catch {
      /* Text/model selection remains usable during a transcription catalog outage. */
    }
    return models.filter((model) => model.roles.length);
  }
  if (settings.provider === "requesty") {
    return (await getRequestyCatalog(force)).models.map((m) => ({
      id: m.id,
      name: m.name,
      roles: ["chat"],
      vision: m.roles.includes("vlm"),
      free: m.promptPrice === 0 && m.completionPrice === 0,
      price: `$${m.promptPrice.toFixed(3)} / $${
        m.completionPrice.toFixed(3)
      } je Mio. Tokens`,
    }));
  }
  const data = await (await direct(settings, "/models")).json();
  return (Array.isArray(data.data) ? data.data : []).flatMap((
    m: Record<string, unknown>,
  ) =>
    typeof m.id === "string"
      ? [{
        id: m.id,
        name: String(m.name ?? m.id),
        roles: ["chat" as const],
        vision: false,
        free: false,
        price: "Preis beim Anbieter prüfen",
      }]
      : []
  );
}
type PersonalInput = {
  role: string;
  text: string;
  images?: string[];
  pdf?: { name: string; data: string };
};
function googleParts(
  messages: PersonalInput[],
) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [
      { text: m.text || "Beschreibe dieses Bild." },
      ...(m.images ?? []).map((url) => {
        const match = url.match(
          /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/,
        );
        if (!match) throw new Error("Ungültiges Bild.");
        return { inlineData: { mimeType: match[1], data: match[2] } };
      }),
      ...(m.pdf
        ? [{ inlineData: { mimeType: "application/pdf", data: m.pdf.data } }]
        : []),
    ],
  }));
}
export async function personalComplete(
  settings: PersonalSettings,
  messages: PersonalInput[],
  model?: PersonalModel,
  onText?: (text: string) => void,
  signal?: AbortSignal,
  maxOutput = 64000,
  requireComplete = false,
  systemOverride?: string,
  format?: GradingFormat,
): Promise<string> {
  if (!settings.models.chat) {
    throw new Error("Bitte zuerst ein Chatmodell wählen.");
  }
  for (const message of messages) {
    if (
      message.pdf &&
      (!validPdfBase64(message.pdf.data) ||
        message.pdf.name.length > 120)
    ) throw new Error("Bitte PDF-Dateien bis 20 MB wählen.");
  }
  const system = systemOverride ??
    "Du bist Bud-E, ein freundlicher und sorgfältiger persönlicher Assistent. Antworte auf Deutsch, wenn nicht anders gewünscht. Formatiere Code als vollständige Markdown-Codeblöcke. Behaupte keine Aktionen oder Editorzugriffe, für die kein Werkzeug verfügbar ist.";
  const limit = Math.max(1, Math.min(maxOutput, model?.maxOutput ?? 8192));
  if (settings.provider === "google") {
    const data = await googleGenerateContent(
      settings.key,
      settings.models.chat,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: googleParts(messages),
        generationConfig: { maxOutputTokens: limit, ...(format ? { responseMimeType: "application/json", responseJsonSchema: gradingResponseFormat(format).json_schema.schema } : {}) },
      },
    );
    const text = googleText(data);
    if (
      requireComplete &&
      (data.candidates as { finishReason?: string }[] | undefined)?.[0]
          ?.finishReason === "MAX_TOKENS"
    ) {
      throw new GradingTruncated(text);
    }
    if (!text) throw new Error("Das Modell hat keinen Antworttext geliefert.");
    onText?.(text);
    return text;
  }
  const provider = model?.privacy
    ? {
      ...(model.privacy.zdr ? { zdr: true, data_collection: "deny" } : {}),
      ...(model.privacy.euTag
        ? { only: [model.privacy.euTag], allow_fallbacks: false }
        : {}),
    }
    : undefined;
  const response = await direct(settings, "/chat/completions", {
    model: settings.models.chat,
    max_tokens: limit,
    stream: true,
    ...(format ? { response_format: gradingResponseFormat(format) } : {}),
    messages: [
      { role: "system", content: system },
      ...messages.map((m) => ({
        role: m.role,
        content: m.images?.length || m.pdf
          ? [
            { type: "text", text: m.text || "Beschreibe das Bild." },
            ...(m.images ?? []).map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
            ...(m.pdf
              ? [
                settings.provider === "requesty"
                  ? {
                    type: "input_file",
                    filename: m.pdf.name,
                    file_data: "data:application/pdf;base64," + m.pdf.data,
                  }
                  : {
                    type: "file",
                    file: {
                      filename: m.pdf.name,
                      file_data: "data:application/pdf;base64," + m.pdf.data,
                    },
                  },
              ]
              : []),
          ]
          : m.text,
      })),
    ],
    ...(provider ? { provider } : {}),
  }, signal);
  if (!response.body) throw new Error("Leere Modellantwort.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", text = "", truncated = false;
  function line(raw: string) {
    if (!raw.startsWith("data:")) return;
    const payload = raw.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    const data = JSON.parse(payload);
    if (["length", "max_tokens"].includes(data.choices?.[0]?.finish_reason)) truncated = true;
    if (data.error) {
      throw new Error(
        "Das Modell hat die Antwort abgebrochen. Bitte Modell oder Guthaben prüfen.",
      );
    }
    const delta = data.choices?.[0]?.delta?.content;
    if (typeof delta === "string") {
      text += delta;
      onText?.(text);
    }
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let at: number;
      while ((at = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, at).replace(/\r$/, ""));
        pending = pending.slice(at + 1);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) line(pending);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  if (requireComplete && truncated) {
    throw new GradingTruncated(text);
  }
  if (!text.trim()) {
    throw new Error(
      "Das Modell hat nur interne Überlegungen oder keinen Antworttext geliefert. Bitte erneut versuchen oder ein anderes Modell wählen.",
    );
  }
  return text;
}
export async function personalGenerateImage(
  settings: PersonalSettings,
  prompt: string,
  references: string[] = [],
): Promise<string[]> {
  if (!settings.enabled.image || !settings.models.image) {
    throw new Error(
      "Bitte die Bilderzeugung in deinen Einstellungen aktivieren und ein Modell wählen.",
    );
  }
  if (settings.provider === "google") {
    const data = await googleGenerateContent(
      settings.key,
      settings.models.image,
      {
        contents: googleParts([{
          role: "user",
          text: prompt,
          images: references,
        }]),
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
    );
    const candidates = data.candidates as {
      content?: {
        parts?: { inlineData?: { mimeType: string; data: string } }[];
      };
    }[] | undefined;
    const images = (candidates?.[0]?.content?.parts ?? []).flatMap((p) =>
      p.inlineData?.mimeType.startsWith("image/")
        ? [`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`]
        : []
    );
    if (!images.length) {
      throw new Error("Das Bildmodell hat kein Bild geliefert.");
    }
    return images.slice(0, 2);
  }
  if (settings.provider === "compatible") {
    const data = await (await direct(settings, "/images/generations", {
      model: settings.models.image,
      prompt,
      n: 1,
      response_format: "b64_json",
    })).json();
    const images = (data.data ?? []).flatMap((
      p: { b64_json?: string; url?: string },
    ) =>
      p.b64_json
        ? ["data:image/png;base64," + p.b64_json]
        : p.url
        ? [p.url]
        : []
    );
    if (!images.length) throw new Error("Das Modell hat kein Bild geliefert.");
    return images.slice(0, 2);
  }
  const data = await (await direct(settings, "/chat/completions", {
    model: settings.models.image,
    stream: false,
    modalities: ["image", "text"],
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...references.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    }],
  })).json();
  const images = (data.choices?.[0]?.message?.images ?? []).flatMap((
    p: { image_url?: { url?: string }; url?: string },
  ) => p.image_url?.url ? [p.image_url.url] : p.url ? [p.url] : []);
  if (!images.length) throw new Error("Das Modell hat kein Bild geliefert.");
  return images.slice(0, 2);
}
export async function personalTranscribe(
  settings: PersonalSettings,
  file: File,
): Promise<string> {
  if (!settings.enabled.asr || !settings.models.asr) {
    throw new Error("Bitte Spracherkennung aktivieren und ein Modell wählen.");
  }
  if (!file.size || file.size > 2_000_000) {
    throw new Error("Bitte eine Audioaufnahme bis 2 MB wählen.");
  }
  if (settings.provider === "google") {
    const data = await googleGenerateContent(
      settings.key,
      settings.models.asr,
      {
        contents: [{
          role: "user",
          parts: [{
            text:
              "Transkribiere ausschließlich den gesprochenen Text, ohne Einleitung und ohne Ergänzungen.",
          }, {
            inlineData: {
              mimeType: file.type.split(";")[0] || "audio/webm",
              data: toBase64(new Uint8Array(await file.arrayBuffer())),
            },
          }],
        }],
      },
    );
    return googleText(data);
  }
  const form = new FormData();
  form.append("file", file);
  form.append("model", settings.models.asr);
  form.append("response_format", "json");
  let response: Response;
  try {
    response = await fetch(providerBase(settings) + "/audio/transcriptions", {
      method: "POST",
      credentials: "omit",
      headers: { Authorization: "Bearer " + settings.key },
      body: form,
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error(
      "Audio konnte nicht direkt an den Anbieter übertragen werden (Netzwerk/CORS).",
    );
  }
  if (!response.ok) throw new Error(personalProviderError(response.status));
  const data = await response.json();
  if (typeof data.text !== "string" || !data.text.trim()) {
    throw new Error("Kein Transkript erhalten.");
  }
  return data.text;
}
export async function personalSpeech(
  settings: PersonalSettings,
  text: string,
): Promise<Blob> {
  if (!settings.enabled.tts || !settings.models.tts) {
    throw new Error("Bitte Vorlesen aktivieren und ein Modell wählen.");
  }
  if (settings.provider === "google") {
    const version = settings.models.tts.match(/^gemini-(\d+)\.(\d+)/);
    const modern = !!version &&
      (Number(version[1]) > 3 ||
        (Number(version[1]) === 3 && Number(version[2]) >= 8));
    const data = await googleGenerateContent(
      settings.key,
      settings.models.tts,
      {
        contents: [{
          role: "user",
          parts: [{
            ...(modern
              ? {
                text: text.slice(0, 12000),
                speech_metadata: { style: settings.style },
              }
              : {
                text: `${settings.style}\nLies folgenden Text vor: ${
                  text.slice(0, 12000)
                }`,
              }),
          }],
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              ...(modern ? { voice: settings.voice || "Kore" } : {
                prebuiltVoiceConfig: { voiceName: settings.voice || "Kore" },
              }),
            },
          },
        },
      },
    );
    const candidates = data.candidates as {
      content?: {
        parts?: { inlineData?: { data: string; mimeType: string } }[];
      };
    }[] | undefined;
    const audio = candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
      ?.inlineData;
    if (!audio) throw new Error("Keine Audiodatei erhalten.");
    const bytes = fromBase64(audio.data);
    return /pcm|l16/i.test(audio.mimeType)
      ? new Blob([pcmToWav(bytes, 24000, 1)], { type: "audio/wav" })
      : new Blob([bytes], { type: audio.mimeType });
  }
  const format = preferredAudioFormat(settings.models.tts),
    channel = styleChannelFor(settings.models.tts);
  const response = await direct(settings, "/audio/speech", {
    model: settings.models.tts,
    voice: voiceFor(settings.models.tts, settings.voice),
    response_format: format,
    input: channel === "prompt"
      ? buildSpeechPrompt(text.slice(0, 12000), settings.style)
      : text.slice(0, 12000),
    ...(channel === "instructions" ? { instructions: settings.style } : {}),
  });
  const bytes = new Uint8Array(await response.arrayBuffer()),
    mime = response.headers.get("content-type") ?? "audio/mpeg";
  if (mime.includes("pcm") || format === "pcm") {
    const { rate, channels } = parsePcmContentType(mime);
    return new Blob([pcmToWav(bytes, rate, channels)], { type: "audio/wav" });
  }
  return new Blob([bytes], { type: mime });
}
export async function personalVoices(
  settings: PersonalSettings,
): Promise<{ id: string; name: string }[]> {
  if (settings.provider === "google") {
    return (await getGoogleVoices(settings.key)).voices.map((voice) => ({
      id: voice.id,
      name: voice.name,
    }));
  }
  const model = settings.models.tts;
  const names = model.startsWith("google/")
    ? [
      "Kore",
      "Zephyr",
      "Puck",
      "Charon",
      "Fenrir",
      "Aoede",
      "Leda",
      "Orus",
      "Achird",
      "Sulafat",
    ]
    : model.startsWith("x-ai/")
    ? ["Eve", "Rex", "Leo", "Gork", "Ara"]
    : [
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
    ];
  return names.map((id) => ({ id, name: id }));
}
