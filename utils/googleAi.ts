import type { Feature } from "./classroomStore.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const CATALOG_TTL = 30 * 60_000;

export interface GoogleModel {
  id: string;
  name: string;
  description: string;
  roles: Feature[];
  vision: boolean;
  outputTokenLimit?: number;
}

export interface GoogleVoice {
  id: string;
  name: string;
  language: string;
  description: string;
}

const catalogCache = new Map<
  string,
  { until: number; value: Promise<GoogleModel[]> }
>();

async function keyId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return Array.from(
    new Uint8Array(digest),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}

export function googleError(status: number): string {
  if (status === 400) {
    return "Google hat die Modellanfrage abgelehnt. Prüfe Modell, Stimme und Eingabe.";
  }
  if (status === 401 || status === 403) {
    return "Google hat den API-Key oder den Zugriff auf dieses Modell abgelehnt.";
  }
  if (status === 402) {
    return "Für dieses Google-Projekt ist kein ausreichendes Guthaben verfügbar.";
  }
  if (status === 404) {
    return "Das gewählte Google-Modell ist nicht mehr verfügbar. Falls eine Preview-Version gewählt wurde, bitte das stabile Modell auswählen.";
  }
  if (status === 429) {
    return "Das Google-Limit für Anfragen ist erreicht. Bitte später erneut versuchen.";
  }
  return status >= 500
    ? "Google ist gerade nicht erreichbar."
    : `Google hat die Anfrage abgelehnt (${status}).`;
}

async function googleResponseError(response: Response): Promise<Error> {
  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    const details = JSON.stringify(body?.error?.details ?? []) + " " +
      String(body?.error?.message ?? "");
    if (/PerDay|per.day|daily/i.test(details)) {
      return new Error(
        "Das Tageslimit dieses Google-Modells ist erreicht. Die Limits gelten pro Google-Projekt, nicht pro Gerät oder Hotspot. Prüfe die Limits in Google AI Studio.",
      );
    }
    if (/PerMinute|per.minute|minute/i.test(details)) {
      return new Error(
        "Das Minutenlimit dieses Google-Modells ist erreicht. Warte kurz und versuche es erneut.",
      );
    }
  }
  return new Error(googleError(response.status));
}

export async function googleFetch(
  key: string,
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<Response> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Ungültiger Google-Pfad.");
  }
  return await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "x-goog-api-key": key,
      "Accept": "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function classify(
  name: string,
  description: string,
): { roles: Feature[]; vision: boolean } {
  const id = name.toLowerCase();
  const about = description.toLowerCase();
  if (id.includes("lyria") && !id.includes("realtime")) {
    return { roles: ["music"], vision: false };
  }
  if (/(?:^|[-_])tts(?:$|[-_])|text.to.speech/.test(id)) {
    return { roles: ["tts"], vision: false };
  }
  if (/transcrib|speech.to.text|(?:^|[-_])stt(?:$|[-_])/.test(id)) {
    return { roles: ["asr"], vision: false };
  }
  if (/imagen|(?:^|[-_])image(?:$|[-_])/.test(id)) {
    return { roles: ["image"], vision: false };
  }
  if (/embedding|rerank|aqa|live|robotics/.test(id)) {
    return { roles: [], vision: false };
  }
  if (/gemini|gemma|learnlm/.test(id)) {
    return {
      roles: ["chat"],
      vision: /gemini|vision|image|multimodal/.test(id + " " + about),
    };
  }
  return { roles: [], vision: false };
}

export async function getGoogleModels(
  key: string,
  force = false,
): Promise<GoogleModel[]> {
  const id = await keyId(key);
  const old = catalogCache.get(id);
  if (!force && old && old.until > Date.now()) return await old.value;
  const value = (async () => {
    const models: GoogleModel[] = [];
    let pageToken = "";
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ pageSize: "1000" });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await googleFetch(key, `/models?${query}`);
      if (!response.ok) throw await googleResponseError(response);
      const data = await response.json();
      for (const raw of data.models ?? []) {
        const fullName = String(raw.name ?? "");
        const modelId = fullName.startsWith("models/") ? fullName.slice(7) : "";
        if (!/^[A-Za-z0-9._-]{1,160}$/.test(modelId)) continue;
        if (
          !Array.isArray(raw.supportedGenerationMethods) ||
          !raw.supportedGenerationMethods.includes("generateContent")
        ) continue;
        const description = String(raw.description ?? "").slice(0, 500);
        const { roles, vision } = classify(modelId, description);
        if (!roles.length) continue;
        models.push({
          id: modelId,
          name: String(raw.displayName ?? modelId).slice(0, 160),
          description,
          roles,
          vision,
          outputTokenLimit: Number(raw.outputTokenLimit) > 0
            ? Number(raw.outputTokenLimit)
            : undefined,
        });
      }
      pageToken = String(data.nextPageToken ?? "");
      if (!pageToken) break;
    }
    return models;
  })();
  catalogCache.set(id, { until: Date.now() + CATALOG_TTL, value });
  try {
    return await value;
  } catch (error) {
    catalogCache.delete(id);
    throw error;
  }
}

