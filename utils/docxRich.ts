/**
 * @file docxRich.ts
 * @description Converts between the editor's HTML and a real .docx file.
 *
 *              The existing docx.ts writes documents from a small set of
 *              blocks - enough for a marking report, not enough for a word
 *              processor. This one carries what a person actually types:
 *              bold inside a sentence, a numbered list, a centred picture,
 *              a different font on one word.
 *
 *              Both directions are hand-written rather than pulled from a
 *              library, for the same reason docx.ts was: a .docx is a zip of
 *              XML, the zip code is already here, and a dependency that
 *              understands all of Word would be far larger than the part we
 *              need.
 *
 *              What survives a round trip - HTML to .docx and back:
 *                paragraphs, headings 1-3, quotes
 *                bold, italic, underline, strikethrough, superscript,
 *                subscript, font family, font size, text colour
 *                bulleted and numbered lists
 *                left, centre, right and justified alignment
 *                images, with their alignment and display width
 *                tables with a header row
 *
 *              Anything else is dropped rather than guessed at.
 */

import { readZip, writeZip, type ZipEntry } from "./docx.ts";

/* ============================== shared bits ============================== */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unesc(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Word counts font sizes in half-points, CSS in pixels. */
function pxToHalfPoints(px: number): number {
  return Math.max(2, Math.round((px * 0.75) * 2));
}

function halfPointsToPx(hp: number): number {
  return Math.round((hp / 2) / 0.75);
}

/** Word measures pictures in EMU: 914400 per inch, 96 px to the inch. */
const EMU_PER_PX = 9525;

/** A run of text with everything that can be true about it at once. */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  /** Font family name as chosen in the editor, e.g. "Georgia". */
  font?: string;
  /** Size in pixels, as the editor sees it. */
  sizePx?: number;
  /** Six hex digits, no leading hash. */
  color?: string;
}

export type Align = "left" | "center" | "right" | "justify";

export interface ImageBlock {
  kind: "image";
  /** data: URL, exactly as it sits in the document. */
  src: string;
  /** Display width in pixels; the height follows from the aspect ratio. */
  widthPx: number;
  heightPx: number;
  align: Align;
  alt?: string;
}

export type RichBlock =
  | { kind: "p" | "h1" | "h2" | "h3" | "quote"; runs: Run[]; align?: Align }
  | { kind: "bullet" | "number"; runs: Run[]; level?: number }
  | { kind: "table"; rows: Run[][][]; head?: boolean }
  | ImageBlock
  | { kind: "pagebreak" };

/* ========================== HTML into blocks ========================== */

/**
 * A very small HTML reader.
 *
 * The editor produces the HTML this parses, so it does not have to cope with
 * the whole language - but it does have to cope with what browsers leave
 * behind when someone pastes from a website, hence the tolerance for unknown
 * tags and for style attributes in any order.
 */
interface Tag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  closing: boolean;
}

function parseTag(raw: string): Tag {
  const closing = raw.startsWith("</");
  const selfClosing = raw.endsWith("/>");
  const inner = raw.replace(/^<\/?/, "").replace(/\/?>$/, "");
  const name = (inner.match(/^[a-zA-Z0-9]+/)?.[0] ?? "").toLowerCase();
  const attrs: Record<string, string> = {};
  for (const m of inner.matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
  }
  return { name, attrs, selfClosing, closing };
}

/** Reads the handful of CSS properties the editor sets. */
function styleOf(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (attrs.style ?? "").split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
  }
  return out;
}

function colorToHex(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{6})$/);
  if (hex) return hex[1].toUpperCase();
  const short = v.match(/^#([0-9a-f]{3})$/);
  if (short) {
    return short[1].split("").map((c) => c + c).join("").toUpperCase();
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return [1, 2, 3]
      .map((i) => Number(rgb[i]).toString(16).padStart(2, "0"))
      .join("").toUpperCase();
  }
  return undefined;
}

