import { Handlers } from "$fresh/server.ts";
import {
  type ClassroomConfig,
  findClassroom,
  finishSpend,
  parseConfig,
  recordModelCheck,
  reserveSpend,
  serverSecret,
  sessionSlug,
  validSlug,
} from "../../utils/classroomStore.ts";
import {
  buildSpeechPrompt,
  type CatalogModel,
  getCatalog,
  orFetch,
  parsePcmContentType,
  pcmToWav,
  policyFor,
  preferredAudioFormat,
  type Role,
  styleChannelFor,
  voiceFor,
} from "../../utils/openrouter.ts";
import {
  getGoogleModels,
  googleDeleteFile,
  googleGenerateContent,
  googleInteraction,
  type GoogleModel,
  googleTranscriptionText,
  googleUploadAudio,
} from "../../utils/googleAi.ts";

type MediaKind = "tts" | "asr" | "image" | "music";
const RESERVE: Record<MediaKind, number> = {
  tts: 0.05,
  asr: 0.10,
  image: 0.50,
  music: 0.10,
};
const MAX_BYTES = 3_000_000;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function sameOrigin(req: Request): boolean {
  try {
    const origin = new URL(req.headers.get("origin") ?? "");
    return origin.protocol === "https:" &&
      origin.host === new URL(req.url).host;
  } catch {
    return false;
  }
}

async function bounded(req: Request, max = MAX_BYTES): Promise<Uint8Array> {
  return await boundedStream(req.body, max);
}

async function boundedStream(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array> {
  const reader = stream?.getReader();
  if (!reader) throw new Error("Leere Anfrage.");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error("Datei oder Anfrage ist zu groß.");
    }
    parts.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function base64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 24_000) {
    result += btoa(String.fromCharCode(...bytes.subarray(i, i + 24_000)));
  }
  return result;
}

function audioFormat(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".mp3")) return "mp3";
  if (name.endsWith(".ogg")) return "ogg";
  if (name.endsWith(".flac")) return "flac";
  if (name.endsWith(".m4a")) return "m4a";
  if (name.endsWith(".webm")) return "webm";
  return "wav";
}

function providerError(status: number): string {
  if (status === 401 || status === 403) {
    return "Der API-Key darf dieses Modell nicht verwenden.";
  }
  if (status === 402) return "Nicht genug Guthaben beim Anbieter.";
  if (status === 404) return "Dieses Modell ist nicht verfügbar.";
  if (status === 429) return "Der Anbieter begrenzt gerade die Anfragen.";
  return status >= 500
    ? "Der Anbieter ist vorübergehend nicht erreichbar."
    : `Der Anbieter hat die Anfrage abgelehnt (${status}).`;
}

