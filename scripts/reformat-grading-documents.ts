/** Restyle an existing DOCX assessment without sending pupil data to an API
 * and without changing awarded points. Originals are backed up before replace. */
import { basename, dirname, join } from "$std/path/mod.ts";
import { docxToHtml, htmlToBlocks } from "../utils/docxRich.ts";
import {
  buildGradingPdfFromBlocks,
  buildGradingWordFromBlocks,
  gradingExportSheets,
} from "../utils/gradingExports.ts";
import { blockText, cellText } from "../utils/gradingPresentation.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const [input, mode, targetFolder] = Deno.args;
if (!input?.endsWith(".docx")) {
  throw new Error(
    "Input DOCX required; optional --replace after visual review.",
  );
}
const folder = targetFolder || dirname(input), base = basename(input, ".docx");
const targetDocx = join(folder, base + ".docx");
const source = await Deno.readFile(input);
const blocks = htmlToBlocks(await docxToHtml(source));
const sheets = gradingExportSheets(blocks);
if (!sheets.length) throw new Error("No feedback sheets found");
const fonts = await Promise.all(
  ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) =>
    Deno.readFile(new URL("../static/fonts/" + name, import.meta.url))
  ),
) as [Uint8Array, Uint8Array];
const [word, pdf] = await Promise.all([
  buildGradingWordFromBlocks(blocks),
  buildGradingPdfFromBlocks(blocks, fonts),
]);
const pageCount = (await PDFDocument.load(pdf)).getPageCount();
const output = join(folder, "Schuelerfassung-2026-11-03");
await Deno.mkdir(output, { recursive: true, mode: 0o700 });
await Deno.writeFile(join(output, base + ".pdf"), pdf, { mode: 0o600 });
await Deno.writeFile(join(output, base + ".docx"), word, { mode: 0o600 });
const overview = sheets.map((sheet, index) => ({
  sheet: index + 1,
  name: sheet.name || "Name nicht eingetragen/unsicher",
  className: sheet.className,
  date: sheet.date,
  version: sheet.version,
  teacherNotes: sheet.teacherNotes,
  pointLines: sheet.blocks.flatMap((block) =>
    block.kind === "table"
      ? block.rows.map((row) => row.map(cellText).join(" | "))
      : [blockText(block)]
  ).filter((text) => /Punkt|\d\s*\/\s*\d|offen/i.test(text)),
}));
await Deno.writeTextFile(
  join(output, "Lehrkraft-Pruefhinweise.json"),
  JSON.stringify(
    {
      source: input,
      formatOnly: true,
      sheets: sheets.length,
      pdfPages: pageCount,
      overview,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
await Deno.writeTextFile(
  join(output, "Lehrkraft-Pruefhinweise.txt"),
  `Formatüberarbeitung vom 03.11.2026\n\n${sheets.length} Rückmeldungen aus dem vom Nutzer genannten DOCX, keine Neubewertung und keine API-Kosten. Vorhandene Punkte, offene Stellen und Aussagen wurden nicht neu bewertet. Administrative Klassenüberschriften und interne Zuordnungen wurden aus den Schülerblättern ausgelagert; Details in der JSON-Übersicht.\n\nVor Verwendung weiterhin Namen/Datum und offene Lesestellen am Original prüfen. Die älteren Ausgangsdokumente enthalten mögliche Unterschiede bei der Beurteilung von Aufgabe 3 (insbesondere Blätter 5, 18, 27, 28). Das ist hier bewusst NICHT durch neue Punktzahlen ersetzt worden. Einzelne offen gebliebene Punkte bleiben offen.\n\nPDF: ${pageCount} Seiten. Word-Seitenumbrüche sind je Person gesetzt; der tatsächliche Umbruch kann vom Word-Programm abhängen.\n`,
  { mode: 0o600 },
);
if (mode === "--replace") {
  if (pageCount !== sheets.length) {
    throw new Error(
      "Not exactly one PDF page per student; originals NOT replaced. Inspect preview.",
    );
  }
  const backup = join(
    folder,
    "Backup-vor-Neugestaltung-" +
      new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await Deno.mkdir(backup, { mode: 0o700 });
  await Deno.copyFile(targetDocx, join(backup, base + ".docx"));
  try {
    await Deno.copyFile(
      join(folder, base + ".pdf"),
      join(backup, base + ".pdf"),
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.writeFile(targetDocx, word);
  await Deno.writeFile(join(folder, base + ".pdf"), pdf);
  console.log(
    JSON.stringify({
      backup,
      output,
      sheets: sheets.length,
      pdfPages: pageCount,
      replaced: true,
    }),
  );
} else {console.log(
    JSON.stringify({
      output,
      sheets: sheets.length,
      pdfPages: pageCount,
      replaced: false,
    }),
  );}