/** Which formatting a tag or its style switches on. */
function marksOf(tag: Tag): Partial<Run> {
  const st = styleOf(tag.attrs);
  const out: Partial<Run> = {};
  switch (tag.name) {
    case "b":
    case "strong":
      out.bold = true;
      break;
    case "i":
    case "em":
      out.italic = true;
      break;
    case "u":
      out.underline = true;
      break;
    case "s":
    case "strike":
    case "del":
      out.strike = true;
      break;
    case "sup":
      out.sup = true;
      break;
    case "sub":
      out.sub = true;
      break;
  }
  // A browser may write the same thing as a style instead of a tag, and
  // execCommand does exactly that in some versions.
  if (/^(bold|[6-9]00)$/.test(st["font-weight"] ?? "")) out.bold = true;
  if (st["font-style"] === "italic") out.italic = true;
  const deco = st["text-decoration"] ?? st["text-decoration-line"] ?? "";
  if (deco.includes("underline")) out.underline = true;
  if (deco.includes("line-through")) out.strike = true;
  if (st["font-family"]) {
    out.font = st["font-family"].split(",")[0].replace(/['"]/g, "").trim();
  }
  if (st["font-size"]) {
    const px = parseFloat(st["font-size"]);
    if (Number.isFinite(px)) {
      out.sizePx = st["font-size"].includes("pt") ? Math.round(px / 0.75) : Math.round(px);
    }
  }
  if (st.color) {
    const c = colorToHex(st.color);
    if (c) out.color = c;
  }
  return out;
}

const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
  "li", "ul", "ol", "table", "tr", "td", "th", "br", "hr", "img",
]);

/**
 * Turns editor HTML into blocks.
 *
 * Deliberately forgiving: unknown tags contribute their text and nothing
 * else, so a paste from a website loses its layout rather than the words.
 */
