/** Local-only page preparation: PDFs, Word documents and bounded ZIP archives. */
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import type { SourceDoc } from "./grading.ts";
import {
  base64Bytes,
  MAX_GRADING_TOTAL_BYTES,
  MAX_PDF_BYTES,
} from "./uploadLimits.ts";
export function gradingBase64(bytes: Uint8Array): string {
  let value = "";
  for (let at = 0; at < bytes.length; at += 32768) {
    value += String.fromCharCode(...bytes.subarray(at, at + 32768));
  }
  return btoa(value);
}
export function gradingUnbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
const toBase64 = gradingBase64, fromBase64 = gradingUnbase64;

export const MAX_GRADING_PAGES = 300;
export const MAX_GRADING_UPLOADS = 60;
const MAX_UNPACKED = 80_000_000;
const SUPPORTED = /\.(?:pdf|docx?|png|jpe?g|webp|txt|md|odt)$/i;
export type ArchiveEntry = { name: string; data: Uint8Array };
export async function readGradingZip(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<ArchiveEntry[]> {
  if (bytes.length > MAX_GRADING_TOTAL_BYTES) {
    throw new Error("ZIP ist größer als 40 MB.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65557);
    at--
  ) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("Keine gültige ZIP-Datei.");
  const count = view.getUint16(end + 10, true);
  if (count > 512 || count === 0xffff || view.getUint16(end + 4, true) !== 0) {
    throw new Error(
      "Das Archiv ist zu groß oder verwendet ein nicht unterstütztes ZIP-Format.",
    );
  }
  let at = view.getUint32(end + 16, true), total = 0;
  const entries: ArchiveEntry[] = [], names = new Set<string>();
  for (let n = 0; n < count; n++) {
    signal?.throwIfAborted();
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) {
      throw new Error("Beschädigtes ZIP-Verzeichnis.");
    }
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true),
      declared = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (at + 46 + nameLength + extra + comment > end) {
      throw new Error("Beschädigtes ZIP-Verzeichnis.");
    }
    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    ).replace(/\\/g, "/");
    at += 46 + nameLength + extra + comment;
    if (
      name.endsWith("/") || name.startsWith("__MACOSX/") ||
      /(?:^|\/)\._/.test(name)
    ) continue;
    if (
      name.startsWith("/") || /(?:^|\/)\.\.(?:\/|$)|\0|^[A-Za-z]:/.test(name) ||
      names.has(name)
    ) throw new Error("Unsicherer oder doppelter ZIP-Dateiname.");
    names.add(name);
    if (flags & 1 || ![0, 8].includes(method)) {
      throw new Error(
        "Verschlüsselte oder ungewöhnlich komprimierte ZIP-Dateien bitte vorher entpacken.",
      );
    }
    if (declared > MAX_GRADING_TOTAL_BYTES || total + declared > MAX_UNPACKED) {
      throw new Error("Das entpackte Archiv überschreitet 80 MB.");
    }
    if (
      local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50
    ) throw new Error("Beschädigter ZIP-Eintrag.");
    const start = local + 30 + view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    if (start + compressed > bytes.length) {
      throw new Error("Unvollständiger ZIP-Eintrag.");
    }
    const raw = bytes.subarray(start, start + compressed);
    const stream = method === 0
      ? new Blob([raw]).stream()
      : new Blob([raw]).stream().pipeThrough(
        new DecompressionStream("deflate-raw"),
      );
    const reader = stream.getReader(), parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal?.throwIfAborted();
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > declared || total + size > MAX_UNPACKED) {
          throw new Error(
            "ZIP-Datei entfaltet zu viele Daten (Abbruch zum Schutz des Browsers).",
          );
        }
        parts.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (size !== declared) throw new Error("ZIP-Größenangaben stimmen nicht.");
    const data = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }
    total += size;
    entries.push({ name, data });
  }
  return entries;
}
const xmlText = (text: string) =>
  text.replace(
    /&#x([0-9a-f]+);/gi,
    (_, n) => String.fromCodePoint(parseInt(n, 16)),
  ).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(
    /&lt;/g,
    "<",
  ).replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
