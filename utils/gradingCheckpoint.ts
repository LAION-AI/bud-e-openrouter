/** Portable, local-only snapshots. Never include credentials or room settings. */
import type { PageTranscript, SourceDoc } from "./grading.ts";
import type { GradingSession, GradingStatus } from "./gradingBatch.ts";
import { validateGradingGroups } from "./gradingBatch.ts";
import { base64Bytes, MAX_PDF_BASE64, validPdfBase64 } from "./uploadLimits.ts";
import { MAX_GRADING_PAGES } from "./gradingUploads.ts";
import { gradingReportIssues } from "./gradingRecovery.ts";

export const MAX_CHECKPOINT_BYTES = 180_000_000;
export type GradingCheckpoint = {
  format: "bude-grading";
  version: 1;
  createdAt: string;
  work: GradingSession;
  criteria: string;
  feedback: string;
  automatic: boolean;
  groups: Array<
    { student: string; pages: string; note: string; ignored?: boolean }
  >;
  status: GradingStatus | null;
  steps: string[];
  report: string;
  lastAction: "transcribe" | "mark";
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ungültiger Zwischenstand: Objekt erwartet.");
  }
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) {
    throw new Error("Ungültiger oder zu langer Text im Zwischenstand.");
  }
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error("Ungültige oder zu große Liste im Zwischenstand.");
  }
  return value;
}
function stringList(value: unknown, count = 100, length = 10000) {
  return array(value ?? [], count).map((v) => string(v, length));
}
function cacheRecord(
  value: unknown,
  chunks = false,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, entry] of Object.entries(record(value ?? {}))) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      Object.keys(result).length >= MAX_GRADING_PAGES
    ) throw new Error("Ungültiger Bewertungsspeicher.");
    result[key] = chunks
      ? stringList(entry, 20, 100000)
      : string(entry, 100000);
  }
  return result;
}
export function parseGradingCheckpoint(text: string): GradingCheckpoint {
  if (text.length > MAX_CHECKPOINT_BYTES) {
    throw new Error("Zwischenstand ist größer als 180 MB.");
  }
  const root = record(JSON.parse(text));
  if (root.format !== "bude-grading" || root.version !== 1) {
    throw new Error("Keine unterstützte Bud-E-Korrekturdatei (Version 1).");
  }
  const raw = record(root.work), prepared = raw.prepared === true;
  let bytes = 0;
  const sources: SourceDoc[] = array(raw.sources, MAX_GRADING_PAGES).map(
    (v, at) => {
      const item = record(v), kind = item.kind;
      const name = string(item.name, 200),
        content = string(item.content, MAX_PDF_BASE64 + 100);
      if (
        !["pdf", "image", "text"].includes(String(kind)) || !name ||
        name.includes("\0")
      ) throw new Error("Ungültige Quelldatei im Zwischenstand.");
      if (kind === "text") {
        string(content, 60000);
        bytes += new TextEncoder().encode(content).length;
      } else {
        const match =
          /^(data:(?:application\/pdf|image\/(?:jpeg|png|webp));base64,)([A-Za-z0-9+/]*={0,2})$/
            .exec(content);
        if (
          !match || (kind === "pdf") !== match[1].includes("application/pdf") ||
          !validPdfBase64(match[2])
        ) throw new Error("Beschädigte Quelldaten im Zwischenstand.");
        if (
          prepared && kind === "image" &&
          (content.length > 700000 || match[1].includes("webp"))
        ) {
          throw new Error(
            "Vorbereitete Bilder müssen komprimiertes JPEG/PNG sein.",
          );
        }
        bytes += base64Bytes(match[2]);
      }
      if (bytes > (prepared ? 80_000_000 : 40_000_000)) {
        throw new Error("Die Quelldateien im Zwischenstand sind zu groß.");
      }
      if (prepared && item.index !== at + 1) {
        throw new Error("Ungültige Seitennummerierung im Zwischenstand.");
      }
      return { index: at + 1, name, kind: kind as SourceDoc["kind"], content };
    },
  );
  const used = new Set<number>();
  const pages: PageTranscript[] = array(raw.pages, sources.length).map((v) => {
    const item = record(v), page = Number(item.page);
    if (
      !prepared || !Number.isInteger(page) || page < 1 ||
      page > sources.length || used.has(page)
    ) throw new Error("Doppelte oder unbekannte Abschriftseite.");
    used.add(page);
    if (item.file !== undefined && item.file !== sources[page - 1].name) {
      throw new Error("Datei und Abschriftseite passen nicht zusammen.");
    }
    return {
      page,
      file: sources[page - 1].name,
      student: string(item.student, 120),
      studentEvidence: string(item.studentEvidence ?? "", 4000),
      transcript: string(item.transcript, 60000),
      tasks: stringList(item.tasks),
      figures: stringList(item.figures),
      continues: item.continues === true,
    };
  });
  const papersRaw = array(raw.papers, sources.length);
  if (papersRaw.length && pages.length !== sources.length) {
    throw new Error("Zuordnung enthält noch nicht abgeschriebene Seiten.");
  }
  const papers = papersRaw.length
    ? validateGradingGroups(papersRaw, pages)
    : [];
  const work: GradingSession = { sources, pages, papers, prepared, issues: {} };
  if (raw.pendingPages !== undefined) {
    const pending = array(raw.pendingPages, MAX_GRADING_PAGES);
    if (
      pending.some((n) =>
        !Number.isInteger(n) || !sources.some((s) => s.index === n)
      ) || new Set(pending).size !== pending.length
    ) throw new Error("Ungültige Seiten für erneute Abschrift.");
    work.pendingPages = pending as number[];
  }
  if (raw.selectionChecks !== undefined) {
    work.selectionChecks = stringList(
      raw.selectionChecks,
      MAX_GRADING_PAGES,
      64,
    );
    if (work.selectionChecks.some((key) => !/^[a-f0-9]{64}$/.test(key))) {
      throw new Error("Ungültiger Nachweis der Seitenauswahl.");
    }
  }
  for (const [key, value] of Object.entries(record(raw.issues ?? {}))) {
    if (Object.keys(work.issues!).length >= 600) {
      throw new Error("Zu viele Fehlermeldungen.");
    }
    work.issues![string(key, 200)] = string(value, 4000);
  }
  if (raw.cache) {
    const cache = record(raw.cache);
    const criteria = string(cache.criteria, 64);
    if (!/^[a-f0-9]{64}$/.test(criteria)) {
      throw new Error("Ungültiger Kriterien-Fingerabdruck.");
    }
    work.cache = {
      criteria,
      reports: cacheRecord(cache.reports) as Record<string, string>,
      chunks: cacheRecord(cache.chunks, true) as Record<string, string[]>,
      checked: stringList(cache.checked, MAX_GRADING_PAGES, 64),
      guidanceParts: cacheRecord(cache.guidanceParts) as Record<string, string>,
      guidanceDrafts: cacheRecord(cache.guidanceDrafts) as Record<
        string,
        string
      >,
    };
    if (cache.guidance !== undefined) {
      const guidance = record(cache.guidance);
      const signature = string(guidance.signature, 64);
      if (!/^[a-f0-9]{64}$/.test(signature)) {
        throw new Error("Ungültiger Maßstab-Fingerabdruck.");
      }
      work.cache.guidance = { signature, text: string(guidance.text, 30000) };
    }
    if (
      work.cache.checked!.some((key) =>
        !/^[a-f0-9]{64}$/.test(key) || !Object.hasOwn(work.cache!.reports, key)
      ) || new Set(work.cache.checked).size !== work.cache.checked!.length
    ) throw new Error("Ungültige Nachweise der Zweitprüfung.");
    work.cache.checked = work.cache.checked!.filter((key) =>
      !gradingReportIssues(work.cache!.reports[key]).length
    );
  }
  const groups = array(root.groups ?? [], MAX_GRADING_PAGES).map((v) => {
    const item = record(v);
    return {
      student: string(item.student, 120),
      pages: string(item.pages, 2000),
      note: string(item.note ?? "", 4000),
      ...(item.ignored === true ? { ignored: true } : {}),
    };
  });
  let status: GradingStatus | null = null;
  if (root.status) {
    const item = record(root.status);
    if (
      !["prepare", "transcribe", "group", "review", "mark", "done"].includes(
        String(item.stage),
      ) || !Number.isInteger(item.completed) || !Number.isInteger(item.total) ||
      Number(item.completed) < 0 ||
      Number(item.total) < Number(item.completed) || Number(item.total) > 600
    ) throw new Error("Ungültige Fortschrittsangabe.");
    status = {
      stage: item.stage as GradingStatus["stage"],
      completed: Number(item.completed),
      total: Number(item.total),
    };
  }
  return {
    format: "bude-grading",
    version: 1,
    createdAt: string(root.createdAt, 100),
    work,
    criteria: string(root.criteria, 20000),
    feedback: string(root.feedback, 8000),
    automatic: root.automatic === true,
    groups,
    status,
    steps: stringList(root.steps, 500, 4000),
    report: string(root.report ?? "", 980000),
    lastAction: root.lastAction === "mark" ? "mark" : "transcribe",
  };
}

export function serializeGradingCheckpoint(value: GradingCheckpoint): string {
  // Round-trip through the allowlist: unknown properties (e.g. API keys) never
  // leave the browser as part of a checkpoint.
  const json = JSON.stringify(value);
  return JSON.stringify(parseGradingCheckpoint(json));
}