export function htmlToBlocks(html: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const stack: Tag[] = [];
  let runs: Run[] = [];
  let align: Align | undefined;
  let listType: "bullet" | "number" | null = null;
  let listDepth = 0;
  let blockKind: "p" | "h1" | "h2" | "h3" | "quote" = "p";

  // Tables are collected apart, because their cells contain runs of their own.
  let table: Run[][][] | null = null;
  let row: Run[][] | null = null;
  let tableHead = false;
  // A <p> that held nothing but a picture is not an empty paragraph. Without
  // this, every round trip left a blank line behind each image.
  let blockUsedUp = false;

  const marks = (): Partial<Run> => {
    const out: Partial<Run> = {};
    for (const t of stack) Object.assign(out, marksOf(t));
    return out;
  };

  const pushText = (text: string) => {
    if (!text) return;
    // Whitespace at the start of a block is layout in the source, not part of
    // the text - HTML collapses it too. Without this, a list item written as
    // "<ul>\n<li>x</li>" gained a leading space on every round trip.
    if (runs.length === 0 && text.trim() === "") return;
    const m = marks();
    const last = runs[runs.length - 1];
    // Merge with the previous run when nothing changed - fewer runs mean a
    // smaller file and a document Word does not fragment on opening.
    if (
      last && !!last.bold === !!m.bold && !!last.italic === !!m.italic &&
      !!last.underline === !!m.underline && !!last.strike === !!m.strike &&
      !!last.sup === !!m.sup && !!last.sub === !!m.sub &&
      last.font === m.font && last.sizePx === m.sizePx && last.color === m.color
    ) {
      last.text += text;
      return;
    }
    runs.push({ text, ...m });
  };

  /**
   * Ends the current paragraph.
   *
   * `explicit` says whether a block element actually closed here. Without it
   * an empty paragraph is dropped - the newlines between two tags in the
   * source are layout, and treating them as blank lines made every save add
   * another one, so a document grew a little emptier each time it was opened.
   */
  const flush = (explicit = false) => {
    const hasText = runs.some((r) => r.text.trim() !== "");
    if (row) {
      // Inside a table: the runs belong to the current cell.
      row.push(runs);
      runs = [];
      return;
    }
    if (!hasText) {
      if (explicit && !blockUsedUp) {
        blocks.push({ kind: "p", runs: [{ text: "" }], ...(align ? { align } : {}) });
      }
      runs = [];
      return;
    }
    if (listType) {
      blocks.push({
        kind: listType,
        runs,
        ...(listDepth > 1 ? { level: Math.min(listDepth, 3) } : {}),
      });
    } else {
      blocks.push({ kind: blockKind, runs, ...(align ? { align } : {}) });
    }
    runs = [];
  };

  const tokens = html.split(/(<[^>]+>)/);
  for (const token of tokens) {
    if (!token) continue;
    if (!token.startsWith("<")) {
      // A newline in the source is layout, not content.
      pushText(unesc(token).replace(/[\n\r]+/g, " "));
      continue;
    }
    const tag = parseTag(token);
    if (!tag.name) continue;

    if (tag.name === "img" && !tag.closing) {
      const st = styleOf(tag.attrs);
      const w = parseInt(tag.attrs.width ?? st.width ?? "0", 10);
      const h = parseInt(tag.attrs.height ?? st.height ?? "0", 10);
      const src = tag.attrs.src ?? "";
      if (src) {
        flush();
        blocks.push({
          kind: "image",
          src,
          widthPx: w > 0 ? w : 480,
          heightPx: h > 0 ? h : 0,
          align: (st["margin-left"] === "auto" && st["margin-right"] === "auto")
            ? "center"
            : (align ?? "left"),
          ...(tag.attrs.alt ? { alt: tag.attrs.alt } : {}),
        });
        blockUsedUp = true;
      }
      continue;
    }

    if (tag.name === "br" && !tag.closing) {
      pushText("\n");
      continue;
    }

    if (tag.name === "hr" && !tag.closing) {
      flush();
      blocks.push({ kind: "pagebreak" });
      blockUsedUp = true;
      continue;
    }

    if (!tag.closing && !tag.selfClosing) {
      // Opening tag.
      if (BLOCK_TAGS.has(tag.name)) {
        if (tag.name === "table") {
          flush();
          table = [];
          continue;
        }
        if (tag.name === "tr") {
          row = [];
          continue;
        }
        if (tag.name === "td" || tag.name === "th") {
          if (tag.name === "th") tableHead = true;
          runs = [];
          stack.push(tag);
          continue;
        }
        if (tag.name === "ul" || tag.name === "ol") {
          flush();
          listType = tag.name === "ul" ? "bullet" : "number";
          listDepth++;
          continue;
        }
        if (tag.name !== "li") flush();
        blockUsedUp = false;
        const st = styleOf(tag.attrs);
        const ta = st["text-align"];
        align = ta === "center" || ta === "right" || ta === "justify"
          ? ta
          : ta === "left"
          ? "left"
          : undefined;
        if (tag.name === "h1") blockKind = "h1";
        else if (tag.name === "h2") blockKind = "h2";
        else if (tag.name === "h3") blockKind = "h3";
        else if (/^h[4-6]$/.test(tag.name)) blockKind = "h3";
        else if (tag.name === "blockquote") blockKind = "quote";
        else if (tag.name !== "li") blockKind = "p";
        stack.push(tag);
        continue;
      }
      stack.push(tag);
      continue;
    }

    // Closing tag.
    if (tag.name === "td" || tag.name === "th") {
      if (row) {
        row.push(runs);
        runs = [];
      }
      stack.pop();
      continue;
    }
    if (tag.name === "tr") {
      if (table && row) table.push(row);
      row = null;
      continue;
    }
    if (tag.name === "table") {
      if (table && table.length) {
        blocks.push({ kind: "table", rows: table, ...(tableHead ? { head: true } : {}) });
      }
      table = null;
      tableHead = false;
      continue;
    }
    if (tag.name === "ul" || tag.name === "ol") {
      flush();
      listDepth = Math.max(0, listDepth - 1);
      if (listDepth === 0) listType = null;
      continue;
    }
    if (BLOCK_TAGS.has(tag.name)) {
      flush(true);
      blockUsedUp = false;
      if (tag.name !== "li") {
        blockKind = "p";
        align = undefined;
      }
      // Pop back to before this block started.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === tag.name) {
          stack.splice(i, 1);
          break;
        }
      }
      continue;
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === tag.name) {
        stack.splice(i, 1);
        break;
      }
    }
  }
  flush();

  // Trailing blank paragraphs come from the editor's last <br> and add nothing.
  while (
    blocks.length &&
    blocks[blocks.length - 1].kind === "p" &&
    !("runs" in blocks[blocks.length - 1] &&
      (blocks[blocks.length - 1] as { runs: Run[] }).runs.some((r) => r.text.trim()))
  ) {
    blocks.pop();
  }
  return blocks;
}

/* ========================== blocks into .docx ========================== */

const STYLE_OF: Record<string, string> = {
  h1: "Heading1",
  h2: "Heading2",
  h3: "Heading3",
  quote: "Quote",
  bullet: "ListParagraph",
  number: "ListParagraph",
};

