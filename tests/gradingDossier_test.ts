import { assert, assertEquals, assertRejects } from "$std/assert/mod.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import {
  gradingDossierSheets,
  gradingDossierWorks,
} from "../utils/gradingDossier.ts";
import { gradingPaperKey, type GradingSession } from "../utils/gradingBatch.ts";
import { gradingHash } from "../utils/gradingRecovery.ts";
import { buildStudentGradingPdf } from "../utils/gradingPdf.ts";
import { buildStudentGradingWord } from "../utils/gradingDocx.ts";
import { docxToText, readZip } from "../utils/docx.ts";
const criteria = "Aufgabe 1: 2 Punkte, keine Note.";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==";
async function fixture(): Promise<GradingSession> {
  const s: GradingSession = {
    prepared: true,
    sources: [1, 2, 3].map((n) => ({
      index: n,
      name: `scan-${n}.png`,
      kind: "image",
      content: png,
    })),
    pages: [1, 2, 3].map((n) => ({
      page: n,
      student: n === 2 ? "Vorlage" : "Lea",
      transcript: `Original ${n}: ~~falsch~~ richtig; [unleserlich]`,
    })),
    papers: [{ student: "Lea", pages: [3, 1] }, {
      student: "Vorlage",
      pages: [2],
      ignored: true,
      note: "Unbeschriebene alternative Testversion",
    }],
    cache: { criteria: await gradingHash(criteria), reports: {}, checked: [] },
  };
  const id = await gradingPaperKey(s, criteria, s.papers[0]);
  s.cache!.reports[id] =
    "Name: Lea · Klasse: 9b · Version A\n\n### Aufgabe 1\nDu hast gut erklärt. Punkte: 2/2\n\nInsgesamt: 2/2 Punkte";
  s.cache!.checked!.push(id);
  return s;
}
Deno.test("proof dossier follows group reading order, preserves each source and excludes no ignored original", async () => {
  const s = await fixture(), works = await gradingDossierWorks(s, criteria);
  assertEquals(works[0].pages.map((p) => p.source.index), [3, 1]);
  assertEquals(works[1].report, undefined);
  const sheets = await gradingDossierSheets(
    s,
    criteria,
    () => {},
    () => Promise.resolve({ src: png, width: 100, height: 140 }),
  );
  assertEquals(sheets.map((s) => s.title), [
    "Arbeit 01 · Original 3",
    "Arbeit 01 · Abschrift 3",
    "Arbeit 01 · Original 1",
    "Arbeit 01 · Abschrift 1",
    "Arbeit 01 · Deine Rückmeldung",
    "Arbeit 02 · Original 2",
    "Arbeit 02 · Abschrift 2",
    "Arbeit 02 · Nicht bewertet",
  ]);
  const word = await buildStudentGradingWord(sheets),
    text = await docxToText(word);
  assert(text.includes("~~falsch~~"));
  assert(text.includes("Unbeschriebene alternative"));
  assert(text.includes("Original-IDs: 3, 1"));
  const entries = await readZip(word);
  assertEquals(
    entries.filter((e) => e.name.startsWith("word/media/")).length,
    3,
  );
  const xml = new TextDecoder().decode(
    entries.find((e) => e.name === "word/document.xml")!.data,
  );
  assertEquals((xml.match(/w:type="page"/g) || []).length, 7);
  const fonts = await Promise.all(
    ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((n) =>
      Deno.readFile("static/fonts/" + n)
    ),
  ) as [Uint8Array, Uint8Array];
  const pdf = await PDFDocument.load(
    await buildStudentGradingPdf(sheets, fonts),
  );
  assertEquals(pdf.getPageCount(), 8);
});
Deno.test("stale rubric, edited transcription, missing report and unchecked feedback cannot be silently mismatched", async () => {
  const s = await fixture();
  await assertRejects(
    () => gradingDossierWorks(s, criteria + " changed"),
    Error,
    "Maßstab",
  );
  s.pages[0].transcript += " corrected";
  await assertRejects(
    () => gradingDossierWorks(s, criteria),
    Error,
    "passende",
  );
  const fresh = await fixture();
  fresh.cache!.checked = [];
  await assertRejects(
    () => gradingDossierWorks(fresh, criteria),
    Error,
    "passende",
  );
  const incomplete = await fixture();
  incomplete.sources.pop();
  await assertRejects(
    () => gradingDossierWorks(incomplete, criteria),
    Error,
    "fehlen",
  );
});
Deno.test("dossier key stays compatible with preexisting checkpoints", async () => {
  const s = await fixture(), paper = s.papers[0];
  const legacy = await gradingHash({
    criteria,
    paper,
    pages: paper.pages.map((n) => {
      const p = s.pages.find((p) => p.page === n)!;
      return {
        page: p.page,
        file: s.sources.find((s) => s.index === n)!.name,
        student: p.student,
        studentEvidence: "",
        transcript: p.transcript,
        tasks: [],
        figures: [],
        continues: false,
      };
    }),
  });
  assertEquals(await gradingPaperKey(s, criteria, paper), legacy);
});
