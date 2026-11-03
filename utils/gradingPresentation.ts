/** Student handouts and teacher diagnostics are deliberately separate.
 * This module changes presentation only, never the assessment or its totals. */
import type { RichBlock, Run } from "./docxRich.ts";

export type GradingSheet = {
  title?: string;
  /** Proof dossiers keep an exact work/page reference on every page. */
  footer?: string;
  fullPageImage?: boolean;
  showMetadata?: boolean;
  name: string;
  className: string;
  date: string;
  version: string;
  blocks: RichBlock[];
  teacherNotes: string[];
};
export const blockText = (block: RichBlock): string =>
  "runs" in block ? block.runs.map((run) => run.text).join("") : "";
export const cellText = (runs: Run[]) => runs.map((run) => run.text).join("");
export const isPointsSummary = (text: string) =>
  /^(?:Gesamt(?:punkte|punktzahl)?|Insgesamt|Sicher(?:e|\s+erreicht)?|Deine Punkte|Punktestand|Erreicht|Summe)\b/i
    .test(text.trim()) &&
  /\d|offen|nicht.*bestimmbar/i.test(text);

const missing = (text: string) =>
  !text ||
  /^(?:nicht (?:sicher )?(?:eingetragen|angegeben|erkennbar|lesbar)|unbekannt|unleserlich|—|-|offen)(?:\b|$)/i
    .test(text.trim());
