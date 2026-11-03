import { assertEquals, assertStringIncludes } from "$std/assert/mod.ts";
import { gradingEvidenceWarnings } from "../utils/gradingEvidence.ts";
import {
  gradingExportBlocks,
  gradingExportSheets,
} from "../utils/gradingExports.ts";
Deno.test("flags solutions substituted for literal answers without changing any marks", () => {
  const page = {
    page: 7,
    student: "Test",
    transcript:
      "Antwortinventar:\n9 | Byte\n10 | Megabyte\n11 | Kilobyte\n\nGedruckte Aufgabe",
  };
  const report =
    "|Lücke|Dein Eintrag|Punkte|\n|---|---|---|\n|9|Byte|1/1|\n|10|Kilobyte|1/1|\n|11|Megabyte|1/1|";
  const warnings = gradingEvidenceWarnings([page], report);
  assertEquals(warnings.length, 2);
  assertStringIncludes(warnings[0], "Original-ID 7, Lücke 10");
  assertStringIncludes(warnings[1], "Kilobyte");
});
Deno.test("supports labelled anchor columns, case formatting and avoids ambiguous repeated local gap numbers", () => {
  const page = {
    page: 1,
    student: "Test",
    transcript:
      "Antwortinventar\n|Lücke|Ortsanker|Dein Eintrag|Unsicherheit|\n|---|---|---|---|\n|1|acht davon|Byte||\n|2|1024 Byte|Megabyte||",
  };
  const report =
    "|Lücke|Dein Eintrag|Punkte|\n|---|---|---|\n|1|**byte**|1/1|\n|2|Kilobyte|1/1|";
  assertEquals(gradingEvidenceWarnings([page], report).length, 1);
  assertEquals(
    gradingEvidenceWarnings([page, { ...page, page: 2 }], report).length,
    0,
  );
  assertEquals(
    gradingEvidenceWarnings([{
      page: 1,
      student: "X",
      transcript: "normal text",
    }], report).length,
    0,
  );
});
Deno.test("chat retains teacher warnings without creating a fake extra pupil in student exports", () => {
  const sheets = gradingExportSheets(
    gradingExportBlocks(
      "## Lea\n\n*Zugeordnete Seiten in Lesereihenfolge: 1*\n\n> **Prüfhinweis für die Lehrkraft:** Abschrift und Rückmeldung weichen ab. Bitte das Original prüfen.\n\nName: Lea · Klasse: 9b\n\n### Aufgabe 1\nDu hast 1/1 Punkte.\n\nInsgesamt: 1/1 Punkte",
    ),
  );
  assertEquals(sheets.length, 1);
  assertEquals(sheets[0].name, "Lea");
  assertStringIncludes(JSON.stringify(sheets[0].blocks), "1/1 Punkte");
});
Deno.test("headerless three-column inventory compares the literal answer, not its location anchor", () => {
  const page = {
    page: 1,
    student: "Test",
    transcript:
      "Antwortinventar:\n1 | Ein einzelner solcher Zustand heißt | Bit\n2 | Acht davon ergeben zusammen ein | Byte\n3 | 1.024 Byte nennt man ein | Megabyte",
  };
  const report =
    "|Lücke|Deine Antwort|Punkte|\n|---|---|---|\n|1|Bit|1/1|\n|2|Byte|1/1|\n|3|Kilobyte|1/1|";
  const warnings = gradingEvidenceWarnings([page], report);
  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "Lücke 3");
  assertStringIncludes(warnings[0], "Abschrift „Megabyte“");
  assertEquals(
    gradingEvidenceWarnings([{
      ...page,
      transcript: "Antwortinventar:\n1 | unexplained | ambiguous | columns",
    }], report).length,
    0,
  );
});
