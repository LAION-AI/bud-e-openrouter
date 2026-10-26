import type { ResearchReport } from "./classroomResearch.ts";

export type ClassroomMessage = {
  role: "user" | "assistant";
  content: string;
  display?: string;
  imageIds?: string[];
  attachmentName?: string;
  sources?: Array<{ title: string; url: string }>;
  truncated?: boolean;
  outputLimit?: number;
  internal?: boolean;
  research?: ResearchReport;
  editor?: { kind: "docs" | "slides"; id: string; name: string };
};
export type ClassroomImage = { id: string; src: string; name: string };

const IMAGE_ID = /^(?:upl|gen)_\d{5}$/;
const IMAGE_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function imageIdsIn(text: string): string[] {
  return [...new Set(text.match(/\b(?:upl|gen)_\d{5}\b/g) ?? [])];
}

export function selectedImages(
  text: string,
  pending: string[],
  gallery: ClassroomImage[],
): ClassroomImage[] {
  const numbered = [
    ...text.matchAll(/\bBild(?:\s+Nr\.?|\s+Nummer)?\s+(\d{1,2})\b/gi),
  ]
    .map((match) => {
      const found = gallery[Number(match[1]) - 1];
      if (!found) {
        throw new Error(`Bild Nummer ${match[1]} wurde nicht gefunden.`);
      }
      return found.id;
    });
  const ids = [...new Set([...pending, ...imageIdsIn(text), ...numbered])];
  if (ids.length > 3) {
    throw new Error("Bitte höchstens drei Bilder auf einmal verwenden.");
  }
  return ids.map((id) => {
    const found = gallery.find((image) => image.id === id);
    if (!found) throw new Error(`Bild ${id} wurde nicht gefunden.`);
    return found;
  });
}

export function parseClassroomArchive(
  raw: unknown,
  slug: string,
): { messages: ClassroomMessage[]; gallery: ClassroomImage[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Das ist kein gültiger Klassenchat-Export.");
  }
  const data = raw as Record<string, unknown>;
  if (
    data.version !== 1 || data.slug !== slug ||
    !Array.isArray(data.messages) || data.messages.length > 100 ||
    !Array.isArray(data.gallery) || data.gallery.length > 20
  ) {
    throw new Error(
      "Diese Datei gehört nicht zu diesem Klassenchat oder ist ungültig.",
    );
  }
  const messages: ClassroomMessage[] = [];
  for (const message of data.messages) {
    if (
      !message || typeof message !== "object" ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      message.content.length > 1_000_000 ||
      (message.display !== undefined &&
        (typeof message.display !== "string" ||
          message.display.length > 4000)) ||
      (message.attachmentName !== undefined &&
        (typeof message.attachmentName !== "string" ||
          message.attachmentName.length > 120)) ||
      (message.imageIds !== undefined &&
        (!Array.isArray(message.imageIds) || message.imageIds.length > 3 ||
          message.imageIds.some((id: unknown) =>
            typeof id !== "string" || !IMAGE_ID.test(id)
          ))) ||
      (message.sources !== undefined &&
        (!Array.isArray(message.sources) || message.sources.length > 3 ||
          message.sources.some((source: unknown) => {
            if (!source || typeof source !== "object") return true;
            const item = source as Record<string, unknown>;
            return typeof item.title !== "string" ||
              item.title.length > 160 || typeof item.url !== "string" ||
              item.url.length > 500 ||
              !/^https:\/\/(?:[a-z]{2}\.wikipedia\.org\/wiki\/|doi\.org\/)/
                .test(item.url);
          }))) ||
      (message.truncated !== undefined &&
        typeof message.truncated !== "boolean") ||
      (message.outputLimit !== undefined &&
        (typeof message.outputLimit !== "number" ||
          !Number.isInteger(message.outputLimit) ||
          message.outputLimit < 1 || message.outputLimit > 64_000)) ||
      (message.internal !== undefined &&
        typeof message.internal !== "boolean") ||
      (message.research !== undefined &&
        !validResearchReport(message.research)) ||
      (message.editor !== undefined && (!message.editor ||
        !["docs", "slides"].includes(message.editor.kind) ||
        typeof message.editor.id !== "string" ||
        message.editor.id.length > 120 ||
        typeof message.editor.name !== "string" ||
        message.editor.name.length > 120))
    ) {
      throw new Error("Die Datei enthält ungültige Nachrichten.");
    }
    messages.push({
      role: message.role,
      content: message.content,
      ...(message.display ? { display: message.display } : {}),
      ...(message.attachmentName
        ? { attachmentName: message.attachmentName }
        : {}),
      ...(message.imageIds ? { imageIds: message.imageIds } : {}),
      ...(message.sources ? { sources: message.sources } : {}),
      ...(message.truncated ? { truncated: true } : {}),
      ...(message.outputLimit ? { outputLimit: message.outputLimit } : {}),
      ...(message.internal ? { internal: true } : {}),
      ...(message.research ? { research: message.research } : {}),
      ...(message.editor ? { editor: message.editor } : {}),
    });
  }
  const gallery: ClassroomImage[] = [];
  const seen = new Set<string>();
  for (const image of data.gallery) {
    if (
      !image || typeof image !== "object" ||
      typeof image.id !== "string" || !IMAGE_ID.test(image.id) ||
      seen.has(image.id) ||
      typeof image.src !== "string" || image.src.length > 700_000 ||
      !IMAGE_URL.test(image.src) ||
      typeof image.name !== "string" || image.name.length > 120
    ) {
      throw new Error("Die Datei enthält ungültige Bilder.");
    }
    seen.add(image.id);
    gallery.push({ id: image.id, src: image.src, name: image.name });
  }
  return { messages, gallery };
}

function validResearchReport(value: unknown): value is ResearchReport {
  if (!value || typeof value !== "object") return false;
  const r = value as ResearchReport;
  return ["wikipedia", "papers"].includes(r.kind) &&
    typeof r.query === "string" && r.query.length <= 160 &&
    typeof r.at === "string" && r.at.length < 40 &&
    Number.isFinite(Date.parse(r.at)) &&
    (r.error === undefined ||
      (typeof r.error === "string" && r.error.length <= 2000)) &&
    Array.isArray(r.requests) && r.requests.length <= 2 &&
    r.requests.every((q) =>
      q && typeof q.url === "string" && q.url.length <= 2500 &&
      /^https:\/\/(?:[a-z]{2}\.wikipedia\.org\/w\/api\.php\?|api\.ask\.orkg\.org\/index\/search\?)/
        .test(q.url) &&
      Number.isInteger(q.status) && q.status >= 0 && q.status <= 599 &&
      typeof q.body === "string" && q.body.length <= 60_000 &&
      typeof q.truncated === "boolean"
    );
}
