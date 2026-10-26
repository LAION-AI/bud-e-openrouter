/**
 * @file grading.ts
 * @description The correction agent for uploaded class tests.
 *
 *              A teacher photographs a stack of papers and uploads them in
 *              whatever order they came off the desk. Turning that into usable
 *              corrections is not one model call but a sequence, and the order
 *              matters:
 *
 *              1. TRANSCRIBE every page in one pass, so the model sees all the
 *                 handwriting at once and can tell whose is whose. Pages are
 *                 numbered as uploaded; drawings get described rather than
 *                 skipped, because a labelled sketch is often the answer.
 *              2. SORT the pages into papers. Photographs arrive shuffled -
 *                 Alice page 2, Bob page 1, Alice page 1 - and an answer
 *                 continued on the next page carries no marker saying so. Only
 *                 the content can settle that, so a second pass does it with
 *                 the transcripts in front of it.
 *              3. ASK the teacher how to mark. Everything after this depends on
 *                 the answer, and guessing a marking scheme produces confident
 *                 nonsense.
 *              4. MARK each paper, one call per pupil, with the source pages
 *                 attached so the model can go back and look when the
 *                 transcript is ambiguous.
 *              5. WRITE a .docx the teacher can edit.
 *
 *              Steps 1, 2 and 4 report what they are doing, so the chat can
 *              show a collapsed list of the agent's steps.
 */

import { type Block, buildDocx, markdownToBlocks } from "./docx.ts";

/* ================================ types ================================ */

/** One uploaded item: a photo, a PDF, or a text file. */
export interface SourceDoc {
  /** 1-based, in upload order - the only stable name a page has at first. */
  index: number;
  name: string;
  kind: "image" | "pdf" | "text";
  /** data: URL for image/pdf, plain text for text. */
  content: string;
  mime?: string;
}

export interface PageTranscript {
  page: number;
  /** The uploaded file this transcript belongs to - the reliable anchor. */
  file?: string;
  /** Name written on the page, or "" when there is none. */
  student: string;
  /** How the name was arrived at, when it was not simply written down. */
  studentEvidence?: string;
  transcript: string;
  /** Detailed descriptions of drawings, diagrams, sketches. */
  figures?: string[];
  /** Task numbers that appear on this page. */
  tasks?: string[];
  /** True when the page continues an answer from an earlier page. */
  continues?: boolean;
}

export interface StudentPaper {
  student: string;
  /** Page numbers in reading order. */
  pages: number[];
  note?: string;
}

export interface GradingCriteria {
  /** Free text from the teacher: expected answers, points per task, tone. */
  text: string;
}

export type Progress = (step: string, detail?: string) => void;

/* ============================== prompts ============================== */

/**
 * The transcription instruction.
 *
 * Written out at length on purpose: every rule here exists because leaving it
 * implicit produced something unusable. Models summarise when asked to
 * transcribe, silently correct spelling, skip drawings, and render formulas as
 * prose - all of which destroy the evidence the marking then rests on.
 */
