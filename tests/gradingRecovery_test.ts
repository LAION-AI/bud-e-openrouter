import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "$std/assert/mod.ts";
import {
  gradingJson,
  recoverGrading,
  withGradingTimeout,
} from "../utils/gradingRecovery.ts";
import { GradingFailure, GradingTruncated } from "../utils/gradingProtocol.ts";
import {
  type GradingAsk,
  type GradingSession,
  markRoomWork,
  transcribeRoomWork,
} from "../utils/gradingBatch.ts";
import {
  type GradingCheckpoint,
  parseGradingCheckpoint,
  serializeGradingCheckpoint,
} from "../utils/gradingCheckpoint.ts";

const signal = () => new AbortController().signal;
const end = "\n<!-- BUDE_BEWERTUNG_FERTIG -->";
Deno.test("shared rubric draft survives a credit pause and resumes its independent check without buying the draft again", async () => {
  let work: GradingSession = {
    sources: files(4),
    prepared: true,
    pages: Array.from(
      { length: 4 },
      (_, i) => ({
        page: i + 1,
        student: String(i + 1),
        transcript: "Version A\nAntwort",
      }),
    ),
    papers: Array.from(
      { length: 4 },
      (_, i) => ({ student: String(i + 1), pages: [i + 1] }),
    ),
  };
  let draftCalls = 0, checkCalls = 0, fail = true;
  const ask: GradingAsk = (prompt) => {
    if (prompt.startsWith("GEMEINSAMER")) {
      if (prompt.includes("UNABHÄNGIGE PRÜFUNG")) {
        checkCalls++;
        if (fail) throw new GradingFailure("Guthaben fehlt", false);
      } else draftCalls++;
      return Promise.resolve("Maßstab\n<!-- BUDE_MASSSTAB_FERTIG -->");
    }
    return Promise.resolve("Feedback" + end);
  };
  await assertRejects(() =>
    markRoomWork(work, "Rubric; ohne Punkte", ask, () => {}, signal())
  );
  assertEquals(draftCalls, 1);
  work = parseGradingCheckpoint(
    serializeGradingCheckpoint({ ...snap(work), criteria: "Rubric; ohne Punkte" }),
  ).work;
  assertEquals(Object.keys(work.cache!.guidanceDrafts!).length, 1);
  fail = false;
  await markRoomWork(work, "Rubric; ohne Punkte", ask, () => {}, signal());
  assertEquals(draftCalls, 1);
  assertEquals(checkCalls, 2);
  assertEquals(Object.keys(work.cache!.guidanceDrafts!).length, 0);
});
Deno.test("variant rubric is prepared once, reviewed separately and resumed from checkpoint without repeating keys or pupils", async () => {
  let work: GradingSession = {
    sources: files(4),
    prepared: true,
    pages: Array.from(
      { length: 4 },
      (_, i) => ({
        page: i + 1,
        student: String(i + 1),
        transcript: "Version " + (i % 2 ? "B" : "A") + "\nAnswer",
      }),
    ),
    papers: Array.from(
      { length: 4 },
      (_, i) => ({ student: String(i + 1), pages: [i + 1] }),
    ),
  };
  let keys = 0, drafts = 0, reviews = 0;
  const ask: GradingAsk = (prompt) => {
    if (prompt.startsWith("GEMEINSAMER")) {
      keys++;
      return Promise.resolve(
        "Correct common solution\n<!-- BUDE_MASSSTAB_FERTIG -->",
      );
    }
    assert(prompt.includes("Correct common solution"));
    if (prompt.startsWith("QUALITAETSPRUEFUNG")) reviews++;
    else drafts++;
    return Promise.resolve("Feedback" + end);
  };
  await markRoomWork(work, "Rubric; ohne Punkte", ask, () => {}, signal());
  assertEquals([keys, drafts, reviews], [4, 4, 4]);
  const checkpoint = { ...snap(work), criteria: "Rubric; ohne Punkte" };
  work = parseGradingCheckpoint(serializeGradingCheckpoint(checkpoint)).work;
  await markRoomWork(work, "Rubric; ohne Punkte", ask, () => {}, signal());
  assertEquals([keys, drafts, reviews], [4, 4, 4]);
  assertEquals(Object.keys(work.cache!.guidanceParts!).length, 2);
});
Deno.test("independent check survives errors and resumes without purchasing the draft again", async () => {
  let work: GradingSession = {
    sources: files(1),
    prepared: true,
    pages: [{
      page: 1,
      file: "Seite-1.txt",
      student: "A",
      transcript: "Antwort",
    }],
    papers: [{ student: "A", pages: [1] }],
  };
  let drafts = 0, reviews = 0, fail = true;
  const ask: GradingAsk = (prompt) => {
    if (prompt.startsWith("QUALITAETSPRUEFUNG")) {
      reviews++;
      if (fail) throw new GradingFailure("Kurzzeitig nicht erreichbar");
      return Promise.resolve("Korrigierte Fassung." + end);
    }
    drafts++;
    return Promise.resolve("Ungeprüfter Entwurf." + end);
  };
  await assertRejects(() =>
    markRoomWork(work, snap(work).criteria, ask, () => {}, signal())
  );
  assertEquals(drafts, 1);
  assertEquals(work.cache?.checked?.length, 0);
  work = parseGradingCheckpoint(serializeGradingCheckpoint(snap(work))).work;
  fail = false;
  const result = await markRoomWork(
    work,
    snap(work).criteria,
    ask,
    () => {},
    signal(),
  );
  assertEquals(drafts, 1);
  assertEquals(reviews, 4);
  assertEquals(work.cache?.checked?.length, 1);
  assert(result.includes("Korrigierte Fassung"));
});
Deno.test("duplicate-backside instruction detects mixed test versions and feeds the exact error back to the grouping call", async () => {
  let groups = 0;
  const ask: GradingAsk = (prompt) => {
    if (prompt.startsWith("GRUPPIERUNG")) {
      groups++;
      if (groups === 1) {
        return Promise.resolve(
          JSON.stringify({
            papers: [{ student: "A", pages: [1, 2], note: "", ignored: false }],
          }),
        );
      }
      assert(prompt.includes("vermischt Testversionen"));
      return Promise.resolve(JSON.stringify({
        papers: [{ student: "A", pages: [1], note: "", ignored: false }, {
          student: "Alternative Rückseite",
          pages: [2],
          note: "Nur versehentlich begonnen; gemäß Auftrag ignoriert",
          ignored: true,
        }],
      }));
    }
    const page = pageNo(prompt);
    return Promise.resolve(
      JSON.stringify({
        pages: [{
          student: "A",
          transcript: `VERSION ${page === 1 ? "A" : "B"}\nAntwort`,
          tasks: [],
          figures: [],
        }],
      }),
    );
  };
  const result = await transcribeRoomWork(
    files(2),
    ask,
    () => {},
    signal(),
    undefined,
    () => {},
    "Rückseite mit alternativem Zweittest ignorieren",
  );
  assertEquals(groups, 2);
  assertEquals(result.papers.filter((p) => !p.ignored).length, 1);
});
Deno.test("unused backsides are accounted for but never assessed; named empty main work remains selected", async () => {
  const ask: GradingAsk = (prompt) => {
    if (prompt.startsWith("GRUPPIERUNG")) {
      assert(prompt.includes("LEHRKRAFTAUFTRAG ZUR SEITENAUSWAHL"));
      return Promise.resolve(JSON.stringify({
        papers: [
          { student: "Hauptarbeit", pages: [1], note: "", ignored: false },
          {
            student: "Benannte leere Hauptarbeit",
            pages: [3],
            note: "Name vorhanden, tatsächlich abgegeben",
            ignored: false,
          },
          {
            student: "Leere Rückseiten",
            pages: [2, 4],
            note: "Leere Druckvorlagen ohne Namen",
            ignored: true,
          },
        ],
      }));
    }
    return Promise.resolve(answer(pageNo(prompt)));
  };
  const work = await transcribeRoomWork(
    files(4),
    ask,
    () => {},
    signal(),
    undefined,
    () => {},
    "Leere unbenannte Rückseiten ignorieren; leere Hauptarbeit mit Namen bewerten.",
  );
  assertEquals(work.papers.filter((p) => p.ignored).length, 1);
  const restored =
    parseGradingCheckpoint(serializeGradingCheckpoint(snap(work))).work;
  let assessments = 0;
  const report = await markRoomWork(
    restored,
    "Je Aufgabe 1 Punkt",
    (prompt) => {
      if (prompt.startsWith("QUALITAETSPRUEFUNG")) {
        return Promise.resolve("Zweitgeprüft." + end);
      }
      assessments++;
      assert(
        !prompt.includes("BEWERTUNG EINER SCHÜLERARBEIT: Leere Rückseiten"),
      );
      return Promise.resolve("Geprüft." + end);
    },
    () => {},
    signal(),
  );
  assertEquals(assessments, 2);
  assert(report.includes("alle 2 Schülerarbeiten"));
});
Deno.test("recovery deadlines and terminal credit/auth errors never hang or spend on retries", async () => {
  await assertRejects(() =>
    withGradingTimeout(signal(), () => new Promise(() => {}), 10)
  );
  const abort = new AbortController();
  const task = withGradingTimeout(
    abort.signal,
    () => new Promise(() => {}),
    1000,
  );
  abort.abort();
  await assertRejects(() => task);
  let calls = 0;
  await assertRejects(() =>
    recoverGrading(
      "Test",
      () => {
        calls++;
        throw new GradingFailure("Guthaben fehlt", false);
      },
      signal(),
      () => {},
    )
  );
  assertEquals(calls, 1);
});
const files = (n: number) =>
  Array.from(
    { length: n },
    (_, at) => ({
      index: at + 1,
      name: `Seite-${at + 1}.txt`,
      kind: "text" as const,
      content: "Aufgabe 1: 7 + 5 = 13",
    }),
  );
