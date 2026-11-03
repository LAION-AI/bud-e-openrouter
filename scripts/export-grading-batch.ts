/** Export complete, independently reviewed classroom proposals per pupil.
 * No model calls; never treats unreviewed drafts as completed feedback. */
import { parseGradingCheckpoint } from "../utils/gradingCheckpoint.ts";
import { gradingHash } from "../utils/gradingRecovery.ts";
import {
  buildGradingPdf,
  buildGradingWord,
  gradingExportBlocks,
} from "../utils/gradingExports.ts";
import { writeZip, type ZipEntry } from "../utils/docx.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { parallelGrading } from "../utils/gradingBatch.ts";

const [input, destination] = Deno.args;
if (!input || !destination) {
  throw new Error("checkpoint.json and output directory required");
}
const checkpoint = parseGradingCheckpoint(await Deno.readTextFile(input));
const work = checkpoint.work;
if (!checkpoint.report || !work.cache) {
  throw new Error("No complete final report in checkpoint");
}
const cache = work.cache;
if (work.pendingPages?.length) {
  throw new Error("Pages still waiting for transcription");
}
const criteria = checkpoint.criteria.trim() +
  (checkpoint.feedback.trim()
    ? "\n\nKorrekturen und Feedback der Lehrkraft zur Abschrift/Zuordnung (diese berichtigen die ursprüngliche Lesung):\n" +
      checkpoint.feedback.trim()
    : "");
