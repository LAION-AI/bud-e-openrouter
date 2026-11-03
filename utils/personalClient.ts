import {
  decryptPersonal,
  encryptPersonal,
  fromBase64,
  toBase64,
} from "./personalCrypto.ts";
export type PersonalProvider =
  | "openrouter"
  | "requesty"
  | "google"
  | "compatible";
export type PersonalRole = "chat" | "tts" | "asr" | "image";
export type PersonalSettings = {
  provider: PersonalProvider;
  key: string;
  baseUrl: string;
  models: Record<PersonalRole, string>;
  enabled: Record<PersonalRole, boolean>;
  voice: string;
  style: string;
};
export type PersonalMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images: string[];
  createdAt: number;
  generation?: "chat" | "image";
  gradingReport?: boolean;
};
export type PersonalBranch = {
  chatId: string;
  messageId: string;
  kind: "branch" | "edit" | "regenerate";
};
export type PersonalChat = {
  id: string;
  messages: PersonalMessage[];
  branch?: PersonalBranch;
};
export type PersonalChatMeta = {
  id: string;
  title: string;
  updatedAt: number;
  branch?: PersonalBranch;
};
export type PersonalIndex = {
  version: 1;
  settings: PersonalSettings;
  chats: PersonalChatMeta[];
  active: string;
};
export type PersonalManifest = {
  records: { id: string; revision: number; bytes: number; updatedAt: number }[];
  usedBytes: number;
  quotaBytes: number;
};
export const personalDefaults = (): PersonalSettings => ({
  provider: "openrouter",
  key: "",
  baseUrl: "",
  models: { chat: "", tts: "", asr: "", image: "" },
  enabled: { chat: true, tts: false, asr: false, image: false },
  voice: "",
  style: "Sprich freundlich, klar und natürlich auf Deutsch.",
});
export class PersonalApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
export async function personalApi(
  query: string,
  data?: unknown,
  method = "POST",
): Promise<Record<string, unknown>> {
  const response = await fetch("/api/personal" + query, {
    method: data === undefined ? "GET" : method,
    credentials: "same-origin",
    cache: "no-store",
    ...(data !== undefined
      ? {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new PersonalApiError(
      result.error ?? "Der persönliche Speicher antwortet nicht.",
      response.status,
    );
  }
  return result;
}
export class PersonalVault {
  manifest: PersonalManifest = {
    records: [],
    usedBytes: 0,
    quotaBytes: 100 * 1024 * 1024,
  };
  private cache = new Map<string, unknown>();
  private busy = false;
  constructor(readonly slug: string, readonly key: CryptoKey) {}
  async refresh() {
    this.manifest = await personalApi(
      "?slug=" + encodeURIComponent(this.slug),
    ) as unknown as PersonalManifest;
    return this.manifest;
  }
  revision(id: string) {
    return this.manifest.records.find((record) => record.id === id)?.revision ??
      0;
  }
  async read<T>(id: string, force = false): Promise<T> {
    if (!force && this.cache.has(id)) return this.cache.get(id) as T;
    const record = await personalApi(
      "?slug=" + encodeURIComponent(this.slug) + "&id=" +
        encodeURIComponent(id),
    );
    const value = await decryptPersonal<T>(
      this.key,
      this.slug,
      id,
      fromBase64(String(record.value)),
    );
    const entry = this.manifest.records.find((row) => row.id === id);
    if (entry) entry.revision = Number(record.revision);
    this.cache.set(id, value);
    return value;
  }
  async save(values: { id: string; value: unknown }[], remove: string[] = []) {
    if (this.busy) {
      throw new Error("Ein Speichervorgang läuft bereits. Bitte kurz warten.");
    }
    this.busy = true;
    try {
      const writes = await Promise.all(
        values.map(async (entry) => ({
          id: entry.id,
          revision: this.revision(entry.id),
          value: toBase64(
            await encryptPersonal(this.key, this.slug, entry.id, entry.value),
          ),
        })),
      );
      const deletes = remove.map((id) => ({ id, revision: this.revision(id) }));
      this.manifest = await personalApi("", {
        slug: this.slug,
        writes,
        deletes,
      }, "PUT") as unknown as PersonalManifest;
      values.forEach((entry) =>
        this.cache.set(entry.id, structuredClone(entry.value))
      );
      remove.forEach((id) => this.cache.delete(id));
    } finally {
      this.busy = false;
    }
  }
  clear() {
    this.cache.clear();
  }
}
/** JPEG normalization happens before encryption; original PNGs are not uploaded. */
export async function personalJpeg(input: Blob): Promise<string> {
  if (
    input.size > 15 * 1024 * 1024 ||
    !/^image\/(png|jpeg|webp)$/.test(input.type)
  ) throw new Error("Bitte PNG-, JPEG- oder WebP-Bilder bis 15 MB wählen.");
  const bitmap = await createImageBitmap(input);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) {
      throw new Error(
        "Dieses Bild hat zu viele Pixel. Bitte zuerst verkleinern.",
      );
    }
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(
        "Bildverarbeitung ist in diesem Browser nicht verfügbar.",
      );
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.8, .65, .5, .35]) {
      const jpeg = canvas.toDataURL("image/jpeg", quality);
      if (jpeg.startsWith("data:image/jpeg;") && jpeg.length < 1_200_000) {
        return jpeg;
      }
    }
    throw new Error("Dieses Bild ist zu groß. Bitte zuerst verkleinern.");
  } finally {
    bitmap.close();
  }
}
