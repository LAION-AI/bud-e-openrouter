/** Conservative contradictions, NOT a correctness score. Missing warnings never
 * mean that handwriting was read correctly. Do not alter answers or points. */
import type { PageTranscript } from "./grading.ts";
const clean = (s: string) => s.replace(/[*`„“"']/g, "").trim().toLowerCase();
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) =>
    s.trim()
  );
}
export function gradingEvidenceWarnings(
  pages: PageTranscript[],
  report: string,
): string[] {
  const readings = new Map<number, { text: string; page: number }[]>();
  for (const page of pages) {
    let inventory = false, started = false, answerColumn = 1;
    for (const line of page.transcript.split("\n")) {
      if (/Antwortinventar/i.test(line)) {
        inventory = true;
        started = false;
        answerColumn = 1;
        continue;
      }
      if (!inventory) continue;
      const row = cells(line);
      if (
        row.some((c) => /Ortsanker|Handschrift|Dein Eintrag/i.test(c)) &&
        !/^\d+$/.test(row[0])
      ) {
        const at = row.findIndex((c) => /Handschrift|Dein Eintrag/i.test(c));
        if (at >= 0) answerColumn = at;
        continue;
      }
      if (row.length >= 2 && /^\d+[.)]?$/.test(row[0]) && row[answerColumn]) {
        const n = parseInt(row[0]);
        if (n >= 1 && n <= 300) {
          const entry = { text: row[answerColumn], page: page.page };
          readings.set(n, [...(readings.get(n) ?? []), entry]);
          started = true;
        }
      } else if (started && line.trim() && !/^\|?\s*[-:]/.test(line)) {
        inventory = false;
      }
    }
  }
  const warnings: string[] = [];
  let answerColumn = -1;
  for (const line of report.split("\n")) {
    const row = cells(line);
    if (
      row.some((c) => /Lücke/i.test(c)) &&
      row.some((c) => /Dein(?:e)?\s+(?:Eintrag|Antwort|Lösung)/i.test(c))
    ) {
      answerColumn = row.findIndex((c) =>
        /Dein(?:e)?\s+(?:Eintrag|Antwort|Lösung)/i.test(c)
      );
      continue;
    }
    if (answerColumn < 0) continue;
    if (!/^\d+$/.test(clean(row[0]))) {
      if (line.trim() && !/^\|?\s*[-:]/.test(line)) answerColumn = -1;
      continue;
    }
    const n = Number(clean(row[0])),
      entry = readings.get(n),
      reported = row[answerColumn];
    // Repeated local gap numbers across several tests/pages are ambiguous.
    if (entry?.length !== 1 || !reported) continue;
    if (clean(entry[0].text) !== clean(reported)) {
      warnings.push(
        `Original-ID ${entry[0].page}, Lücke ${n}: Abschrift „${
          entry[0].text
        }“; Rückmeldung „${reported}“. Am Original prüfen – es kann eine Lesekorrektur oder ein Fehler sein.`,
      );
    }
  }
  return [...new Set(warnings)];
}
