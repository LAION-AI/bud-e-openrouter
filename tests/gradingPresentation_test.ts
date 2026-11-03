import { assert, assertEquals, assertRejects } from "$std/assert/mod.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { docxToText } from "../utils/docx.ts";
import {
  buildGradingPdf,
  buildGradingWord,
  gradingExportBlocks,
  gradingExportSheets,
} from "../utils/gradingExports.ts";
import { blockText, cellText } from "../utils/gradingPresentation.ts";
import { type GradingSession, markRoomWork } from "../utils/gradingBatch.ts";
import {
  gradingClarificationQuestions,
  STUDENT_FEEDBACK_INSTRUCTIONS,
} from "../utils/gradingStudentFeedback.ts";
import { GradingFailure } from "../utils/gradingProtocol.ts";

const sample = `# Korrekturvorschläge für alle 2 Schülerarbeiten
> KI-Vorschläge, keine verbindlichen Bewertungen.

## Lea
*Zugeordnete Seiten in Lesereihenfolge: 1*
## Feedbackbogen – Lea
**Name:** Lea · **Klasse:** 8b · **Testdatum:** 15.10.26 · **Version:** C
### Aufgabe 1

Dein Ergebnis ist richtig. **1/1 Punkte**

**Insgesamt: 1/1 Punkte**

Eine Note wird nicht angegeben, da keine Notenskala vorliegt.

---

## Unbekannt 2
*Zugeordnete Seiten in Lesereihenfolge: 3*
## Korrekturvorschlag
Name: nicht eingetragen · Klasse: nicht eingetragen · Datum: nicht eingetragen
### Aufgabe 1
Deine Lesestelle bleibt offen. **offen / 1**
**Punktestand: 0 sichere Punkte; 1 Punkt offen.**`;

Deno.test("student sheets have one head each and keep uncertain marks, not teacher diagnostics", () => {
  const sheets = gradingExportSheets(gradingExportBlocks(sample));
  assertEquals(sheets.length, 2);
  assertEquals(sheets[0].name, "Lea");
  assertEquals(sheets[0].className, "8b");
  assertEquals(sheets[1].name, "");
  const text = sheets.flatMap((s) => s.blocks.map(blockText)).join("\n");
  assert(text.includes("1/1"));
  assert(text.includes("1 Punkt offen"));
  assert(!text.includes("Zugeordnete Seiten"));
  assert(!text.includes("Notenskala"));
  assert(!text.includes("Feedbackbogen"));
  assert(sheets[0].teacherNotes.some((note) => note.includes("Zugeordnete")));
});
Deno.test("Word/PDF preserve separate pupil pages and explicit transcript export preserves technical text", async () => {
  const fonts = await Promise.all(
    ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((n) =>
      Deno.readFile("static/fonts/" + n)
    ),
  ) as [Uint8Array, Uint8Array];
  const pdf = await PDFDocument.load(await buildGradingPdf(sample, fonts));
  assertEquals(pdf.getPageCount(), 2);
  const word = await docxToText(await buildGradingWord(sample));
  assert(word.includes("Deine Rückmeldung"));
  assert(word.includes("Lea"));
  assert(word.includes("1 Punkt offen"));
  assert(!word.includes("Zugeordnete Seiten"));
  const transcript = await docxToText(
    await buildGradingWord(sample, { audience: "transcript" }),
  );
  assert(transcript.includes("Zugeordnete Seiten"));
  assert(transcript.includes("KI-Vorschläge"));
});
Deno.test("formatting never silently converts an explicit zero on an uncertain old entry to an open mark", () => {
  const rows = Array.from(
    { length: 15 },
    (_, i) =>
      `|${i + 1}|${
        i === 1 ? "unleserlich" : "falsch"
      }|Gemeint ist Begriff – 0 P|`,
  ).join("\n");
  const [sheet] = gradingExportSheets(
    gradingExportBlocks(
      "Name: Test\n\n### Aufgabe 1: Lückentext\n\n|Lücke|Dein Eintrag|Bewertung|\n|---|---|---|\n" +
        rows + "\n\nAufgabe 1: 0/15 Punkte",
    ),
  );
  const table = sheet.blocks.find((b) => b.kind === "table");
  assert(table?.kind === "table");
  assertEquals(cellText(table.rows[2][3]), "0/1");
});
const session = (): GradingSession => ({
  sources: [{ index: 1, name: "Test.txt", kind: "text", content: "Aufgabe 1" }],
  prepared: true,
  pages: [{ page: 1, student: "Test", transcript: "Antwort" }],
  papers: [{ student: "Test", pages: [1] }],
});
Deno.test("missing point policy is asked before any model call; semantic model questions stop without retry", async () => {
  let calls = 0;
  await assertRejects(() =>
    markRoomWork(
      session(),
      "Bitte korrigieren",
      () => {
        calls++;
        return Promise.resolve("unused");
      },
      () => {},
      new AbortController().signal,
    )
  );
  assertEquals(calls, 0);
  const error = await assertRejects(() =>
    markRoomWork(
      session(),
      "Aufgabe 1: 2 Punkte",
      () => {
        calls++;
        return Promise.resolve(
          '{"type":"grading_clarification","questions":["Wann gibt es einen Teilpunkt?"]}',
        );
      },
      () => {},
      new AbortController().signal,
    )
  );
  assert(error instanceof GradingFailure);
  assertEquals(error.code, "criteria_clarification");
  assertEquals(calls, 1);
});
Deno.test("clarification object wrappers are accepted but ordinary feedback is not a teacher question", () => {
  const question =
    '{"type":"grading_clarification","questions":["Welche Höchstpunkte?"]}';
  for (
    const text of [
      question,
      "```json\n" + question + "\n```",
      "Rückfrage:\n" + question,
      question + "\n<!-- BUDE_BEWERTUNG_FERTIG -->",
    ]
  ) assertEquals(gradingClarificationQuestions(text), ["Welche Höchstpunkte?"]);
  assertEquals(
    gradingClarificationQuestions("Deine Antwort ist richtig. 1/1."),
    null,
  );
  assert(STUDENT_FEEDBACK_INSTRUCTIONS.includes("Du-Form"));
  assert(STUDENT_FEEDBACK_INSTRUCTIONS.includes("Unterschrift"));
});