function cleanRuns(runs: Run[]): Run[] {
  return runs.map((run) => ({
    text: run.text.replace(/`([^`]+)`/g, "$1"),
    ...(run.bold ? { bold: true } : {}),
    ...(run.italic ? { italic: true } : {}),
    ...(run.strike ? { strike: true } : {}),
    ...(run.sup ? { sup: true } : {}),
    ...(run.sub ? { sub: true } : {}),
    ...(run.font === "Consolas" ? { font: "Consolas" } : {}),
  }));
}
function stripTeacherQualifier(text: string): string {
  return text.replace(/\s+nach\s+(?:der\s+)?Lehrkraftvorgaben?\b/gi, "")
    .replace(
      /\s+nach\s+(?:den|der)\s+(?:Teilpunktregeln?|Vorgaben?)\s+der\s+Lehrkraft\b/gi,
      "",
    )
    .replace(/\s+nach\s+der\s+Vorgabe\s+der\s+Lehrkraft\b/gi, "");
}
function studentParagraph(text: string): string {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„])|\n/).flatMap((sentence) => {
    const cleaned = stripTeacherQualifier(sentence).trim();
    if (
      /^(?:Eine Note|Es wurde keine Note|Keine Note|Für diese Bewertung zählen)/i
        .test(cleaned)
    ) return [];
    if (
      /Lehrkraft|(?:Arbeitsblatt|Aufgabenblatt|Aufgabenblätter)[\s\S]*(?:Punkte|Punktzahl|Gesamt)/i
        .test(cleaned)
    ) {
      const maximum = /(?:höchstens|maximal|insgesamt)\s+(\d+)\s+Punkte/i.exec(
        cleaned,
      );
      if (
        maximum && /Lehrkraft/i.test(cleaned) &&
        !/Arbeitsblatt|Aufgabenblatt/i.test(cleaned)
      ) return [`Maximal sind ${maximum[1]} Punkte möglich.`];
      return [];
    }
    return cleaned ? [cleaned] : [];
  }).join(" ");
}
function cleanBlock(block: RichBlock): RichBlock {
  if (block.kind === "table") {
    return {
      ...block,
      rows: block.rows.map((r) =>
        r.map((cell) => {
          const runs = cleanRuns(cell),
            text = cellText(runs),
            cleaned = stripTeacherQualifier(text);
          return cleaned === text ? runs : [{ text: cleaned }];
        })
      ),
    };
  }
  if ("runs" in block) return { ...block, runs: cleanRuns(block.runs) };
  return block;
}
const field =
  /(?:^|[\s·|])(?:Name|Klasse|(?:Test)?datum|Version|Testversion|Test)\s*:/i;
function metadata(text: string): Partial<GradingSheet> | null {
  if (!field.test(text)) return null;
  const out: Partial<GradingSheet> = {};
  const labels =
    /(?:^|[\s·|])((?:Test)?datum|Testversion|Version|Klasse|Name|Test)\s*:\s*/gi;
  const matches = [...text.matchAll(labels)];
  for (let at = 0; at < matches.length; at++) {
    const m = matches[at], start = m.index! + m[0].length;
    const value = text.slice(start, matches[at + 1]?.index ?? text.length)
      .replace(/[\s·|]+$/, "").trim();
    const key = /^name$/i.test(m[1])
      ? "name"
      : /^klasse$/i.test(m[1])
      ? "className"
      : /datum/i.test(m[1])
      ? "date"
      : "version";
    out[key] = value;
  }
  return out;
}
function neutralLabel(text: string) {
  return text.replace(
    /^(?:Feedbackbogen|Korrektur(?:vorschlag)?|Rückmeldung)(?:\s+für)?\s*[-–—:]?\s*/i,
    "",
  ).trim();
}

/** Existing 15-row gap tables sometimes combine feedback and points. Split
 * only explicit marks, or an unambiguous solution table whose sum is proven
 * by the existing /15 subtotal. No guessed per-task or total points. */
function gapPoints(block: RichBlock, fullText: string): RichBlock {
  if (
    block.kind !== "table" || block.rows.length !== 16 ||
    block.rows[0].length !== 3
  ) return block;
  const headers = block.rows[0].map(cellText);
  if (
    !/Lücke|Nr\.?/i.test(headers[0]) ||
    !/Bewertung|Richtige.*Lösung|Rückmeldung/i.test(headers[2])
  ) return block;
  const rows = block.rows.slice(1).map((row) => row.map(cellText));
  if (!rows.every((r, i) => r.length === 3 && Number(r[0]) === i + 1)) {
    return block;
  }
  const explicit = rows.every((r) =>
    /\b[01]\s*(?:P\b|Punkt)|offen|nicht.*lesbar/i.test(r[2])
  );
  const solution = /Richtige.*Lösung/i.test(headers[2]);
  const parsed = rows.map((r) => {
    const uncertain = /offen|unleserlich|nicht.*lesbar|unsicher/i.test(
      r.join(" "),
    );
    const direct = /\b([01])\s*(?:P\b|Punkt)/i.exec(r[2]);
    const correct = /^richtig\b/i.test(r[2].trim()) ||
      r[1].trim().toLocaleLowerCase() === r[2].trim().toLocaleLowerCase();
    const points = direct
      ? Number(direct[1])
      : uncertain
      ? null
      : correct
      ? 1
      : 0;
    const feedback = r[2].replace(
      /\s*[-–—:]?\s*\b[01]\s*(?:P\b|Punkte?\b)\.?/gi,
      "",
    ).trim();
    return [
      r[0],
      r[1],
      /^richtig\b/i.test(feedback)
        ? "Das passt."
        : solution && !correct && !uncertain
        ? "Hier passt: " + feedback
        : feedback.replace(/^Gemeint ist\s*/i, "Hier passt: "),
      points === null ? "offen / 1" : `${points}/1`,
    ];
  });
  const subtotal = /(?:Lückentext|Aufgabe\s*1)[\s\S]{0,220}?(\d+)\s*\/\s*15/i
    .exec(fullText);
  const total = parsed.reduce((n, r) => n + (r[3] === "1/1" ? 1 : 0), 0);
  const clearJudgments = rows.every((r) =>
    /^richtig\b|^Hier passt\b|^Gesucht\b|^Gemeint\b|offen|nicht.*lesbar/i.test(
      r[2].trim(),
    )
  );
  if (
    !explicit &&
    ((!solution && !clearJudgments) || !subtotal ||
      Number(subtotal[1]) !== total)
  ) {
    return block;
  }
  return {
    kind: "table",
    head: true,
    rows: [["Lücke", "Dein Eintrag", "Rückmeldung", "Punkte"], ...parsed].map((
      row,
    ) => row.map((text) => [{ text }])),
  };
}

export function prepareGradingSheets(input: RichBlock[]): GradingSheet[] {
  const groups: RichBlock[][] = [[]];
  for (const block of input) {
    if (block.kind === "pagebreak") {
      if (groups.at(-1)!.length) groups.push([]);
    } else groups.at(-1)!.push(block);
  }
  return groups.filter((g) =>
    g.some((b) => blockText(b).trim() || b.kind === "table")
  ).map((group) => {
    const sheet: GradingSheet = {
      name: "",
      className: "",
      date: "",
      version: "",
      blocks: [],
      teacherNotes: [],
    };
    const rawText = group.map(blockText).join("\n");
    let fallback = "", started = false;
    for (let at = 0; at < group.length; at++) {
      const original = group[at], text = blockText(original).trim();
      if (!text && original.kind !== "table" && original.kind !== "image") {
        continue;
      }
      if (
        /^(?:Korrekturvorschläge für alle|KI[- –]|Zugeordnete Seiten(?: in Lesereihenfolge)?|Quelle:|Prüfhinweise?\s+für\s+die\s+Lehrkraft\b)/i
          .test(text)
      ) {
        sheet.teacherNotes.push(text);
        continue;
      }
      // The wrapper name belongs to the teacher's grouping view, not a second
      // heading on the student handout. Keep it only as a name fallback.
      if (
        /^h[123]$/.test(original.kind) &&
        /^Zugeordnete Seiten/i.test(
          blockText(group[at + 1] ?? { kind: "pagebreak" }),
        )
      ) {
        fallback = text;
        sheet.teacherNotes.push(text);
        continue;
      }
      if (!started) {
        if (/^Deine Rückmeldung(?:\s*·.*)?$/i.test(text)) continue;
        const fields = metadata(text);
        if (fields) {
          Object.assign(sheet, fields);
          continue;
        }
        if (original.kind === "table") {
          const rows = original.rows.map((row) => row.map(cellText));
          if (
            rows.length === 2 &&
            rows[0].every((v) =>
              /^(Name|Klasse|Testdatum|Datum|Version)$/i.test(v.trim())
            )
          ) {
            Object.assign(
              sheet,
              metadata(
                rows[0].map((v, n) => v + ": " + rows[1][n]).join(" · "),
              ),
            );
            continue;
          }
        }
        if (
          /^h[123]$/.test(original.kind) &&
          !/^(?:Aufgabe|Teilaufgabe|\d+\.?\s|Lückentext|Deine Punkte|Gesamt)/i
            .test(text)
        ) {
          const candidate = neutralLabel(text);
          if (
            candidate &&
            !/Informatik|Computer|Programmieren|Korrektur|Feedback|Lernzielkontrolle/i
              .test(candidate)
          ) fallback ||= candidate;
          continue;
        }
      }
      if (
        /^(?:Eine Note|Es wurde keine Note|Keine Note|Unterschrift|Bitte unterschreiben)/i
          .test(text) &&
        /Note|Notenskala|Unterschrift|unterschreiben/i.test(text)
      ) {
        sheet.teacherNotes.push(text);
        continue;
      }
      let block = cleanBlock(original);
      if ("runs" in block) {
        const before = blockText(block), revised = studentParagraph(before);
        if (revised !== before) {
          sheet.teacherNotes.push(before);
          if (!revised) continue;
          block = { ...block, runs: [{ text: revised }] };
        }
      }
      if ("runs" in block && /^Lernhinweise$/i.test(text)) {
        block = { ...block, runs: [{ text: "Dein nächster Schritt" }] };
      }
      started = true;
      sheet.blocks.push(gapPoints(block, rawText));
    }
    if (!sheet.name && !missing(fallback) && !/^Unbekannt/i.test(fallback)) {
      sheet.name = fallback;
    }
    for (const key of ["name", "className", "date", "version"] as const) {
      if (missing(sheet[key])) sheet[key] = "";
    }
    return sheet;
  });
}

/** Shared relative widths for PDF and Word. Number/point columns stay narrow;
 * feedback gets the room instead of wrapping single numbers across lines. */
export function gradingColumnWidths(rows: string[][], width: number): number[] {
  const headers = rows[0] ?? [];
  const weights = headers.map((head, col) => {
    const cells = rows.slice(1).map((r) => r[col] ?? "");
    if (col === 0 && cells.every((v) => /^[\d\s,–\-/]+$/.test(v))) return 5;
    if (
      /^(?:Punkte|Erreicht|Möglich|Maximal)/i.test(head) &&
      cells.every((v) => v.length < 25)
    ) return 8;
    const lengths = cells.map((v) => v.length).sort((a, b) => a - b);
    return Math.max(
      13,
      Math.min(62, lengths[Math.floor(lengths.length * .7)] ?? head.length),
    );
  });
  const minimums = headers.map((head, col) =>
    col === 0 && weights[col] === 5
      ? 36
      : weights[col] === 8
      ? 54
      : Math.min(105, Math.max(48, head.length * 4.7 + 10))
  );
  const minTotal = minimums.reduce((n, w) => n + w, 0),
    total = weights.reduce((n, w) => n + w, 0);
  return weights.map((w, at) =>
    minTotal >= width
      ? width * minimums[at] / minTotal
      : minimums[at] + (width - minTotal) * w / total
  );
}
