/**
 * @file worksheet.ts
 * @description Turns a learning path into a printable worksheet.
 *
 *              Opens a plain HTML document in a new window and calls print(),
 *              which gets you the browser's own dialog with "Save as PDF" in
 *              it. Building actual PDF bytes was the alternative and a worse
 *              one: it means shipping a PDF library, embedding a font, and
 *              handling German text by hand - the umlauts alone are a classic
 *              source of mangled output. The browser already does all of that
 *              properly.
 *
 *              The document is self contained: no stylesheet, no script, no
 *              image is loaded from anywhere, so nothing can be missing when
 *              the print dialog opens.
 */

import {
  type Block,
  clozeParts,
  type Exercise,
  type LearningPath,
  type Localized,
  pick,
} from "./learningPaths.ts";

/** Escapes text for HTML. Everything printed goes through here. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The print stylesheet. Sized for A4 and for being written on by hand. */
const STYLE = `
  @page { size: A4; margin: 18mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #111;
    margin: 0;
  }
  h1 { font-size: 19pt; margin: 0 0 2mm; line-height: 1.2; }
  h2 {
    font-size: 13pt;
    margin: 7mm 0 2mm;
    padding-bottom: 1mm;
    border-bottom: 1pt solid #bbb;
    /* A heading alone at the foot of a page reads as an error. */
    break-after: avoid;
  }
  h3 { font-size: 11pt; margin: 4mm 0 1.5mm; break-after: avoid; }
  p { margin: 0 0 2.5mm; }
  ul, ol { margin: 0 0 2.5mm; padding-left: 6mm; }
  li { margin-bottom: 1mm; }

  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2pt solid #333;
    padding-bottom: 2mm;
    margin-bottom: 4mm;
  }
  .masthead .who { font-size: 9pt; color: #555; }
  .lead { font-size: 11.5pt; font-style: italic; color: #333; }

  .namebar {
    display: flex;
    gap: 8mm;
    font-size: 9.5pt;
    color: #444;
    margin-bottom: 5mm;
  }
  .namebar span { flex: 1; border-bottom: 0.6pt solid #888; padding-bottom: 3mm; }

  .callout {
    border-left: 2.5pt solid #666;
    background: #f4f4f4;
    padding: 2mm 3mm;
    margin: 0 0 3mm;
    break-inside: avoid;
  }
  .callout .t { font-weight: bold; }

  table { border-collapse: collapse; width: 100%; margin: 0 0 3mm; font-size: 9.5pt; }
  th, td { border: 0.6pt solid #999; padding: 1.2mm 2mm; text-align: left; }
  th { background: #eee; }

  .tl { margin: 0 0 3mm; }
  .tl div { margin-bottom: 1.5mm; }
  .tl b { display: inline-block; min-width: 20mm; }

  .stats { display: flex; gap: 4mm; margin: 0 0 3mm; }
  .stats div { flex: 1; border: 0.6pt solid #999; padding: 2mm; text-align: center; }
  .stats .v { font-size: 13pt; font-weight: bold; display: block; }
  .stats .l { font-size: 8.5pt; color: #444; }

  blockquote {
    margin: 0 0 3mm;
    padding-left: 3mm;
    border-left: 2pt solid #999;
    font-style: italic;
  }
  .cap { font-size: 9pt; color: #555; margin: -1mm 0 3mm; }

  .sources { font-size: 8.5pt; color: #444; }
  .sources li { margin-bottom: 0.8mm; word-break: break-all; }

  /* --- exercises --- */
  .tasks { break-before: page; }
  .task { break-inside: avoid; margin-bottom: 6mm; }
  .task .intro { font-size: 9.5pt; color: #555; font-style: italic; margin-bottom: 2mm; }
  .task .hint { font-size: 9pt; color: #555; margin-top: 1.5mm; }
  /* A gap wide enough for a word in handwriting. */
  .gap {
    display: inline-block;
    min-width: 32mm;
    border-bottom: 0.8pt solid #333;
    margin: 0 1mm;
  }
  .cloze { line-height: 2.4; text-align: justify; }
  .lines div {
    border-bottom: 0.6pt solid #aaa;
    height: 8mm;
  }

  footer {
    margin-top: 6mm;
    padding-top: 2mm;
    border-top: 0.6pt solid #bbb;
    font-size: 8.5pt;
    color: #666;
    display: flex;
    justify-content: space-between;
  }
`;

interface WorksheetText {
  /** "Arbeitsblatt" */
  worksheet: string;
  name: string;
  date: string;
  tasksTitle: string;
  sourcesTitle: string;
  footer: string;
}