export function transcribePrompt(lang: string, count: number): string {
  const de = lang === "de";
  return de
    ? `Du transkribierst ${count} Seiten einer Klassenarbeit. Arbeite Seite für
Seite in der Reihenfolge, in der sie dir gegeben werden.

Für JEDE Seite gibst du an:
- Den DATEINAMEN der Seite, genau so abgeschrieben, wie er im Kopf der Seite
  steht ("--- Seite 3 (foto_bob_s1.png) ---" ergibt "foto_bob_s1.png"). Daran
  wird deine Abschrift der Seite zugeordnet, also muss er exakt stimmen.
- Die Seitennummer aus demselben Kopf.
- Den Namen, der auf der Seite steht. Steht keiner da, lass das Feld leer und
  schreibe unter "studentEvidence", woran du die Seite dennoch zuordnest -
  etwa an der Handschrift, an der fortlaufenden Aufgabennummer oder daran,
  dass ein Satz auf der Vorseite mitten im Wort abbricht.
- Die vollständige Abschrift des Geschriebenen, WÖRTLICH. Korrigiere nichts:
  Rechtschreibfehler, Grammatikfehler und Rechenfehler bleiben genau so
  stehen, wie sie dastehen. Sie sind der Gegenstand der Korrektur.
  Durchgestrichenes kennzeichnest du als ~~durchgestrichen~~.
  Unleserliches als [unleserlich], Unsicheres als [?wort?].
- Mathematische Formeln in LaTeX zwischen $...$, damit sie eindeutig sind.
- Zu jeder Zeichnung, Skizze, jedem Diagramm eine ausführliche Beschreibung:
  was ist zu sehen, wo liegt es im Verhältnis zueinander, welche Beschriftungen
  trägt es, und was scheint es in dieser Aufgabe aussagen zu sollen. Schreibe
  sie so, dass jemand, der das Bild nicht sieht, die Antwort bewerten kann.
- Die Aufgabennummern, die auf der Seite vorkommen.
- Ob die Seite eine Antwort der vorherigen Seite fortsetzt.

Schreibe auf Deutsch. Antworte ausschließlich mit JSON in dieser Form:
{"pages":[{"file":"dateiname.png","page":1,"student":"","studentEvidence":"","transcript":"","figures":["Beschreibung als Text"],"tasks":[],"continues":false}]}`
    : `You are transcribing ${count} pages of a class test. Work page by page in
the order they are given to you.

For EACH page give:
- The FILENAME of the page, copied exactly as it appears in the page header
  ("--- Seite 3 (foto_bob_s1.png) ---" gives "foto_bob_s1.png"). Your
  transcript is matched to the page by this, so it has to be exact.
- The page number from that same header.
- The name written on the page. If there is none, leave it empty and write
  under "studentEvidence" what nevertheless places the page - handwriting, a
  continuing task number, or a sentence that breaks off mid-word on the page
  before.
- The complete transcript, VERBATIM. Correct nothing: spelling, grammar and
  arithmetic mistakes stay exactly as written. They are what is being marked.
  Mark crossed-out text as ~~struck~~, illegible text as [illegible] and
  uncertain readings as [?word?].
- Mathematical formulas in LaTeX between $...$ so they are unambiguous.
- For every drawing, sketch or diagram a detailed description: what is shown,
  how the parts sit relative to each other, what labels it carries, and what it
  appears meant to say in this task. Write it so that someone who cannot see
  the image can still mark the answer.
- The task numbers appearing on the page.
- Whether the page continues an answer from the previous page.

Answer only with JSON in this shape:
{"pages":[{"file":"filename.png","page":1,"student":"","studentEvidence":"","transcript":"","figures":["description as plain text"],"tasks":[],"continues":false}]}`;
}