function attribute(xml: string, key: string): string {
  return xmlText(new RegExp(`\\b${key}=["']([^"']*)["']`).exec(xml)?.[1] ?? "");
}
/** Word has no stable automatic pagination. Keep explicit page breaks and every
 * embedded photo, and split repeated Name: headings into independent sections. */
export async function wordGradingSources(
  name: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<SourceDoc[]> {
  const entries = await readGradingZip(bytes, signal), dec = new TextDecoder();
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (!document) {
    throw new Error(
      `„${name}“ ist keine DOCX-Datei. Alte .doc-Dateien bitte als DOCX oder PDF speichern.`,
    );
  }
  const rels = dec.decode(
    entries.find((entry) => entry.name === "word/_rels/document.xml.rels")
      ?.data ?? new Uint8Array(),
  );
  const images = new Map<string, ArchiveEntry>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const id = attribute(match[0], "Id"),
      target = attribute(match[0], "Target");
    if (
      !/\/image$/.test(attribute(match[0], "Type")) ||
      /External/i.test(attribute(match[0], "TargetMode"))
    ) continue;
    const path = target.startsWith("/")
      ? target.slice(1)
      : "word/" + target.replace(/^\.\//, "");
    const image = entries.find((entry) => entry.name === path);
    if (image) images.set(id, image);
  }
  const sources: SourceDoc[] = [];
  let text = "", part = 1, hasName = false;
  const flush = () => {
    if (text.trim()) {
      sources.push({
        index: 0,
        name: `${name} · Abschnitt ${part++}`,
        kind: "text",
        content: text.trim(),
      });
      text = "";
      hasName = false;
    }
  };
  const xml = dec.decode(document.data);
  const tokens =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:br|lastRenderedPageBreak|pageBreakBefore|tab)\b[^>]*\/?\s*>|<\/(?:w:p|w:tc)>|<(?:a:blip|v:imagedata)\b[^>]*\/?\s*>/g;
  for (const token of xml.matchAll(tokens)) {
    signal?.throwIfAborted();
    if (token[1] !== undefined) {
      const next = xmlText(token[1]);
      if (/^\s*Name\s*:/i.test(next) && hasName) flush();
      if (/\bName\s*:/i.test(next)) hasName = true;
      text += next;
      if (text.length > 8000) flush();
    } else if (
      /lastRenderedPageBreak|pageBreakBefore|w:type=["']page/.test(token[0])
    ) flush();
    else if (/<(?:a:blip|v:imagedata)/.test(token[0])) {
      flush();
      const id = attribute(token[0], "r:embed") || attribute(token[0], "r:id");
      const image = images.get(id);
      if (!image) {
        throw new Error(
          `Ein eingebettetes Bild in „${name}“ konnte nicht gelesen werden. Bitte als PDF exportieren.`,
        );
      }
      const mime = /\.png$/i.test(image.name)
        ? "image/png"
        : /\.webp$/i.test(image.name)
        ? "image/webp"
        : /\.jpe?g$/i.test(image.name)
        ? "image/jpeg"
        : "";
      if (!mime) {
        throw new Error(
          "Ein Word-Bildformat wird nicht unterstützt. Bitte als PDF exportieren.",
        );
      }
      sources.push({
        index: 0,
        name: `${name} · Foto ${part++}`,
        kind: "image",
        content: `data:${mime};base64,${toBase64(image.data)}`,
      });
    } else text += /w:tab|w:tc/.test(token[0]) ? "\t" : "\n";
  }
  flush();
  if (!sources.length) {
    throw new Error(`„${name}“ enthält keine lesbaren Inhalte.`);
  }
  return sources;
}
export async function filesForGrading(
  files: File[],
  signal?: AbortSignal,
): Promise<SourceDoc[]> {
  const sources: SourceDoc[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    if (
      file.size >
        (/\.zip$/i.test(file.name) ? MAX_GRADING_TOTAL_BYTES : MAX_PDF_BYTES)
    ) {
      throw new Error(
        "PDF-/Word-/Fotodateien bis 20 MB, ZIP bis 40 MB verwenden.",
      );
    }
    const entries = /\.zip$/i.test(file.name)
      ? await readGradingZip(new Uint8Array(await file.arrayBuffer()), signal)
      : [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }];
    let found = 0;
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (!SUPPORTED.test(entry.name)) continue;
      found++;
      if (entry.data.length > MAX_PDF_BYTES) {
        throw new Error(`„${entry.name}“ ist größer als 20 MB.`);
      }
      if (/\.docx?$/i.test(entry.name)) {
        sources.push(
          ...await wordGradingSources(entry.name, entry.data, signal),
        );
      } else if (/\.pdf$/i.test(entry.name)) {
        sources.push({
          index: 0,
          name: entry.name,
          kind: "pdf",
          content: "data:application/pdf;base64," + toBase64(entry.data),
        });
      } else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) {
        const ext = entry.name.split(".").at(-1)!.toLowerCase();
        sources.push({
          index: 0,
          name: entry.name,
          kind: "image",
          content: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${
            toBase64(entry.data)
          }`,
        });
      } else {
        const { extractDocumentText } = await import("./documentText.ts");
        const result = await extractDocumentText(entry.name, entry.data);
        if (result.chars > result.text.length) {
          throw new Error(
            `„${entry.name}“ ist zu lang. Bitte als PDF hochladen, damit nichts abgeschnitten wird.`,
          );
        }
        for (let at = 0; at < result.text.length; at += 8000) {
          sources.push({
            index: 0,
            name: `${entry.name} · Abschnitt ${at / 8000 + 1}`,
            kind: "text",
            content: result.text.slice(at, at + 8000),
          });
        }
      }
      if (sources.length > MAX_GRADING_PAGES) {
        throw new Error(
          `Mehr als ${MAX_GRADING_PAGES} Seiten/Abschnitte. Bitte den Stapel aufteilen.`,
        );
      }
    }
    if (!found) {
      throw new Error(
        `In „${file.name}“ wurden keine PDF-, Word-, Text- oder Fotodateien gefunden. ZIP-Unterordner werden durchsucht, verschachtelte ZIPs bitte vorher entpacken.`,
      );
    }
  }
  return sources;
}
/** PDF page count is determined locally, never guessed by an LLM. */
export async function splitGradingPdfs(
  raw: SourceDoc[],
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<SourceDoc[]> {
  const result: SourceDoc[] = [];
  let total = 0;
  for (const source of raw) {
    signal.throwIfAborted();
    if (source.kind === "pdf") {
      const pdf = await PDFDocument.load(
        fromBase64(source.content.split(",")[1]),
        { updateMetadata: false },
      );
      const count = pdf.getPageCount();
      if (result.length + count > MAX_GRADING_PAGES) {
        throw new Error(
          `Mehr als ${MAX_GRADING_PAGES} Seiten. Bitte die Dateien in kleinere Stapel aufteilen.`,
        );
      }
      for (let n = 0; n < count; n++) {
        signal.throwIfAborted();
        progress(`${source.name}: Seite ${n + 1}/${count} wird vorbereitet`);
        const page = await PDFDocument.create();
        const [copy] = await page.copyPages(pdf, [n]);
        page.addPage(copy);
        const bytes = await page.save();
        total += bytes.length;
        if (total > MAX_UNPACKED || bytes.length > MAX_PDF_BYTES) {
          throw new Error(
            "Die aufgeteilten Seiten sind zu groß. Bitte kleinere Stapel verwenden.",
          );
        }
        result.push({
          index: result.length + 1,
          name: `${source.name.slice(0, 80)} · Seite ${n + 1} von ${count}`,
          kind: "pdf",
          content: "data:application/pdf;base64," + toBase64(bytes),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } else {
      total += source.kind === "text"
        ? source.content.length
        : base64Bytes(source.content.split(",")[1]);
      if (total > MAX_UNPACKED) {
        throw new Error("Die vorbereiteten Seiten überschreiten 80 MB.");
      }
      result.push({ ...source, index: result.length + 1 });
    }
    if (result.length > MAX_GRADING_PAGES) {
      throw new Error(`Höchstens ${MAX_GRADING_PAGES} Seiten/Abschnitte pro Durchgang.`);
    }
  }
  return result;
}