/** Renders one content block. Unknown kinds are skipped, never crash. */
function renderBlock(block: Block, lang: string): string {
  const L = (v: Localized) => esc(pick(v, lang));

  switch (block.kind) {
    case "lead":
      return `<p class="lead">${L(block.text)}</p>`;
    case "heading":
      return `<h3>${L(block.text)}</h3>`;
    case "paragraph":
      return `<p>${L(block.text)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((i) => `<li>${L(i)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "steps": {
      const items = block.items
        .map((s) => `<li><b>${L(s.title)}</b> ${L(s.text)}</li>`)
        .join("");
      return `<ol>${items}</ol>`;
    }
    case "callout": {
      const title = block.title
        ? `<span class="t">${L(block.title)}</span> `
        : "";
      return `<div class="callout">${title}${L(block.text)}</div>`;
    }
    case "table": {
      const head = block.head.map((h) => `<th>${L(h)}</th>`).join("");
      const rows = block.rows
        .map((r) => `<tr>${r.map((c) => `<td>${L(c)}</td>`).join("")}</tr>`)
        .join("");
      const caption = block.caption
        ? `<p class="cap">${L(block.caption)}</p>`
        : "";
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${caption}`;
    }
    case "timeline": {
      const rows = block.entries
        .map((e) =>
          `<div><b>${esc(e.year)}</b> ${L(e.title)} - ${L(e.text)}</div>`
        )
        .join("");
      return `<div class="tl">${rows}</div>`;
    }
    case "stats": {
      const cells = block.entries
        .map((e) =>
          `<div><span class="v">${esc(e.value)}</span><span class="l">${
            L(e.label)
          }</span></div>`
        )
        .join("");
      return `<div class="stats">${cells}</div>`;
    }
    case "quote": {
      const source = block.source
        ? `<br><small>- ${L(block.source)}</small>`
        : "";
      return `<blockquote>${L(block.text)}${source}</blockquote>`;
    }
    case "caption":
      return `<p class="cap">${L(block.text)}</p>`;
    case "sources": {
      const items = block.items
        .map((s) => `<li>${L(s.label)} - ${esc(s.url)}</li>`)
        .join("");
      return `<ul class="sources">${items}</ul>`;
    }
    default:
      return "";
  }
}

/** Turns the ___ markers into ruled gaps wide enough to write in. */
function renderCloze(text: string): string {
  return clozeParts(text)
    .map((part) => esc(part))
    .join('<span class="gap"></span>');
}

function renderExercise(exercise: Exercise, lang: string): string {
  const L = (v: Localized) => esc(pick(v, lang));
  const intro = `<p class="intro">${L(exercise.intro)}</p>`;
  const hint = exercise.hint ? `<p class="hint">${L(exercise.hint)}</p>` : "";

  if (exercise.kind === "cloze") {
    return `<div class="task"><h3>${L(exercise.title)}</h3>${intro}` +
      `<p class="cloze">${
        renderCloze(pick(exercise.text, lang))
      }</p>${hint}</div>`;
  }

  // Room to answer by hand: the harder the question, the more lines.
  const lines = exercise.kind === "reflect" ? 8 : 6;
  const ruled = `<div class="lines">${"<div></div>".repeat(lines)}</div>`;
  return `<div class="task"><h3>${L(exercise.title)}</h3>${intro}` +
    `<p>${L(exercise.text)}</p>${hint}${ruled}</div>`;
}

/** Builds the whole document. Exported so it can be tested without a browser. */
export function buildWorksheetHtml(
  path: LearningPath,
  lang: string,
  text: WorksheetText,
  subjectTitle: string,
): string {
  const L = (v: Localized) => esc(pick(v, lang));
  const title = pick(path.title, lang);

  const screens = path.screens
    .map((screen) =>
      `<section><h2>${L(screen.title)}</h2>` +
      screen.blocks.map((b) => renderBlock(b, lang)).join("") +
      `</section>`
    )
    .join("");

  const exercises = (path.exercises ?? []).length
    ? `<section class="tasks"><h2>${esc(text.tasksTitle)}</h2>` +
      (path.exercises ?? []).map((e) => renderExercise(e, lang)).join("") +
      `</section>`
    : "";

  return `<!doctype html>
<html lang="${lang === "de" ? "de" : "en"}">
<head>
<meta charset="utf-8">
<title>${esc(title)} - ${esc(text.worksheet)}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="masthead">
    <div>
      <h1>${esc(title)}</h1>
      <div class="who">${esc(subjectTitle)} - ${esc(text.worksheet)}</div>
    </div>
    <div class="who">${esc(path.icon)}</div>
  </div>

  <div class="namebar">
    <span>${esc(text.name)}</span>
    <span>${esc(text.date)}</span>
  </div>

  <p class="lead">${L(path.summary)}</p>

  ${screens}
  ${exercises}

  <footer>
    <span>${esc(text.footer)}</span>
    <span>${esc(title)}</span>
  </footer>
</body>
</html>`;
}

/**
 * Opens the worksheet in its own window and brings up the print dialog.
 *
 * Returns false when the browser blocked the window - worth telling the user
 * about, because from their side nothing at all appears to happen.
 */
export function printWorksheet(
  path: LearningPath,
  lang: string,
  text: WorksheetText,
  subjectTitle: string,
): boolean {
  const html = buildWorksheetHtml(path, lang, text, subjectTitle);
  // Deno's Window type is not the browser's, so spell out the little we use.
  // This function only ever runs in a browser.
  interface PrintWindow {
    document: {
      open(): void;
      write(html: string): void;
      close(): void;
      readyState: string;
    };
    focus(): void;
    print(): void;
    addEventListener(type: string, listener: () => void): void;
  }
  // deno-lint-ignore no-explicit-any
  const win = (globalThis as any).open(
    "",
    "_blank",
    "width=900,height=1000",
  ) as PrintWindow | null;
  if (!win) return false;

  win.document.open();
  win.document.write(html);
  win.document.close();

  // Printing before layout is done gives a blank first page in some browsers.
  const start = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === "complete") setTimeout(start, 150);
  else win.addEventListener("load", () => setTimeout(start, 150));
  return true;
}