/** Groups the transcribed pages into papers and puts them in reading order. */
export function sortPrompt(lang: string): string {
  const de = lang === "de";
  return de
    ? `Hier sind die Abschriften der einzelnen Seiten, in der Reihenfolge, in der
sie hochgeladen wurden - also vermutlich durcheinander.

Ordne sie den Schülerinnen und Schülern zu und bringe die Seiten jeder Arbeit
in die richtige Reihenfolge. Stütze dich auf die Namen, wo sie dastehen, und
sonst auf den Inhalt.

Der stärkste Hinweis bei einer Seite ohne Namen sind die AUFGABENNUMMERN:
Innerhalb einer Arbeit kommt jede Aufgabe genau einmal vor. Eine Seite mit
Aufgabe 4 kann also nicht zu einer Arbeit gehören, die Aufgabe 4 schon
beantwortet hat - sie gehört zu der Arbeit, in der diese Aufgabe noch fehlt.
Prüfe das für jede namenlose Seite ausdrücklich, bevor du dich entscheidest,
und schreibe in "note", welche Lücke du damit füllst.

Weitere Hinweise: ein Satz, der auf der nächsten Seite weitergeht, dieselbe
Handschrift laut Beschreibung, eine Zeichnung, die auf einer Seite angekündigt
und auf einer anderen ausgeführt wird. Die Reihenfolge des Hochladens sagt
nichts aus - die Seiten liegen durcheinander.

Wenn du dir bei einer Seite nicht sicher bist, ordne sie trotzdem zu und
schreibe deine Begründung in "note". Erfinde keine Namen: steht nirgends
einer, nimm "Unbekannt 1", "Unbekannt 2".

Antworte ausschließlich mit JSON:
{"papers":[{"student":"Name","pages":[1,4,2],"note":""}]}`
    : `Here are the transcripts of the individual pages, in upload order - so
probably shuffled.

Group them by pupil and put each paper's pages in reading order. Use the names
where they are written, and otherwise the content.

The strongest evidence for a page without a name is the TASK NUMBERS: within
one paper each task appears exactly once. A page carrying task 4 therefore
cannot belong to a paper that already answered task 4 - it belongs to the paper
where that task is still missing. Check this explicitly for every nameless page
before deciding, and write in "note" which gap you are filling.

Further evidence: a sentence continuing onto the next page, the same
handwriting per the descriptions, a drawing announced on one page and carried
out on another. Upload order means nothing - the pages are shuffled.

Where you are unsure about a page, still assign it and put your reasoning in
"note". Do not invent names: if none appears, use "Unknown 1", "Unknown 2".

Answer only with JSON:
{"papers":[{"student":"Name","pages":[1,4,2],"note":""}]}`;
}

/** Hamburg's default percentage tables, used when the teacher gives none. */
export const HAMBURG_SCALE = {
  sek1: [
    [95, "1"], [90, "1-"], [85, "2+"], [80, "2"], [75, "2-"], [70, "3+"],
    [65, "3"], [60, "3-"], [55, "4+"], [50, "4"], [45, "4-"], [33, "5"],
    [0, "6"],
  ] as [number, string][],
  sek2: [
    [95, "15 (1+)"], [90, "14 (1)"], [85, "13 (1-)"], [80, "12 (2+)"],
    [75, "11 (2)"], [70, "10 (2-)"], [65, "9 (3+)"], [60, "8 (3)"],
    [55, "7 (3-)"], [50, "6 (4+)"], [45, "5 (4)"], [39, "4 (4-)"],
    [33, "3 (5+)"], [27, "2 (5)"], [20, "1 (5-)"], [0, "0 (6)"],
  ] as [number, string][],
};

export function scaleText(lang: string): string {
  const de = lang === "de";
  const fmt = (rows: [number, string][]) =>
    rows.map(([p, g]) => `ab ${p}% -> ${g}`).join(", ");
  return de
    ? `Wenn keine eigene Tabelle genannt wurde, nutze die in Hamburg üblichen
Schlüssel. Sekundarstufe I: ${fmt(HAMBURG_SCALE.sek1)}.
Sekundarstufe II (Punkte): ${fmt(HAMBURG_SCALE.sek2)}.
Sag dazu, welche Tabelle du benutzt hast.`
    : `If no table was given, use the scales customary in Hamburg. Lower
secondary: ${fmt(HAMBURG_SCALE.sek1)}. Upper secondary (points):
${fmt(HAMBURG_SCALE.sek2)}. State which table you used.`;
}