async function runSelected(
  kind: MediaKind,
  req: Request,
  key: string,
  model: CatalogModel,
  input: string | File,
  requestedVoice: string,
  ttsStyle: string,
  referenceImages: string[],
): Promise<{ bytes: Uint8Array; contentType: string; cost: number | null }> {
  const level = model.eu && model.zdr ? "strict" : model.zdr ? "zdr" : "plain";
  const policy = await policyFor(model, level);
  const body: Record<string, unknown> = {
    model: model.id,
    ...(policy ? { provider: policy } : {}),
  };
  let path = "/chat/completions";
  if (kind === "tts") {
    path = "/audio/speech";
    body.input = styleChannelFor(model.id) === "prompt"
      ? buildSpeechPrompt(input as string, ttsStyle)
      : input;
    if (styleChannelFor(model.id) === "instructions" && ttsStyle) {
      body.instructions = ttsStyle;
    }
    body.voice = voiceFor(model.id, requestedVoice);
    const format = preferredAudioFormat(model.id);
    if (format) body.response_format = format;
  } else if (kind === "asr") {
    const file = input as File;
    path = "/audio/transcriptions";
    body.input_audio = {
      data: base64(new Uint8Array(await file.arrayBuffer())),
      format: audioFormat(file),
    };
    body.response_format = "json";
  } else if (kind === "image") {
    body.modalities = ["image", "text"];
    body.messages = [{
      role: "user",
      content: referenceImages.length
        ? [
          { type: "text", text: input },
          ...referenceImages.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        ]
        : input,
    }];
    body.usage = { include: true };
  } else {
    body.modalities = ["audio", "text"];
    body.stream = true;
    body.stream_options = { include_usage: true };
    body.messages = [{ role: "user", content: input }];
  }
  const { resp } = await orFetch(key, path, body, {
    model,
    level: model.eu && model.zdr ? "strict" : "plain",
    referer: new URL(req.url).origin,
    signal: AbortSignal.timeout(kind === "music" ? 300_000 : 90_000),
  });
  if (!resp.ok) throw new Error(providerError(resp.status));
  if (kind === "tts") {
    const raw = await boundedStream(resp.body, 10_000_000);
    if (!raw.length) {
      throw new Error("Das Sprachmodell hat keine Audiodatei geliefert.");
    }
    const contentType = (resp.headers.get("content-type") || "audio/mpeg")
      .toLowerCase();
    if (contentType.includes("pcm")) {
      const { rate, channels } = parsePcmContentType(contentType);
      return {
        bytes: pcmToWav(raw, rate, channels),
        contentType: "audio/wav",
        cost: null,
      };
    }
    return { bytes: raw, contentType, cost: null };
  }
  if (kind === "music") {
    const raw = await boundedStream(resp.body, 25_000_000);
    let audio = "";
    let lyrics = "";
    let cost: number | null = null;
    for (const line of new TextDecoder().decode(raw).split("\n")) {
      if (!line.startsWith("data: ") || line.slice(6) === "[DONE]") continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (event.error) {
        throw new Error("Das Musikmodell hat die Anfrage abgelehnt.");
      }
      const delta = (event.choices as
        | Array<{ delta?: { content?: string; audio?: { data?: string } } }>
        | undefined)?.[0]?.delta;
      if (typeof delta?.content === "string") lyrics += delta.content;
      if (typeof delta?.audio?.data === "string") audio += delta.audio.data;
      const reported = (event.usage as { cost?: number } | undefined)?.cost;
      if (
        typeof reported === "number" && Number.isFinite(reported) &&
        reported > 0
      ) cost = reported;
    }
    if (!audio) {
      throw new Error("Das Musikmodell hat keine Audiodatei geliefert.");
    }
    return {
      bytes: new TextEncoder().encode(
        JSON.stringify({ audio, mime: "audio/mpeg", lyrics }),
      ),
      contentType: "application/json; charset=utf-8",
      cost,
    };
  }
  const raw = await boundedStream(
    resp.body,
    kind === "image" ? 20_000_000 : 2_000_000,
  );
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (data?.error) {
    throw new Error("Das ausgewählte Modell hat die Anfrage abgelehnt.");
  }
  const reported = data?.usage?.cost;
  const cost =
    typeof reported === "number" && Number.isFinite(reported) && reported >= 0
      ? reported
      : null;
  if (kind === "asr") {
    const text = data?.text;
    if (typeof text !== "string") {
      throw new Error("Das Sprachmodell hat keinen Text geliefert.");
    }
    return {
      bytes: new TextEncoder().encode(text.slice(0, 4000)),
      contentType: "text/plain; charset=utf-8",
      cost,
    };
  }
  const images = (data?.choices?.[0]?.message?.images ?? [])
    .map((i: { image_url?: { url?: string } }) => i?.image_url?.url)
    .filter((url: unknown) =>
      typeof url === "string" &&
      /^data:image\/(png|jpeg|webp);base64,/.test(url)
    )
    .slice(0, 2);
  if (!images.length) {
    throw new Error("Das Bildmodell hat kein Bild geliefert.");
  }
  return {
    bytes: new TextEncoder().encode(
      JSON.stringify({ images, model: model.id }),
    ),
    contentType: "application/json; charset=utf-8",
    cost,
  };
}