const pageNo = (prompt: string) =>
  Number(/^--- Seite (\d+) \(/m.exec(prompt)?.[1]);
function answer(n: number) {
  return JSON.stringify({
    pages: [{
      student: `Kind ${Math.ceil(n / 4)}`,
      transcript: "7 + 5 = 13",
      tasks: ["1"],
      figures: [],
    }],
  });
}
function snap(work: GradingSession): GradingCheckpoint {
  return {
    format: "bude-grading",
    version: 1,
    createdAt: new Date().toISOString(),
    work,
    criteria: "7 + 5 = 12. Ohne Punkte, keine Note.",
    feedback: "",
    automatic: false,
    groups: [],
    status: null,
    steps: [],
    report: "",
    lastAction: "transcribe",
  };
}
Deno.test("recovery JSON: code/prose wrappers, newline/escape/trailing comma; never invent missing or ambiguous output", () => {
  assertEquals(
    gradingJson('Hier ist die Abschrift:\n```json\n{"pages":[]}\n```'),
    { pages: [] },
  );
  let warnings = 0;
  const value = gradingJson(
    '{"text":"erste Zeile\nPfad H:\\Server", "list":[1,],}',
    () => warnings++,
  );
  assertEquals(value.text, "erste Zeile\nPfad H:\\Server");
  assertEquals(warnings, 1);
  assertEquals(
    gradingJson('{"text":"Klammer } und Komma ,] und \\"Zitat\\""}').text,
    'Klammer } und Komma ,] und "Zitat"',
  );
  for (
    const text of [
      '{"pages":[',
      '{"pages":[]} {"pages":[1]}',
      "kein JSON",
      '{"pages":[{"transcript":"abgeschnitten',
    ]
  ) assertThrows(() => gradingJson(text));
});
Deno.test("52 pages: isolated JSON failure, all other pages survive, export/import resumes only missing page and grouping", async () => {
  const calls = new Map<number, number>();
  let fail = true, groups = 0, work: GradingSession | undefined;
  const ask: GradingAsk = (prompt, _sources, _signal, options) => {
    if (prompt.startsWith("GRUPPIERUNG")) {
      groups++;
      assertEquals(options?.format, "groups");
      return Promise.resolve(
        JSON.stringify({
          papers: Array.from(
            { length: 13 },
            (_, at) => ({
              student: `Kind ${at + 1}`,
              pages: [1, 2, 3, 4].map((n) => at * 4 + n),
            }),
          ),
        }),
      );
    }
    const n = pageNo(prompt);
    calls.set(n, (calls.get(n) ?? 0) + 1);
    assertEquals(options?.format, "transcript");
    if (n === 19 && fail) return Promise.resolve('Die Antwort ist {"pages":[');
    if (n === 17 && calls.get(n) === 1) return Promise.resolve('"bad JSON"');
    return Promise.resolve(answer(n));
  };
  await assertRejects(() =>
    transcribeRoomWork(
      files(52),
      ask,
      () => {},
      signal(),
      undefined,
      (w) => work = w,
    )
  );
  assert(work);
  assertEquals(work.pages.length, 51);
  assertEquals(groups, 0);
  assertEquals(calls.get(19), 3);
  assertEquals(calls.get(17), 2);
  const restored = parseGradingCheckpoint(
    serializeGradingCheckpoint(snap(work)),
  );
  assertEquals(restored.work.pages.length, 51);
  fail = false;
  const before = [...calls.entries()];
  const result = await transcribeRoomWork(
    [],
    ask,
    () => {},
    signal(),
    restored.work,
  );
  assertEquals(result.pages.length, 52);
  assertEquals(result.papers.length, 13);
  assertEquals(groups, 1);
  for (const [n, count] of before) {
    assertEquals(calls.get(n), count + (n === 19 ? 1 : 0));
  }
});
Deno.test("grouping format errors retry without repeating OCR and fallback unsupported schemas", async () => {
  let ocr = 0, groups = 0, fail = true, work: GradingSession | undefined;
  const ask: GradingAsk = (prompt, _sources, _signal, options) => {
    if (prompt.startsWith("GRUPPIERUNG")) {
      groups++;
      if (fail) return Promise.resolve("{invalid}");
      return Promise.resolve('{"papers":[{"student":"Kind 1","pages":[1]}]}');
    }
    ocr++;
    if (options?.format) {
      throw new GradingFailure(
        "Schema not supported",
        true,
        "format_unsupported",
      );
    }
    return Promise.resolve(answer(1));
  };
  await assertRejects(() =>
    transcribeRoomWork(
      files(1),
      ask,
      () => {},
      signal(),
      undefined,
      (w) => work = w,
    )
  );
  assert(work);
  assertEquals(work.pages.length, 1);
  assertEquals(ocr, 2);
  assertEquals(groups, 3);
  fail = false;
  await transcribeRoomWork([], ask, () => {}, signal(), work);
  assertEquals(ocr, 2);
  assertEquals(groups, 4);
});
Deno.test("grading: truncated part survives failures and checkpoint; resume never repeats completed pupil", async () => {
  let work: GradingSession = {
    sources: files(2),
    prepared: true,
    pages: [1, 2].map((page) => ({
      page,
      file: `Seite-${page}.txt`,
      student: `Kind ${page}`,
      transcript: "7 + 5 = 13",
    })),
    papers: [1, 2].map((n) => ({ student: `Kind ${n}`, pages: [n] })),
  };
  let failed = true, a = 0, b = 0;
  const ask: GradingAsk = (prompt, _sources, _signal, options) => {
    if (prompt.startsWith("QUALITAETSPRUEFUNG")) {
      return Promise.resolve(
        (prompt.includes("Kind 1")
          ? "Richtiger Ansatz, lautet aber 12."
          : "Kind 2: geprüft.") + end,
      );
    }
    assertEquals(options?.maxOutput, 4096);
    if (prompt.startsWith("BEWERTUNG EINER SCHÜLERARBEIT: Kind 2")) {
      b++;
      return Promise.resolve("Kind 2: 7 + 5 = 12. Keine Note." + end);
    }
    a++;
    if (a === 1) {
      throw new GradingTruncated("Aufgabe 1: Richtiger Ansatz, das Ergebnis");
    }
    if (failed) throw new GradingFailure("Vorübergehend nicht erreichbar");
    assert(prompt.includes("FORTSETZUNG"));
    assert(prompt.includes("Richtiger Ansatz"));
    return Promise.resolve("lautet aber 12. Keine Note." + end);
  };
  await assertRejects(() =>
    markRoomWork(work, snap(work).criteria, ask, () => {}, signal())
  );
  assertEquals(b, 1);
  assertEquals(Object.keys(work.cache!.reports).length, 1);
  assertEquals(Object.values(work.cache!.chunks!)[0].length, 1);
  work = parseGradingCheckpoint(serializeGradingCheckpoint(snap(work))).work;
  failed = false;
  const report = await markRoomWork(
    work,
    snap(work).criteria,
    ask,
    () => {},
    signal(),
  );
  assertEquals(b, 1);
  assert(report.includes("Richtiger Ansatz"));
  assert(report.includes("lautet aber 12"));
  assert(!report.includes("BUDE_BEWERTUNG_FERTIG"));
  assertEquals(Object.keys(work.cache!.reports).length, 2);
  await markRoomWork(work, snap(work).criteria, ask, () => {}, signal());
  assertEquals(b, 1);
  assertEquals(a, 5);
});
Deno.test("checkpoint validates references, strips unknown secrets; stop retains successful work", async () => {
  const controller = new AbortController();
  let work: GradingSession | undefined;
  await assertRejects(() =>
    transcribeRoomWork(
      files(6),
      (p) => Promise.resolve(answer(pageNo(p))),
      () => {},
      controller.signal,
      undefined,
      (w) => {
        work = w;
        if (w.pages.length) controller.abort();
      },
    )
  );
  assert(work && work.pages.length >= 1);
  const input = {
    ...snap(work),
    key: "sk-or-v1-DO-NOT-EXPORT",
    password: "Secret!",
  };
  const json = serializeGradingCheckpoint(input);
  assert(!json.includes("DO-NOT-EXPORT"));
  assert(!json.includes("Secret!"));
  const corrupt = JSON.parse(json);
  corrupt.work.pages.push(corrupt.work.pages[0]);
  assertThrows(() => parseGradingCheckpoint(JSON.stringify(corrupt)));
  assertThrows(() =>
    parseGradingCheckpoint('{"format":"unknown","version":1}')
  );
});