/** The marking instruction for one pupil's paper. */
export function markPrompt(
  lang: string,
  student: string,
  criteria: string,
): string {
  const de = lang === "de";
  return de
    ? `Du korrigierst die Arbeit von ${student}.

Die Lehrkraft hat folgenden Erwartungshorizont und Bewertungsmaßstab genannt:
---
${criteria}
---

${scaleText(lang)}

Schreibe einen Korrekturvorschlag. Gehe Teilaufgabe für Teilaufgabe vor und
gib zu jeder:
1. Die Abschrift der Antwort (kurz zitiert, damit die Lehrkraft sie wiederfindet).
2. Eine Rückmeldung, die den Schüler direkt anspricht - freundlich, sachlich,
   und immer belegt: sage, was in der Antwort steht und warum das richtig oder
   unvollständig ist. Keine pauschalen Urteile, kein Lob ohne Grund.
3. Einen Vorschlag für die Rohpunkte mit einer Begründung in einem Satz.

Am Ende:
- Die Summe der Rohpunkte und die erreichte Prozentzahl.
- Einen Notenvorschlag samt genutzter Tabelle.
- Zwei bis drei Sätze Gesamtrückmeldung: was gut gelungen ist und woran der
  Schüler als Nächstes arbeiten kann.

Wenn dir die Abschrift an einer Stelle nicht reicht, um zu bewerten, sieh dir
die Seite noch einmal an - sie liegt dir als Bild bei - und sage in der
Rückmeldung, worauf du dich stützt.

Schreibe auf Deutsch, in Markdown. Beginne mit "## ${student}".`
    : `You are marking the paper of ${student}.

The teacher gave these expectations and marking rules:
---
${criteria}
---

${scaleText(lang)}

Write a correction proposal. Go through it task by task and for each give:
1. The transcribed answer, briefly quoted so the teacher can find it.
2. Feedback addressed to the pupil - friendly, factual, and always evidenced:
   say what the answer contains and why that is right or incomplete. No blanket
   verdicts, no praise without a reason.
3. A proposal for the raw points with a one-sentence justification.

At the end:
- The sum of raw points and the percentage reached.
- A grade proposal naming the table used.
- Two or three sentences of overall feedback: what worked and what to work on.

Where the transcript is not enough to judge, look at the page again - it is
attached as an image - and say in the feedback what you based your reading on.

Write in Markdown. Start with "## ${student}".`;
}

/* ============================ assembling ============================ */

/** Renders the transcript as Markdown for the teacher to check. */
export function transcriptMarkdown(
  pages: PageTranscript[],
  papers: StudentPaper[],
  lang: string,
): string {
  const de = lang === "de";
  const byPage = new Map(pages.map((p) => [p.page, p]));
  const out: string[] = [`# ${de ? "Abschrift der Arbeiten" : "Transcript"}`];

  for (const paper of papers) {
    out.push("", `## ${paper.student}`);
    if (paper.note) out.push("", `> ${paper.note}`);
    for (const n of paper.pages) {
      const p = byPage.get(n);
      if (!p) continue;
      out.push("", `### ${de ? "Seite" : "Page"} ${n}`);
      if (p.tasks?.length) {
        out.push("", `**${de ? "Aufgaben" : "Tasks"}:** ${p.tasks.join(", ")}`);
      }
      out.push("", p.transcript || (de ? "[leer]" : "[empty]"));
      for (const f of p.figures ?? []) {
        out.push("", `> ${de ? "Abbildung" : "Figure"}: ${f}`);
      }
    }
  }

  // Pages nobody claimed would otherwise vanish without trace.
  const claimed = new Set(papers.flatMap((p) => p.pages));
  const orphans = pages.filter((p) => !claimed.has(p.page));
  if (orphans.length) {
    out.push("", `## ${de ? "Nicht zugeordnete Seiten" : "Unassigned pages"}`);
    for (const p of orphans) {
      out.push("", `### ${de ? "Seite" : "Page"} ${p.page}`, "", p.transcript);
    }
  }
  return out.join("\n");
}

/** Builds the final .docx from the per-pupil Markdown. */
export async function buildGradingDocx(
  title: string,
  parts: string[],
  lang: string,
): Promise<Uint8Array> {
  const blocks: Block[] = [{ kind: "h1", text: title }];
  blocks.push({
    kind: "p",
    text: lang === "de"
      ? "Vorschlag zur Korrektur, erstellt mit Bud-E. Bitte prüfen und anpassen - " +
        "die Punktzahlen sind ein Vorschlag, keine Bewertung."
      : "Correction proposal generated with Bud-E. Please review and adjust - " +
        "the points are a proposal, not a mark.",
    italic: true,
  });

  parts.forEach((md, i) => {
    if (i > 0) blocks.push({ kind: "pagebreak" });
    blocks.push(...markdownToBlocks(md));
  });
  return await buildDocx(blocks);
}