function decodedAudio(
  data: string,
  mime: string,
): { bytes: Uint8Array; contentType: string } {
  if (data.length > 15_000_000) throw new Error("Die Audiodatei ist zu groß.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Das Audiomodell hat ungültige Daten geliefert.");
  }
  if (!bytes.length) {
    throw new Error("Das Audiomodell hat keine Datei geliefert.");
  }
  if (/audio\/(?:l16|pcm)/i.test(mime)) {
    const rate = Number(mime.match(/rate=(\d+)/i)?.[1] ?? 24000);
    return { bytes: pcmToWav(bytes, rate, 1), contentType: "audio/wav" };
  }
  return { bytes, contentType: mime.startsWith("audio/") ? mime : "audio/wav" };
}

async function runGoogleSelected(
  kind: MediaKind,
  key: string,
  model: GoogleModel,
  cfg: ClassroomConfig,
  input: string | File,
  referenceImages: string[],
): Promise<{ bytes: Uint8Array; contentType: string; cost: number | null }> {
  if (kind === "music") {
    const data = await googleInteraction(key, model.id, input as string);
    const steps = Array.isArray(data.steps) ? data.steps : [];
    let audio = "";
    let mime = "audio/mpeg";
    let lyrics = "";
    for (const step of steps) {
      if (step?.type !== "model_output" || !Array.isArray(step.content)) {
        continue;
      }
      for (const block of step.content) {
        if (block?.type === "audio" && typeof block.data === "string") {
          audio = block.data;
          mime = String(block.mime_type ?? block.mimeType ?? mime);
        }
        if (block?.type === "text" && typeof block.text === "string") {
          lyrics += block.text;
        }
      }
    }
    if (!audio || audio.length > 35_000_000) {
      throw new Error(
        "Das Musikmodell hat keine verwendbare Audiodatei geliefert.",
      );
    }
    return {
      bytes: new TextEncoder().encode(JSON.stringify({ audio, mime, lyrics })),
      contentType: "application/json; charset=utf-8",
      cost: null,
    };
  }

  if (kind === "tts") {
    if (!cfg.ttsVoice) throw new Error("Bitte zuerst eine TTS-Stimme wählen.");
    const modern = /^gemini-(?:3\.8|3\.9|[4-9]\.)/.test(model.id);
    const spoken = input as string;
    const part = modern
      ? {
        text: spoken,
        speech_metadata: {
          style: cfg.ttsStyle || "Klar und freundlich sprechen.",
        },
      }
      : {
        text: `${
          cfg.ttsStyle || "Sprich klar und freundlich."
        }\nSprich folgenden Text: ${spoken}`,
      };
    const data = await googleGenerateContent(key, model.id, {
      contents: [{ role: "user", parts: [part] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: modern
            ? { voice: cfg.ttsVoice }
            : { prebuiltVoiceConfig: { voiceName: cfg.ttsVoice } },
        },
      },
    }, 90_000);
    const candidates = data.candidates as
      | Array<
        {
          content?: {
            parts?: Array<
              { inlineData?: { data?: string; mimeType?: string } }
            >;
          };
        }
      >
      | undefined;
    const inline = candidates?.[0]?.content?.parts?.find((part) =>
      part.inlineData?.data
    )?.inlineData;
    if (!inline?.data) {
      throw new Error("Das TTS-Modell hat keine Audiodatei geliefert.");
    }
    const result = decodedAudio(
      inline.data,
      String(inline.mimeType ?? "audio/wav"),
    );
    return { ...result, cost: null };
  }

  if (kind === "asr") {
    const file = input as File;
    const detectedMime = (file.type || "audio/wav").split(";")[0].trim();
    const mimeType = detectedMime === "audio/mp4" ? "audio/m4a" : detectedMime;
    const uploaded = await googleUploadAudio(
      key,
      new Uint8Array(await file.arrayBuffer()),
      mimeType,
    );
    try {
      const data = await googleGenerateContent(key, model.id, {
        contents: [{
          role: "user",
          parts: [{ fileData: { mimeType, fileUri: uploaded.uri } }],
        }],
        generationConfig: { audioTranscriptionConfig: { mode: "SMART" } },
      }, 90_000);
      const transcript = googleTranscriptionText(data);
      if (!transcript) {
        throw new Error("Das ASR-Modell hat keinen Text geliefert.");
      }
      return {
        bytes: new TextEncoder().encode(transcript.slice(0, 4000)),
        contentType: "text/plain; charset=utf-8",
        cost: null,
      };
    } finally {
      await googleDeleteFile(key, uploaded.name);
    }
  }

  const data = await googleGenerateContent(key, model.id, {
    contents: [{
      role: "user",
      parts: [
        { text: input as string },
        ...referenceImages.map((url) => {
          const match = url.match(
            /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/,
          );
          if (!match) throw new Error("Ungültiges Referenzbild.");
          return { inlineData: { mimeType: match[1], data: match[2] } };
        }),
      ],
    }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  }, 90_000);
  const candidates = data.candidates as
    | Array<
      {
        content?: {
          parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
        };
      }
    >
    | undefined;
  const images = (candidates?.[0]?.content?.parts ?? []).flatMap((part) => {
    const inline = part.inlineData;
    if (!inline?.data || inline.data.length > 18_000_000) return [];
    const mime = String(inline.mimeType ?? "");
    return /^image\/(png|jpeg|webp)$/.test(mime)
      ? [`data:${mime};base64,${inline.data}`]
      : [];
  }).slice(0, 2);
  if (!images.length) {
    throw new Error("Das Bildmodell hat kein Bild geliefert.");
  }
  return {
    bytes: new TextEncoder().encode(
      JSON.stringify({ images, model: model.id }),
    ),
    contentType: "application/json; charset=utf-8",
    cost: null,
  };
}

export const handler: Handlers = {
  async POST(req) {
    if (!sameOrigin(req)) {
      return json(
        { error: "Nur von derselben sicheren Website aus nutzbar." },
        403,
      );
    }
    let kind: MediaKind;
    let slug: string;
    let input: string | File;
    let adminTest = false;
    let testModel = "";
    let testVoice = "";
    let testStyle = "";
    let referenceImages: string[] = [];
    try {
      const raw = await bounded(req);
      const contentType = req.headers.get("content-type") ?? "";
      if (contentType.startsWith("multipart/form-data")) {
        const form = await new Request(req.url, {
          method: "POST",
          headers: { "Content-Type": contentType },
          body: raw,
        }).formData();
        kind = String(form.get("kind")) as MediaKind;
        slug = String(form.get("slug") ?? "").toLowerCase();
        input = form.get("audio") as File;
        adminTest = form.get("adminTest") === "true";
        testModel = String(form.get("model") ?? "");
      } else {
        const body = JSON.parse(new TextDecoder().decode(raw));
        kind = body.kind;
        slug = String(body.slug ?? "").toLowerCase();
        input = String(body.text ?? "").trim();
        adminTest = body.adminTest === true;
        testModel = String(body.model ?? "");
        testVoice = String(body.ttsVoice ?? "");
        testStyle = String(body.ttsStyle ?? "");
        referenceImages = body.images ?? [];
      }
    } catch (error) {
      return json({
        error: error instanceof Error &&
            error.message === "Datei oder Anfrage ist zu groß."
          ? error.message
          : "Ungültige Anfrage.",
      }, 400);
    }
    if (
      !(["tts", "asr", "image", "music"] as string[]).includes(kind) ||
      !validSlug(slug)
    ) {
      return json({ error: "Ungültige Funktion oder Chatseite." }, 400);
    }
    if (
      !Array.isArray(referenceImages) || referenceImages.length > 3 ||
      referenceImages.some((url) =>
        typeof url !== "string" || url.length > 700_000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)
      ) || (referenceImages.length && kind !== "image")
    ) {
      return json({
        error: "Bitte höchstens drei kleine Referenzbilder wählen.",
      }, 400);
    }
    if (adminTest && await sessionSlug(req) !== slug) {
      return json({ error: "Bitte als Lehrkraft anmelden." }, 401);
    }
    if (
      adminTest &&
      (!testModel || testModel.length > 200 ||
        (kind === "tts" &&
          ((!/^[A-Za-z0-9:_-]{1,100}$/.test(testVoice)) ||
            testStyle.length > 300 ||
            [...testStyle].some((char) => char.charCodeAt(0) < 32))))
    ) {
      return json({
        error: kind === "tts"
          ? "Bitte ein TTS-Modell und eine gültige Stimme auswählen."
          : "Bitte ein Modell auswählen.",
      }, 400);
    }
    if (kind === "asr") {
      if (
        !(input instanceof File) || input.size < 1 || input.size > 2_000_000 ||
        !/^(audio\/|video\/webm)/.test(input.type)
      ) {
        return json(
          { error: "Bitte eine Audiodatei bis 2 MB hochladen." },
          400,
        );
      }
    } else if (
      typeof input !== "string" || !input ||
      input.length > (kind === "tts" ? 1500 : 2000)
    ) {
      return json({ error: "Bitte einen kurzen Text eingeben." }, 400);
    }
    const row = await findClassroom(slug);
    if (!row || row.provider === "requesty") {
      return json({ error: "Diese Funktion ist hier nicht verfügbar." }, 403);
    }
    const cfg = parseConfig(row.config);
    if (!adminTest && (!cfg.enabled[kind] || !cfg.models[kind])) {
      return json({
        error: "Diese Funktion ist ausgeschaltet. Bitte die Lehrkraft fragen.",
      }, 403);
    }
    const key = await serverSecret(row);
    const selectedId = adminTest ? testModel : cfg.models[kind];
    const selected = row.provider === "google"
      ? (await getGoogleModels(key).catch(() => null))?.find((m) =>
        m.id === selectedId && m.roles.includes(kind)
      )
      : (await getCatalog().catch(() => null))?.models.find((m) =>
        m.id === selectedId && m.roles.includes(kind as Role)
      );
    if (!selected) {
      return json(
        { error: "Das ausgewählte Modell ist nicht mehr verfügbar." },
        503,
      );
    }
    const reserve = RESERVE[kind];
    const ticket = await reserveSpend(slug, reserve, !adminTest);
    if (!ticket) {
      return json({
        error:
          "Chatseite geschlossen oder Ausgabenrahmen erreicht. Bitte die Lehrkraft fragen.",
      }, 403);
    }
    let charged = reserve;
    try {
      const current = parseConfig(ticket.row.config);
      if (
        !adminTest &&
        (!current.enabled[kind] || current.models[kind] !== cfg.models[kind])
      ) {
        charged = 0;
        return json({
          error: "Die Lehrkraft hat diese Funktion gerade geändert.",
        }, 409);
      }
      const testConfig: ClassroomConfig = adminTest
        ? { ...current, ttsVoice: testVoice, ttsStyle: testStyle }
        : current;
      const result = ticket.row.provider === "google"
        ? await runGoogleSelected(
          kind,
          ticket.secret,
          selected as GoogleModel,
          testConfig,
          input,
          referenceImages,
        )
        : await runSelected(
          kind,
          req,
          ticket.secret,
          selected as CatalogModel,
          input,
          testConfig.ttsVoice,
          testConfig.ttsStyle,
          referenceImages,
        );
      charged = result.cost ?? reserve;
      await recordModelCheck(slug, kind, selected.id, true);
      if (adminTest) {
        return json({ ok: true, model: selected.id, accountedUsd: charged });
      }
      return new Response(result.bytes, {
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      await recordModelCheck(
        slug,
        kind,
        selected.id,
        false,
        error instanceof Error ? error.message : "Medienanfrage fehlgeschlagen",
      );
      return json({
        error: error instanceof Error
          ? error.message
          : "Die Medienanfrage ist fehlgeschlagen.",
      }, 502);
    } finally {
      await finishSpend(slug, reserve, charged);
    }
  },
};
