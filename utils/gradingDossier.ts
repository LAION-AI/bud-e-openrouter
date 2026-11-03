/** Deterministic evidence chain: source -> transcription -> content-bound report.
 * Never infer provenance from an LLM's name or from report completion order. */
import type { PageTranscript, SourceDoc, StudentPaper } from "./grading.ts";
import {
  gradingPaperKey,
  type GradingSession,
  validateGradingGroups,
} from "./gradingBatch.ts";
import { gradingHash } from "./gradingRecovery.ts";
import { gradingEvidenceWarnings } from "./gradingEvidence.ts";
import {
  gradingExportBlocks,
  gradingExportSheets,
  loadGradingFonts,
} from "./gradingExports.ts";
import { buildStudentGradingPdf } from "./gradingPdf.ts";
import { buildStudentGradingWord } from "./gradingDocx.ts";
import type { GradingSheet } from "./gradingPresentation.ts";
import {
  gradingOriginalImage,
  type GradingPageImage,
} from "./gradingOriginals.ts";

export type DossierWork = {
  id: string;
  paper: StudentPaper;
  report?: string;
  pages: { source: SourceDoc; transcript: PageTranscript }[];
};
export async function gradingDossierWorks(
  session: GradingSession,
  criteria: string,
): Promise<DossierWork[]> {
  if (
    session.pendingPages?.length ||
    session.pages.length !== session.sources.length
  ) {
    throw new Error(
      "Für die Prüfmappe fehlen noch Abschriften. Lade zunächst den Zwischenstand herunter und setze die Bearbeitung fort.",
    );
  }
  validateGradingGroups(session.papers, session.pages);
  if (session.cache?.criteria !== await gradingHash(criteria)) {
    throw new Error(
      "Die Bewertungen passen nicht zum aktuellen Maßstab. Bitte die Bewertung fortsetzen, bevor du die Prüfmappe erstellst.",
    );
  }
  const works: DossierWork[] = [];
  // Keep stable work IDs even if an ignored group occurs in between.
  for (const [at, paper] of session.papers.entries()) {
    const key = paper.ignored
      ? ""
      : await gradingPaperKey(session, criteria, paper);
    const report = paper.ignored ? undefined : session.cache.reports[key];
    if (!paper.ignored && (!report || !session.cache.checked?.includes(key))) {
      throw new Error(
        `Für „${paper.student}“ fehlt noch eine passende, fertig geprüfte Rückmeldung. Bitte die Bewertung fortsetzen. Es wird keine andere Rückmeldung zugeordnet.`,
      );
    }
    works.push({
      id: `Arbeit ${String(at + 1).padStart(2, "0")}`,
      paper,
      report,
      pages: paper.pages.map((n) => {
        const source = session.sources.find((s) => s.index === n),
          transcript = session.pages.find((p) => p.page === n);
        if (!source || !transcript) {
          throw new Error(`Original oder Abschrift zu Seite ${n} fehlt.`);
        }
        return { source, transcript };
      }),
    });
  }
  return works;
}
const para = (text: string) => ({ kind: "p" as const, runs: [{ text }] });
const sheet = (title: string, footer: string): GradingSheet => ({
  title,
  footer,
  showMetadata: false,
  name: "",
  className: "",
  date: "",
  version: "",
  blocks: [],
  teacherNotes: [],
});
export async function gradingDossierSheets(
  session: GradingSession,
  criteria: string,
  progress: (message: string) => void = () => {},
  render: (source: SourceDoc) => Promise<GradingPageImage> =
    gradingOriginalImage,
): Promise<GradingSheet[]> {
  const works = await gradingDossierWorks(session, criteria),
    sheets: GradingSheet[] = [];
  let done = 0;
  for (const work of works) {
    for (const [at, { source, transcript }] of work.pages.entries()) {
      progress(
        `Originalseite ${++done} von ${session.sources.length} wird übernommen · ${work.id}`,
      );
      const reference = `${work.id} · Original-ID ${source.index}`;
      const sourceLine = `Quelle: ${source.name} · Blatt ${
        at + 1
      } von ${work.pages.length} dieser Arbeit`;
      const original = sheet(
        `${work.id} · Original ${source.index}`,
        reference,
      );
      original.blocks = [
        para(
          `Zuordnung: ${work.paper.student}${
            work.paper.ignored ? " · nicht bewertet" : ""
          }`,
        ),
        para(sourceLine),
      ];
      if (source.kind === "text") {
        original.blocks.push(
          para(
            "Textabschnitt aus der hochgeladenen Datei; die ursprüngliche Word-Seitengestaltung ist hier nicht abgebildet.",
          ),
          para(source.content),
        );
      } else {
        const image = await render(source);
        const scale = Math.min(665 / image.width, 760 / image.height);
        original.fullPageImage = true;
        original.blocks.push({
          kind: "image",
          align: "center",
          src: image.src,
          widthPx: image.width * scale,
          heightPx: image.height * scale,
          alt: `${reference} · ${source.name}`,
        });
      }
      sheets.push(original);
      const copy = sheet(`${work.id} · Abschrift ${source.index}`, reference);
      copy.blocks = [
        para(`Zuordnung: ${work.paper.student}`),
        para(sourceLine),
        para(
          "KI-Abschrift – bitte mit der unmittelbar vorhergehenden Originalseite vergleichen. Unsichere Stellen sind keine gesicherten Schülerfehler.",
        ),
        // Keep literal markers (including crossed-out words), not a rewritten version.
        ...transcript.transcript.split(/\n\s*\n/).map(para),
        ...(transcript.figures?.length
          ? [
            para("Beschreibungen von Zeichnungen / Skizzen:"),
            ...transcript.figures.map(para),
          ]
          : []),
        ...(transcript.studentEvidence
          ? [para(`Hinweis zur Namenszuordnung: ${transcript.studentEvidence}`)]
          : []),
        ...(work.paper.note
          ? [para(`Hinweis zur Gruppierung: ${work.paper.note}`)]
          : []),
      ];
      sheets.push(copy);
    }
    if (work.paper.ignored) {
      const excluded = sheet(`${work.id} · Nicht bewertet`, work.id);
      excluded.blocks = [
        para(work.paper.student),
        para(`Original-IDs: ${work.paper.pages.join(", ")}`),
        para(`Begründung: ${work.paper.note}`),
      ];
      sheets.push(excluded);
    } else {
      const reports = gradingExportSheets(gradingExportBlocks(work.report!));
      if (!reports.length) {
        throw new Error(`Die Rückmeldung für ${work.id} ist leer.`);
      }
      for (const report of reports) {
        report.title = `${work.id} · Deine Rückmeldung`;
        report.footer = `${work.id} · Original-IDs: ${
          work.paper.pages.join(", ")
        }`;
        report.name ||= work.paper.student;
        report.blocks.unshift(
          para(
            `Zuordnung: ${work.paper.student} · Original-IDs: ${
              work.paper.pages.join(", ")
            }`,
          ),
        );
        const warnings = gradingEvidenceWarnings(
          work.pages.map((p) => p.transcript),
          work.report!,
        );
        if (warnings.length) {
          report.blocks.unshift(
            para(
              "PRÜFHINWEIS: Abschrift und Rückmeldung widersprechen sich bei einzelnen Einträgen. Diese Rückmeldung nicht ungeprüft weitergeben.",
            ),
            ...warnings.map(para),
          );
        }
        sheets.push(report);
      }
    }
  }
  return sheets;
}
export async function buildGradingDossier(
  session: GradingSession,
  criteria: string,
  pdf: boolean,
  progress: (message: string) => void,
): Promise<Uint8Array> {
  const sheets = await gradingDossierSheets(session, criteria, progress);
  progress(`${pdf ? "PDF" : "Word-Datei"} wird zusammengestellt …`);
  return pdf
    ? buildStudentGradingPdf(sheets, await loadGradingFonts())
    : buildStudentGradingWord(sheets);
}
