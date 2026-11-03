import { assert, assertEquals, assertRejects } from "$std/assert/mod.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { buildDocx, docxToText, writeZip } from "../utils/docx.ts";
import {
  type GradingAsk,
  isRoomGradingRequest,
  markRoomWork,
  parallelGrading,
  transcribeRoomWork,
  validateGradingGroups,
} from "../utils/roomGrading.ts";
import {
  filesForGrading,
  gradingBase64,
  gradingUnbase64,
  readGradingZip,
  wordGradingSources,
} from "../utils/gradingUploads.ts";
import {
  buildGradingPdf,
  buildGradingWord,
  gradingExportBlocks,
} from "../utils/gradingExports.ts";
import type { SourceDoc } from "../utils/grading.ts";
import {
  parseGradingCheckpoint,
  serializeGradingCheckpoint,
} from "../utils/gradingCheckpoint.ts";
import {
  GRADING_PARALLEL,
  GradingTruncated,
} from "../utils/gradingProtocol.ts";
import { gradingReportIssues } from "../utils/gradingRecovery.ts";

const signal = () => new AbortController().signal;
Deno.test("grading exports normalize inline LaTeX math without removing ordinary dollar prices", () => {
  const blocks = gradingExportBlocks(
    String.raw`Rechnung: \(1.024 \times 5 = 5.120\). Preis $5.`,
  );
  const text = blocks.flatMap((block) =>
    "runs" in block ? block.runs.map((run) => run.text) : []
  ).join("");
  assert(text.includes("1.024 × 5 = 5.120"));
  assert(!text.includes("\\times"));
  assert(text.includes("$5"));
});
async function fixture(count = 6): Promise<SourceDoc> {
  const pdf = await PDFDocument.create();
  for (let n = 0; n < count; n++) pdf.addPage([500 + n, 700]);
  return {
    index: 1,
    name: "Alle-Schueler.pdf",
    kind: "pdf",
    content: "data:application/pdf;base64," + gradingBase64(await pdf.save()),
  };
}
const papers = [{ student: "Spencer", pages: [2, 5] }, {
  student: "Lea",
  pages: [4, 1],
}, { student: "Noah", pages: [6, 3] }];
Deno.test("upside-down source is rotated before a fresh transcription; processed originals survive checkpoint export", async () => {
  let calls = 0;
  const work = await transcribeRoomWork(
    [await fixture(1)],
    async (prompt, sources) => {
      if (prompt.startsWith("GRUPPIERUNG")) {
        return JSON.stringify({
          papers: [{ student: "A", pages: [1] }],
        });
      }
      calls++;
      const pdf = await PDFDocument.load(
        gradingUnbase64(sources[0].content.split(",")[1]),
      );
      assertEquals(
        pdf.getPages()[0].getRotation().angle,
        calls === 1 ? 0 : 180,
      );
      return JSON.stringify({
        pages: [{
          student: "A",
          transcript: calls === 1
            ? "Do not keep this uncertain upside-down reading"
            : "Readable upright",
          rotation: calls === 1 ? 180 : 0,
        }],
      });
    },
    () => {},
    signal(),
  );
  assertEquals(calls, 2);
  assertEquals(work.pages[0].transcript, "Readable upright");
  assertEquals(
    (await PDFDocument.load(
      gradingUnbase64(work.sources[0].content.split(",")[1]),
    )).getPages()[0].getRotation().angle,
    180,
  );
  work.pendingPages = [1];
  await assertRejects(() =>
    markRoomWork(
      work,
      "Rubric; ohne Punkte",
      () => Promise.resolve("must not run"),
      () => {},
      signal(),
    )
  );
  let reread = 0;
  const next = await transcribeRoomWork(
    [],
    () => {
      reread++;
      return Promise.resolve(
        JSON.stringify({
          pages: [{ student: "A", transcript: "Fresh reading", rotation: 0 }],
        }),
      );
    },
    () => {},
    signal(),
    work,
  );
  assertEquals(reread, 1);
  assertEquals(next.pages.length, 1);
  assertEquals(next.pages[0].transcript, "Fresh reading");
  assertEquals(next.pendingPages, []);
});
Deno.test("split review is consolidated and validated instead of exporting contradictory table fragments", async () => {
  let reviews = 0, finals = 0;
  const work = {
    sources: [{
      index: 1,
      name: "A.txt",
      kind: "text" as const,
      content: "work",
    }],
    prepared: true,
    pages: [{ page: 1, student: "A", transcript: "work" }],
    papers: [{ student: "A", pages: [1] }],
  };
  const result = await markRoomWork(
    work,
    "Teacher rubric; Aufgabe 1: 1 Punkt",
    (prompt, _sources, _signal, options) => {
      if (prompt.startsWith("ENDPRUEFUNG")) {
        finals++;
        assertEquals(options?.maxOutput, 8192);
        return Promise.resolve(
          "## Aufgabe 1\n\n| Antwort | Punkte |\n|---|---|\n| Passt | 1/1 |\n\n<!-- BUDE_BEWERTUNG_FERTIG -->",
        );
      }
      if (prompt.startsWith("QUALITAETSPRUEFUNG")) {
        reviews++;
        if (reviews === 1) {
          throw new GradingTruncated(
            "## Aufgabe 1\n\n| Antwort | Punkte |\n|---|---|\n| Passt |",
          );
        }
        return Promise.resolve(
          "## Aufgabe 1\n\nKorrigierter Abschnitt.\n<!-- BUDE_BEWERTUNG_FERTIG -->",
        );
      }
      return Promise.resolve("Draft\n<!-- BUDE_BEWERTUNG_FERTIG -->");
    },
    () => {},
    signal(),
  );
  assertEquals(finals, 1);
  assertEquals(reviews, 2);
  assertEquals(gradingReportIssues(result), []);
  assert(!result.includes("Korrigierter Abschnitt"));
  assert(
    gradingReportIssues("## Aufgabe 1\nText\n## Aufgabe 1\nText").length > 0,
  );
});
Deno.test("selection review uses both original pages for a near-blank similar-name backside; each page stays accounted for", async () => {
  let ocr = 0, groups = 0, audits = 0;
  const ask: GradingAsk = async (prompt, sources) => {
    if (prompt.startsWith("PRÜFUNG EINER MÖGLICHEN")) {
      audits++;
      assertEquals(sources.length, 1);
      const pdf = await PDFDocument.load(
        gradingUnbase64(sources[0].content.split(",")[1]),
      );
      assertEquals(pdf.getPageCount(), 2);
      return JSON.stringify({
        papers: [{
          student: "Mia",
          pages: [1],
          note: "Hauptarbeit",
          ignored: false,
        }, {
          student: "Mila",
          pages: [2],
          note:
            "Original zeigt alternative, nur minimal begonnene Rückseite derselben Person",
          ignored: true,
        }],
      });
    }
    if (prompt.startsWith("GRUPPIERUNG")) {
      groups++;
      return JSON.stringify({
        papers: [{
          student: "Mia",
          pages: [1],
          note: "Hauptarbeit",
          ignored: false,
        }, {
          student: "Mila",
          pages: [2],
          note: "Name und fast leer",
          ignored: false,
        }],
      });
    }
    ocr++;
    const n = sources[0].index;
    return JSON.stringify({
      pages: [{
        student: n === 1 ? "Mia" : "Mila",
        studentEvidence: n === 1
          ? "Aufgaben ausgefüllt"
          : "Nur ein Eintrag, weitgehend leer",
        transcript: `VERSION ${n === 1 ? "D" : "C"}\nAntwort ${n}`,
        tasks: [],
        figures: [],
      }],
    });
  };
  const work = await transcribeRoomWork(
    [await fixture(2)],
    ask,
    () => {},
    signal(),
    undefined,
    () => {},
    "Minimale alternative Tests auf der Rückseite ignorieren.",
  );
  assertEquals(ocr, 2);
  assertEquals(groups, 1);
  assertEquals(audits, 1);
  assertEquals(work.papers.filter((p) => !p.ignored).length, 1);
  const restored = parseGradingCheckpoint(serializeGradingCheckpoint({
    format: "bude-grading",
    version: 1,
    createdAt: new Date().toISOString(),
    work,
    criteria: "Minimale alternative Tests auf der Rückseite ignorieren.",
    feedback: "",
    automatic: false,
    groups: [],
    status: null,
    steps: [],
    report: "",
    lastAction: "transcribe",
  }));
  await transcribeRoomWork(
    [],
    ask,
    () => {},
    signal(),
    restored.work,
    () => {},
    restored.criteria,
  );
  assertEquals(audits, 1);
  assertEquals(restored.work.selectionChecks?.length, 1);
});
Deno.test("batch: one multi-student PDF becomes six independent parallel transcripts, one grouping call and three parallel whole-paper assessments", async () => {
  let ocr = 0,
    group = 0,
    marks = 0,
    activeOcr = 0,
    maxOcr = 0,
    activeMark = 0,
    maxMark = 0;
  const events: string[] = [];
  const ask: GradingAsk = async (prompt, sources) => {
    if (prompt.startsWith("QUALITAETSPRUEFUNG")) {
      return "Unabhängig geprüft: 7 + 5 = 12. Keine Note.\n<!-- BUDE_BEWERTUNG_FERTIG -->";
    }
    if (prompt.startsWith("GRUPPIERUNG ALLER SEITEN")) {
      group++;
      assertEquals(ocr, 6);
      return JSON.stringify({ papers });
    }
    if (prompt.startsWith("BEWERTUNG EINER SCHÜLERARBEIT")) {
      marks++;
      activeMark++;
      maxMark = Math.max(maxMark, activeMark);
      const name = prompt.split("\n")[0].split(": ")[1],
        paper = papers.find((p) => p.student === name)!;
      assert(prompt.includes("GEMEINSAMER MASSSTAB"));
      assertEquals(sources.length, 1);
      const pdf = await PDFDocument.load(
        gradingUnbase64(sources[0].content.split(",")[1]),
      );
      assertEquals(
        pdf.getPages().map((p) => p.getWidth()),
        paper.pages.map((n) => 499 + n),
      );
      await new Promise((resolve) =>
        setTimeout(resolve, name === "Spencer" ? 30 : 5)
      );
      activeMark--;
      return `Rückmeldung für ${name}: Alle Aufgaben geprüft. 7 + 5 = 12. Keine Note.\n<!-- BUDE_BEWERTUNG_FERTIG -->`;
    }
    activeOcr++;
    maxOcr = Math.max(maxOcr, activeOcr);
    assertEquals(sources.length, 1);
    const source = sources[0],
      page = await PDFDocument.load(
        gradingUnbase64(source.content.split(",")[1]),
      );
    assertEquals(page.getPageCount(), 1);
    await new Promise((resolve) =>
      setTimeout(resolve, source.index % 2 ? 20 : 3)
    );
    ocr++;
    activeOcr--;
    return JSON.stringify({
      pages: [{
        file: source.index % 2
          ? source.name.normalize("NFKC") + ".pdf"
          : source.name,
        page: source.index,
        student: papers.find((p) => p.pages.includes(source.index))!.student,
        transcript: `Aufgabe ${source.index}: 7 + 5 = 13`,
        tasks: [String(source.index)],
        figures: [],
      }],
    });
  };
  const session = await transcribeRoomWork(
    [await fixture()],
    ask,
    (text) => events.push(text),
    signal(),
  );
  assertEquals(session.pages.length, 6);
  assertEquals(session.papers, papers.map((p) => ({ ...p, note: "" })));
  assertEquals(group, 1);
  assertEquals(marks, 0);
  assertEquals(maxOcr, Math.min(GRADING_PARALLEL, 6));
  assert(session.pages.every((page) => page.transcript.includes("13")));
  await assertRejects(() => markRoomWork(session, "", ask, () => {}, signal()));
  assertEquals(marks, 0);
  const report = await markRoomWork(
    session,
    "GEMEINSAMER MASSSTAB: ohne Punkte, keine Note",
    ask,
    (text) => events.push(text),
    signal(),
  );
  assertEquals(marks, 3);
  assert(maxMark >= 2 && maxMark <= GRADING_PARALLEL);
  assert(report.includes("alle 3 Schülerarbeiten"));
  assert(report.indexOf("## Spencer") < report.indexOf("## Lea"));
  assert(report.indexOf("## Lea") < report.indexOf("## Noah"));
  await markRoomWork(
    session,
    "GEMEINSAMER MASSSTAB: ohne Punkte, keine Note",
    ask,
    () => {},
    signal(),
  );
  assertEquals(
    marks,
    3,
    "Completed pupil results must not be billed again on unchanged retry",
  );
  const word = await buildGradingWord(report),
    wordText = await docxToText(word);
  for (const p of papers) assert(wordText.includes(p.student));
  const fonts = await Promise.all(
    ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) =>
      Deno.readFile("static/fonts/" + name)
    ),
  ) as [Uint8Array, Uint8Array];
  const bytes = await buildGradingPdf(report, fonts),
    pdf = await PDFDocument.load(bytes);
  assert(pdf.getPageCount() >= 3);
  const temp = await Deno.makeTempFile({ suffix: ".pdf" });
  try {
    await Deno.writeFile(temp, bytes);
    const result = await new Deno.Command("pdftotext", {
      args: [temp, "-"],
      stdout: "piped",
    }).output();
    assert(result.success);
    const text = new TextDecoder().decode(result.stdout);
    for (const p of papers) assert(text.includes(p.student));
  } finally {
    await Deno.remove(temp);
  }
});
Deno.test("batch: reject missing/duplicate page groups and duplicate pupil identities", async () => {
  const pages = [1, 2].map((page) => ({
    page,
    student: "",
    transcript: "Antwort",
  }));
  for (
    const groups of [[{ student: "A", pages: [1] }], [{
      student: "A",
      pages: [1, 1],
    }], [{ student: "A", pages: [1] }, { student: "A", pages: [2] }]]
  ) {
    let failed = false;
    try {
      validateGradingGroups(groups, pages);
    } catch {
      failed = true;
    }
    assert(failed);
  }
  await assertRejects(() =>
    transcribeRoomWork(
      [{ index: 1, name: "a.txt", kind: "text", content: "Hallo" }],
      () => Promise.resolve('{"pages":[]}'),
      () => {},
      signal(),
    )
  );
});
Deno.test("grading PDF keeps a 15-gap feedback as compact table on one A4 page", async () => {
  const text = "## Testperson\n\nKlasse: 8d · Datum: 12.10.26 · Version D\n\n" +
    "| Lücke | Dein Eintrag | Richtig / Hinweis | Punkte |\n|---|---|---|---|\n" +
    Array.from(
      { length: 15 },
      (_, at) =>
        `| ${at + 1} | Schleife | Richtig: wiederholt Anweisungen. | 1/1 |`,
    ).join("\n") +
    "\n\nAufgabe 2: 4 × 1024 = 4096 KB. Rechenweg und Ergebnis richtig: 2/2.\n\nAufgabe 3: Dein Beispiel erklärt Wiederholungen: 2/2.\n\nGesamt: 19/19. Wiederhole die Einheiten und teste eine Schleife. Keine verbindliche Bewertung.";
  const fonts = await Promise.all(
    ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) =>
      Deno.readFile("static/fonts/" + name)
    ),
  ) as [Uint8Array, Uint8Array];
  const pdf = await PDFDocument.load(await buildGradingPdf(text, fonts));
  assertEquals(pdf.getPageCount(), 1);
  assert((await docxToText(await buildGradingWord(text))).includes("19/19"));
});
Deno.test("batch: bounded workers preserve order, stop on abort and never launch later jobs after failure", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assertRejects(() =>
    parallelGrading([1, 2, 3, 4, 5, 6], async (n, _at, s) => {
      calls++;
      if (n === 1) {
        controller.abort();
        throw new Error("stop");
      }
      s.throwIfAborted();
      await Promise.resolve();
      return n;
    }, controller.signal)
  );
  assert(calls <= GRADING_PARALLEL);
  const result = await parallelGrading([1, 2, 3, 4], async (n) => {
    await new Promise((resolve) => setTimeout(resolve, 5 - n));
    return n;
  }, signal());
  assertEquals(result, [1, 2, 3, 4]);
  assert(isRoomGradingRequest("Bitte korrigiere diese Arbeit"));
  assert(!isRoomGradingRequest("Korrigiere meinen Python-Code"));
});
Deno.test("uploads: Word page breaks and repeated name sections keep all pupils; ZIP folders locate PDFs, Word and photos", async () => {
  const docx = await buildDocx([
    { kind: "p", text: "Name: Spencer\nAufgabe 1: falsch" },
    { kind: "pagebreak" },
    { kind: "p", text: "Name: Lea\nAufgabe 2: richtig" },
  ]);
  const word = await wordGradingSources("Klasse.docx", docx);
  assert(word.some((p) => p.content.includes("Spencer")));
  assert(word.some((p) => p.content.includes("Lea")));
  assert(word.length >= 2);
  const pdf = await fixture(2),
    zip = await writeZip([
      {
        name: "unterordner/klasse.pdf",
        data: gradingUnbase64(pdf.content.split(",")[1]),
      },
      { name: "unterordner/klasse.docx", data: docx },
      { name: "fotos/test.jpg", data: new Uint8Array([255, 216, 255, 217]) },
      { name: "ignorieren.exe", data: new Uint8Array([0]) },
    ]);
  const sources = await filesForGrading([new File([zip], "stapel.zip")]);
  assert(sources.some((p) => p.kind === "pdf"));
  assert(sources.filter((p) => p.kind === "text").length >= 2);
  assert(sources.some((p) => p.kind === "image"));
  const bad = await writeZip([{
    name: "../fremd.pdf",
    data: new Uint8Array([1]),
  }]);
  await assertRejects(() => readGradingZip(bad));
  const fake = await writeZip([{
    name: "bombe.pdf",
    data: new Uint8Array([1]),
  }]);
  const view = new DataView(fake.buffer);
  for (let at = 0; at < fake.length - 46; at++) {
    if (view.getUint32(at, true) === 0x02014b50) {
      view.setUint32(at + 24, 100_000_000, true);
      break;
    }
  }
  await assertRejects(() => readGradingZip(fake));
});