export async function getGoogleVoices(
  key: string,
  search = "",
  pageToken = "",
): Promise<{ voices: GoogleVoice[]; nextPageToken: string }> {
  const query = new URLSearchParams({
    page_size: "100",
    language_code: "de-DE",
  });
  if (search) query.set("search", search.slice(0, 80));
  if (pageToken) query.set("page_token", pageToken);
  const response = await googleFetch(key, `/voices?${query}`);
  if (!response.ok) throw await googleResponseError(response);
  const data = await response.json();
  return {
    voices: (Array.isArray(data.voices) ? data.voices : []).flatMap(
      (raw: Record<string, unknown>) => {
        const id = String(raw.id ?? "");
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return [];
        return [{
          id,
          name: String(raw.display_name ?? raw.displayName ?? id).slice(0, 120),
          language: String(raw.language_code ?? raw.languageCode ?? "").slice(
            0,
            30,
          ),
          description: String(raw.description ?? "").slice(0, 200),
        }];
      },
    ),
    nextPageToken: String(data.next_page_token ?? data.nextPageToken ?? ""),
  };
}

export async function googleGenerateContent(
  key: string,
  modelId: string,
  body: Record<string, unknown>,
  timeoutMs = 70_000,
): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(modelId)) {
    throw new Error("Ungültiges Google-Modell.");
  }
  const response = await googleFetch(
    key,
    `/models/${modelId}:generateContent`,
    body,
    timeoutMs,
  );
  if (!response.ok) throw await googleResponseError(response);
  return await response.json();
}

export async function googleInteraction(
  key: string,
  modelId: string,
  input: string,
): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(modelId)) {
    throw new Error("Ungültiges Google-Modell.");
  }
  const response = await googleFetch(key, "/interactions", {
    model: modelId,
    input,
  }, 180_000);
  if (!response.ok) throw await googleResponseError(response);
  return await response.json();
}

export async function googleUploadAudio(
  key: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ uri: string; name: string }> {
  if (
    !/^audio\/(?:wav|wave|x-wav|mpeg|mp3|mp4|m4a|ogg|webm|flac|aac)$/.test(
      mimeType,
    ) ||
    bytes.length < 1 || bytes.length > 2_000_000
  ) {
    throw new Error("Bitte eine unterstützte Audiodatei bis 2 MB auswählen.");
  }
  const start = await fetch(`${new URL(BASE).origin}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "classroom-audio" } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!start.ok) throw new Error(googleError(start.status));
  const uploadUrl = start.headers.get("x-goog-upload-url") ?? "";
  if (new URL(uploadUrl).origin !== new URL(BASE).origin) {
    throw new Error("Google hat keine sichere Upload-Adresse geliefert.");
  }
  const uploaded = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mimeType,
    },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!uploaded.ok) throw new Error(googleError(uploaded.status));
  const data = await uploaded.json();
  const uri = String(data.file?.uri ?? "");
  const name = String(data.file?.name ?? "");
  if (
    !uri.startsWith(`${BASE}/files/`) || !/^files\/[A-Za-z0-9_-]+$/.test(name)
  ) {
    throw new Error("Google hat keinen gültigen Dateiverweis geliefert.");
  }
  return { uri, name };
}

export async function googleDeleteFile(
  key: string,
  name: string,
): Promise<void> {
  if (!/^files\/[A-Za-z0-9_-]+$/.test(name)) return;
  await fetch(`${BASE}/${name}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

export function googleText(data: Record<string, unknown>): string {
  const candidates = data.candidates as
    | Array<{ content?: { parts?: Array<{ text?: string }> } }>
    | undefined;
  return (candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "")
    .join("").trim();
}

export function googleTranscriptionText(data: Record<string, unknown>): string {
  const candidates = data.candidates as
    | Array<{
      content?: { parts?: Array<{ audioTranscription?: { text?: string } }> };
    }>
    | undefined;
  return (candidates?.[0]?.content?.parts ?? []).map((part) =>
    part.audioTranscription?.text ?? ""
  ).join(" ").trim() || googleText(data);
}