function runXml(r: Run): string {
  const props: string[] = [];
  if (r.font) props.push(`<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}"/>`);
  if (r.bold) props.push("<w:b/>");
  if (r.italic) props.push("<w:i/>");
  if (r.underline) props.push('<w:u w:val="single"/>');
  if (r.strike) props.push("<w:strike/>");
  if (r.sup) props.push('<w:vertAlign w:val="superscript"/>');
  if (r.sub) props.push('<w:vertAlign w:val="subscript"/>');
  if (r.sizePx) props.push(`<w:sz w:val="${pxToHalfPoints(r.sizePx)}"/>`);
  if (r.color) props.push(`<w:color w:val="${r.color}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";

  // A newline inside a run is a soft break, the way Word writes it.
  return r.text.split("\n").map((line, i) =>
    `${i ? `<w:r>${rPr}<w:br/></w:r>` : ""}<w:r>${rPr}` +
    `<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`
  ).join("");
}

function alignXml(a?: Align): string {
  if (!a || a === "left") return "";
  const val = a === "justify" ? "both" : a;
  return `<w:jc w:val="${val}"/>`;
}

/** One picture, as a floating-free inline drawing. */
function drawingXml(b: ImageBlock, relId: string, docPrId: number): string {
  const cx = Math.max(1, Math.round(b.widthPx * EMU_PER_PX));
  const cy = Math.max(1, Math.round((b.heightPx || Math.round(b.widthPx * 0.66)) * EMU_PER_PX));
  const name = esc(b.alt || `Bild ${docPrId}`);
  return `<w:p>${alignXml(b.align) ? `<w:pPr>${alignXml(b.align)}</w:pPr>` : ""}` +
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${name}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function tableXml(rows: Run[][][], head?: boolean): string {
  const width = Math.floor(9638 / Math.max(1, rows[0]?.length ?? 1));
  const body = rows.map((row, r) => {
    const cells = row.map((cell) => {
      const shade = head && r === 0
        ? `<w:shd w:val="clear" w:fill="EDF2F7"/>`
        : "";
      const runs = cell.length ? cell.map(runXml).join("") : "<w:r><w:t/></w:r>";
      const bold = head && r === 0 ? "<w:rPr><w:b/></w:rPr>" : "";
      const inner = head && r === 0 && cell.length
        ? cell.map((c) => runXml({ ...c, bold: true })).join("")
        : runs;
      return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>` +
        `<w:p>${bold ? "" : ""}${inner}</w:p></w:tc>`;
    }).join("");
    return `<w:tr>${cells}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>` +
    `<w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="CBD5E0"/>`)
      .join("") +
    `</w:tblBorders></w:tblPr>${body}</w:tbl>`;
}

const CONTENT_TYPES_HEAD =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Default Extension="gif" ContentType="image/gif"/>
<Default Extension="webp" ContentType="image/webp"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/>
<w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="360" w:after="160"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1F3864"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="280" w:after="120"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="2E5496"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>
<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="200" w:after="80"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="44546A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>
<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480"/><w:pBdr>
<w:left w:val="single" w:sz="12" w:space="8" w:color="A6A6A6"/></w:pBdr></w:pPr>
<w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>
<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:spacing w:after="40"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`;

/** Bullets on numId 1, decimal numbering on numId 2, three levels each. */
const NUMBERING =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
${
    [0, 1, 2].map((l) =>
      `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${["•", "◦", "▪"][l]}"/>` +
      `<w:pPr><w:ind w:left="${720 + l * 360}" w:hanging="360"/></w:pPr></w:lvl>`
    ).join("")
  }
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
${
    [0, 1, 2].map((l) =>
      `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${
        ["decimal", "lowerLetter", "lowerRoman"][l]
      }"/>` +
      `<w:lvlText w:val="%${l + 1}."/>` +
      `<w:pPr><w:ind w:left="${720 + l * 360}" w:hanging="360"/></w:pPr></w:lvl>`
    ).join("")
  }
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const DATA_URL = /^data:([^;,]+)(;base64)?,(.*)$/s;

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extensionFor(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "jpeg";
}