if (await gradingHash(criteria) !== work.cache.criteria) {
  throw new Error("Criteria/cache fingerprint mismatch");
}
await Deno.mkdir(destination, { recursive: true, mode: 0o700 });
await Deno.mkdir(destination + "/Einzelrueckmeldungen", {
  recursive: true,
  mode: 0o700,
});
const fonts = await Promise.all(
  ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) =>
    Deno.readFile(new URL("../static/fonts/" + name, import.meta.url))
  ),
) as [Uint8Array, Uint8Array];
const zip: ZipEntry[] = [];
try {
  zip.push({
    name: "ZUERST-LESEN.txt",
    data: await Deno.readFile(destination + "/ZUERST-LESEN.txt"),
  });
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}
const manifest: Array<Record<string, unknown>> = [];
const csv = (value: unknown) =>
  '"' + String(value ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""') +
  '"';

function audit(text: string) {
  const rows: Array<{ label: string; points: number; max: number }> = [];
  const warnings: string[] = [];
  for (const block of gradingExportBlocks(text)) {
    if (block.kind !== "table") continue;
    const table = block.rows.map((row) =>
      row.map((runs) => runs.map((run) => run.text).join(""))
    );
    const col = table[0]?.findIndex((cell) => /punkte|points/i.test(cell)) ??
      -1;
    if (col < 0) continue;
    for (const cells of table.slice(1)) {
      const match = /^\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/.exec(
        cells[col],
      );
      if (
        !match || /gesamt|summe|zwischenstand|zwischenergebnis/i.test(cells[0])
      ) continue;
      const points = Number(match[1].replace(",", ".")),
        max = Number(match[2].replace(",", "."));
      if (points > max) {
        warnings.push("Einzelpunkte über dem Maximum: " + cells[0]);
      }
      rows.push({ label: cells[0], points, max });
    }
  }
  const gapRows = rows.filter((row) => row.max === 1);
  const other = rows.filter((row) =>
    row.max !== 1 && !(gapRows.length && row.max === 15)
  );
  const counted = [...gapRows, ...other];
  const tablePoints = counted.reduce((sum, row) => sum + row.points, 0);
  const tableMaximum = counted.reduce((sum, row) => sum + row.max, 0);
  const lines = text.replace(/\*\*/g, "").split("\n");
  // This diagnostic is deliberately specific to the supplied 8d rubric:
  // 15 gap points plus two short tasks worth two points each. It must not
  // become a hardcoded scoring policy for other uploaded assessments.
  const taskPoints: Array<{ task: number; points: number; max: number }> = [];
  for (const task of [1, 2, 3]) {
    const expected = task === 1 ? 15 : 2;
    const start = lines.findIndex((line) =>
      new RegExp(`^\\s*(?:#{1,4}\\s*)?Aufgabe\\s*${task}\\b`, "i").test(line)
    );
    if (start < 0) continue;
    let end = lines.findIndex((line, at) => {
      if (at <= start) return false;
      const otherTask = /^\s*(?:#{1,4}\s*)?Aufgabe\s*(\d+)\b/i.exec(line);
      return !!(otherTask && Number(otherTask[1]) !== task) ||
        /^\s*(?:#{1,4}\s*)?(?:Gesamt|Punktestand)\b/i.test(line);
    });
    if (end < 0) end = lines.length;
    const values = [
      ...lines.slice(start, end).join("\n").matchAll(
        new RegExp(`(?<![\\d/])(\\d+)\\s*\\/\\s*${expected}(?!\\d)`, "g"),
      ),
    ].map((match) => Number(match[1]));
    const unique = [...new Set(values)];
    if (unique.length === 1) {
      taskPoints.push({ task, points: unique[0], max: expected });
    } else if (unique.length > 1) {
      warnings.push(
        `Aufgabe ${task}: verschiedene Teilpunktsummen gefunden; bitte prüfen.`,
      );
    }
  }
  const computed = taskPoints.reduce((sum, task) => sum + task.points, 0);
  const max = taskPoints.reduce((sum, task) => sum + task.max, 0);
  let claimed: number | null = null, claimedMax: number | null = null;
  for (let at = 0; at < lines.length; at++) {
    if (!/gesamt|sicher erreicht|punktestand/i.test(lines[at])) continue;
    const match = /(\d+)\s*\/\s*(\d+)/.exec(lines.slice(at, at + 3).join(" "));
    if (match && Number(match[2]) === 19) {
      claimed = Number(match[1]);
      claimedMax = 19;
    }
  }
  if (max === 19 && claimed !== null && computed !== claimed) {
    warnings.push(
      `Punktesumme widersprüchlich: Teilaufgaben ${computed}/19, Gesamt ${claimed}/19`,
    );
  }
  const gaps = taskPoints.find((task) => task.task === 1);
  if (gaps && tableMaximum === 15 && tablePoints !== gaps.points) {
    warnings.push(
      `Lückentabelle ${tablePoints}/15 widerspricht Aufgabe 1 (${gaps.points}/15).`,
    );
  }
  if (/unleserlich|unsicher|\[\?|\boffen\b|vermutlich/i.test(text)) {
    warnings.push(
      "Lesestellen oder Punkte ausdrücklich unsicher/offen; am Original prüfen.",
    );
  }
  if (max !== 19) {
    warnings.push(
      "Nicht sämtliche Teilpunktzahlen automatisch prüfbar; Text-/offene Punkte manuell prüfen.",
    );
  }
  return {
    claimed,
    claimedMax,
    tablePoints,
    tableMaximum,
    taskPoints,
    computedTaskPoints: computed,
    computedTaskMaximum: max,
    warnings,
  };
}

const selected = work.papers.filter((p) => !p.ignored);
if (cache.guidance) {
  await Deno.writeTextFile(
    destination + "/Gemeinsamer-Loesungsmassstab.txt",
    cache.guidance.text,
    { mode: 0o600 },
  );
}
await parallelGrading(selected, async (paper, at) => {
  const pages = paper.pages.map((n) =>
    work.pages.find((page) => page.page === n)!
  );
  const id = await gradingHash({
    criteria,
    paper,
    pages: pages.map((page) => ({
      page: page.page,
      file: page.file ??
        work.sources.find((source) => source.index === page.page)?.name,
      student: page.student,
      studentEvidence: page.studentEvidence ?? "",
      transcript: page.transcript,
      tasks: page.tasks ?? [],
      figures: page.figures ?? [],
      continues: page.continues === true,
    })),
  });
  const report = cache.reports[id];
  if (!report || !cache.checked?.includes(id)) {
    throw new Error("Unreviewed or missing report for group " + (at + 1));
  }
  const name = paper.student.normalize("NFKD").replace(/\p{M}/gu, "").replace(
    /[^a-zA-Z0-9_-]+/g,
    "-",
  ).replace(/^-+|-+$/g, "").slice(0, 55) || "Name-unklar";
  const base = `${String(at + 1).padStart(2, "0")}-PDF-${
    paper.pages.map((n) => String(n).padStart(2, "0")).join("-")
  }-${name}`;
  const [word, pdf] = await Promise.all([
    buildGradingWord(report),
    buildGradingPdf(report, fonts),
  ]);
  const pdfPages = (await PDFDocument.load(pdf)).getPageCount();
  for (const [ext, data] of [["docx", word], ["pdf", pdf]] as const) {
    const filename = "Einzelrueckmeldungen/" + base + "." + ext;
    await Deno.writeFile(destination + "/" + filename, data, { mode: 0o600 });
    zip.push({ name: filename, data });
  }
  await Deno.writeTextFile(
    destination + "/Einzelrueckmeldungen/" + base + ".txt",
    report,
    { mode: 0o600 },
  );
  const quality = audit(report);
  if (
    /unsicher|unleserlich|im Zweifel|möglicherweise|keine sichere|nicht erkennbar|unbekannt/i
      .test(paper.student + " " + paper.note)
  ) {
    quality.warnings.push(
      "Zuordnung/Name prüfen: " + paper.student + ". " + (paper.note ?? ""),
    );
  }
  if (pdfPages > 1) {
    quality.warnings.push(
      `PDF umfasst ${pdfPages} Seiten statt einer A4-Seite.`,
    );
  }
  manifest[at] = {
    index: at + 1,
    student: paper.student,
    originalPages: paper.pages,
    selectionNote: paper.note ?? "",
    pdfPages,
    filename: base,
    independentModelCheck: true,
    ...quality,
  };
}, new AbortController().signal);
const excluded = work.papers.filter((p) => p.ignored).map((p) => ({
  label: p.student,
  pages: p.pages,
  reason: p.note,
}));
const overview = {
  note:
    "KI-Vorschläge, keine verbindliche Bewertung. Namen, Lesestellen und Punkte vor Verwendung prüfen.",
  inputCheckpoint: input,
  students: manifest,
  excluded,
};
await Deno.writeTextFile(
  destination + "/Pruefuebersicht.json",
  JSON.stringify(overview, null, 2),
  { mode: 0o600 },
);
const rows = [
  [
    "Nr",
    "Name laut KI-Zuordnung",
    "Original-PDF-Seiten",
    "Hinweis zur Seitenauswahl",
    "PDF-Seiten Feedback",
    "Punkte laut Bericht",
    "Teilaufgabensumme (nur Plausibilitätsprüfung)",
    "Prüfhinweise",
  ],
  ...manifest.map(
    (m) => [
      m.index,
      m.student,
      (m.originalPages as number[]).join(", "),
      m.selectionNote,
      m.pdfPages,
      m.claimed ?? "nicht automatisch lesbar",
      `${m.computedTaskPoints}/${m.computedTaskMaximum}`,
      (m.warnings as string[]).join(" | "),
    ],
  ),
];
await Deno.writeTextFile(
  destination + "/Pruefuebersicht.csv",
  "\uFEFF" + rows.map((row) => row.map(csv).join(";")).join("\n"),
  { mode: 0o600 },
);
await Deno.writeFile(
  destination + "/Alle-Einzelrueckmeldungen-Word-und-PDF.zip",
  await writeZip(zip),
  { mode: 0o600 },
);
await Deno.writeFile(
  destination + "/Korrekturvorschlaege-8d-gesamt.docx",
  await buildGradingWord(checkpoint.report),
  { mode: 0o600 },
);
await Deno.writeFile(
  destination + "/Korrekturvorschlaege-8d-gesamt.pdf",
  await buildGradingPdf(checkpoint.report, fonts),
  { mode: 0o600 },
);
console.log(JSON.stringify({
  students: manifest.length,
  excludedPages: excluded.reduce((n, g) => n + g.pages.length, 0),
  feedbackPages: manifest.map((m) => m.pdfPages),
  warnings: manifest.filter((m) => (m.warnings as string[]).length).length,
}));