/** Builds a .docx from rich blocks, pictures and all. */
export async function blocksToDocx(blocks: RichBlock[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const media: ZipEntry[] = [];
  const rels: string[] = [
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    `<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`,
  ];
  let picNo = 0;

  const body = blocks.map((b) => {
    if (b.kind === "pagebreak") {
      return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    }
    if (b.kind === "image") {
      const m = b.src.match(DATA_URL);
      if (!m) return "";
      picNo++;
      const ext = extensionFor(m[1]);
      const name = `media/image${picNo}.${ext}`;
      try {
        media.push({ name: `word/${name}`, data: decodeBase64(m[3]) });
      } catch {
        return ""; // a picture that cannot be decoded is dropped, not guessed
      }
      const relId = `rIdPic${picNo}`;
      rels.push(
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${name}"/>`,
      );
      return drawingXml(b, relId, picNo);
    }
    if (b.kind === "table") return tableXml(b.rows, b.head);

    const style = STYLE_OF[b.kind];
    const numId = b.kind === "bullet" ? 1 : b.kind === "number" ? 2 : 0;
    const level = ("level" in b && b.level ? b.level : 1) - 1;
    const numbering = numId
      ? `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`
      : "";
    const jc = "align" in b ? alignXml(b.align) : "";
    const pPr = style || numbering || jc
      ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${numbering}${jc}</w:pPr>`
      : "";
    const runs = b.runs.length ? b.runs.map(runXml).join("") : "";
    return `<w:p>${pPr}${runs}</w:p>`;
  }).join("");

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
</w:document>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels.join("\n")}
</Relationships>`;

  return await writeZip([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES_HEAD) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "word/document.xml", data: enc.encode(document) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(docRels) },
    { name: "word/styles.xml", data: enc.encode(STYLES) },
    { name: "word/numbering.xml", data: enc.encode(NUMBERING) },
    ...media,
  ]);
}

/** Straight from editor HTML to a file, which is what the button needs. */
export async function htmlToDocx(html: string): Promise<Uint8Array> {
  return await blocksToDocx(htmlToBlocks(html));
}

/* ========================== .docx into HTML ========================== */

function attr(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Wraps a run's text in the tags its properties call for. */
function runToHtml(rPr: string, text: string): string {
  let out = esc(text).replace(/\n/g, "<br>");
  const styles: string[] = [];
  const font = attr(rPr, "w:ascii");
  if (font) styles.push(`font-family: ${font}`);
  const sz = rPr.match(/<w:sz w:val="(\d+)"/)?.[1];
  if (sz) styles.push(`font-size: ${halfPointsToPx(Number(sz))}px`);
  const color = rPr.match(/<w:color w:val="([0-9A-Fa-f]{6})"/)?.[1];
  if (color && color.toUpperCase() !== "000000") styles.push(`color: #${color}`);
  if (styles.length) out = `<span style="${styles.join("; ")}">${out}</span>`;

  if (/<w:vertAlign w:val="superscript"/.test(rPr)) out = `<sup>${out}</sup>`;
  if (/<w:vertAlign w:val="subscript"/.test(rPr)) out = `<sub>${out}</sub>`;
  if (/<w:strike\s*\/>/.test(rPr)) out = `<s>${out}</s>`;
  if (/<w:u\s/.test(rPr)) out = `<u>${out}</u>`;
  if (/<w:i\s*\/>/.test(rPr)) out = `<em>${out}</em>`;
  if (/<w:b\s*\/>/.test(rPr)) out = `<strong>${out}</strong>`;
  return out;
}

/** Everything inside one <w:p>, as inline HTML. */
function paragraphInner(xml: string, images: Map<string, string>): string {
  let out = "";
  for (const m of xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    const inner = m[1];
    const rPr = inner.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? "";

    const embed = inner.match(/r:embed="([^"]+)"/)?.[1];
    if (embed) {
      const src = images.get(embed);
      if (src) {
        const cx = Number(inner.match(/<wp:extent cx="(\d+)"/)?.[1] ?? 0);
        const w = cx ? Math.round(cx / EMU_PER_PX) : 480;
        out += `<img src="${src}" width="${w}" style="max-width: 100%">`;
      }
      continue;
    }
    if (/<w:br\s*\/>/.test(inner) && !/<w:t/.test(inner)) {
      out += "<br>";
      continue;
    }
    for (const t of inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
      out += runToHtml(rPr, unesc(t[1]));
    }
  }
  return out;
}

/**
 * Reads a .docx into HTML the editor can show.
 *
 * Only what the editor can also write is kept - a document from Word with
 * fields, footnotes or columns loses those and keeps its text.
 */
export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const entries = await readZip(bytes);
  const dec = new TextDecoder();
  const docEntry = entries.find((e) => e.name === "word/document.xml");
  if (!docEntry) throw new Error("Keine word/document.xml - ist das eine .docx-Datei?");
  const xml = dec.decode(docEntry.data);

  // Relationship id to data URL, so a picture keeps working offline.
  const images = new Map<string, string>();
  const relEntry = entries.find((e) => e.name === "word/_rels/document.xml.rels");
  if (relEntry) {
    const relXml = dec.decode(relEntry.data);
    for (const m of relXml.matchAll(/<Relationship\s[^>]*\/>/g)) {
      const id = attr(m[0], "Id");
      const target = attr(m[0], "Target");
      if (!id || !target || !/image/i.test(m[0])) continue;
      const path = `word/${target.replace(/^\.\//, "")}`;
      const file = entries.find((e) => e.name === path);
      if (!file) continue;
      const ext = path.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "png"
        ? "image/png"
        : ext === "gif"
        ? "image/gif"
        : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
      images.set(id, `data:${mime};base64,${encodeBase64(file.data)}`);
    }
  }

  const numFormats = new Map<string, "bullet" | "number">();
  const numEntry = entries.find((e) => e.name === "word/numbering.xml");
  if (numEntry) {
    const numXml = dec.decode(numEntry.data);
    const abstract = new Map<string, "bullet" | "number">();
    for (const m of numXml.matchAll(/<w:abstractNum w:abstractNumId="(\d+)">([\s\S]*?)<\/w:abstractNum>/g)) {
      abstract.set(m[1], /<w:numFmt w:val="bullet"/.test(m[2]) ? "bullet" : "number");
    }
    for (const m of numXml.matchAll(/<w:num w:numId="(\d+)">\s*<w:abstractNumId w:val="(\d+)"/g)) {
      numFormats.set(m[1], abstract.get(m[2]) ?? "bullet");
    }
  }

  const html: string[] = [];
  let openList: "ul" | "ol" | null = null;
  const closeList = () => {
    if (openList) {
      html.push(`</${openList}>`);
      openList = null;
    }
  };

  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  // Paragraphs and tables, in the order they appear.
  for (const m of body.matchAll(/<w:(p|tbl)(?:\s[^>]*)?>([\s\S]*?)<\/w:\1>/g)) {
    if (m[1] === "tbl") {
      closeList();
      const rows: string[] = [];
      for (const tr of m[2].matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)) {
        const cells: string[] = [];
        for (const tc of tr[1].matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)) {
          const inner = [...tc[1].matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
            .map((p) => paragraphInner(p[1], images)).join("<br>");
          cells.push(`<td>${inner || "&nbsp;"}</td>`);
        }
        rows.push(`<tr>${cells.join("")}</tr>`);
      }
      html.push(`<table>${rows.join("")}</table>`);
      continue;
    }

    const inner = m[2];
    const pPr = inner.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] ?? "";
    const style = pPr.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const numId = pPr.match(/<w:numId w:val="(\d+)"/)?.[1];
    const jc = pPr.match(/<w:jc w:val="([^"]+)"/)?.[1];
    const alignStyle = jc && jc !== "left"
      ? ` style="text-align: ${jc === "both" ? "justify" : jc}"`
      : "";

    if (/<w:br w:type="page"\/>/.test(inner)) {
      closeList();
      html.push("<hr>");
      continue;
    }

    const content = paragraphInner(inner, images);

    if (numId) {
      const want = numFormats.get(numId) === "number" ? "ol" : "ul";
      if (openList !== want) {
        closeList();
        html.push(`<${want}>`);
        openList = want;
      }
      html.push(`<li>${content || "<br>"}</li>`);
      continue;
    }
    closeList();

    if (/^Heading1$/i.test(style)) html.push(`<h1${alignStyle}>${content}</h1>`);
    else if (/^Heading2$/i.test(style)) html.push(`<h2${alignStyle}>${content}</h2>`);
    else if (/^Heading3$/i.test(style)) html.push(`<h3${alignStyle}>${content}</h3>`);
    else if (/^Quote$/i.test(style)) html.push(`<blockquote${alignStyle}>${content}</blockquote>`);
    else html.push(`<p${alignStyle}>${content || "<br>"}</p>`);
  }
  closeList();
  return html.join("\n");
}

/** Plain text out of editor HTML - for the chat, and for searching. */
export function htmlToPlainText(html: string): string {
  return htmlToBlocks(html).map((b) => {
    if (b.kind === "image") return `[Bild${b.alt ? ": " + b.alt : ""}]`;
    if (b.kind === "pagebreak") return "---";
    if (b.kind === "table") {
      return b.rows.map((r) =>
        r.map((c) => c.map((x) => x.text).join("")).join(" | ")
      ).join("\n");
    }
    const text = b.runs.map((r) => r.text).join("");
    if (b.kind === "bullet") return `- ${text}`;
    if (b.kind === "number") return `1. ${text}`;
    if (b.kind === "h1") return `# ${text}`;
    if (b.kind === "h2") return `## ${text}`;
    if (b.kind === "h3") return `### ${text}`;
    if (b.kind === "quote") return `> ${text}`;
    return text;
  }).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
