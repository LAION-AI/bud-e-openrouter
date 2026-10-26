/**
 * @file docx.ts
 * @description Reads and writes .docx without a library.
 *
 *              A .docx is a ZIP holding XML. Both halves of that are already
 *              in the runtime: DecompressionStream("deflate-raw") is exactly
 *              the compression ZIP uses, and the XML we need is simple enough
 *              to build with strings. So this stays a dependency-free module,
 *              the same way the IMAP client is.
 *
 *              Reading is deliberately forgiving - a teacher's file comes from
 *              Word, LibreOffice or Google Docs, and all three lay out their
 *              parts slightly differently. Writing produces the smallest
 *              document Word will accept without complaining.
 */

/* ============================== ZIP reading ============================== */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Lists the files in a ZIP.
 *
 * Walks the central directory at the end rather than scanning local headers:
 * only the central directory carries reliable sizes, because a local header
 * may defer them to a trailing data descriptor.
 */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  // End of central directory: signature 0x06054b50, within the last 64 KB.
  let eocd = -1;
  const from = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (
      bytes[i] === 0x50 && bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");

  const view = dv(bytes);
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);

  const out: ZipEntry[] = [];
  for (let i = 0; i < count && pos + 46 <= bytes.length; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOff = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(pos + 46, pos + 46 + nameLen),
    );

    // The local header repeats the name and extra field, with its own lengths.
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);

    out.push({
      name,
      data: method === 0 ? raw : await inflateRaw(raw),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ============================== ZIP writing ============================== */

/** CRC-32, needed because ZIP entries carry one. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export async function writeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const packed = await deflateRaw(e.data);
    const crc = crc32(e.data);

    const local = new Uint8Array(30 + name.length + packed.length);
    const lv = dv(local);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 8, true); // deflate
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0x21, true); // date (1996-01-01, fixed for reproducibility)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = dv(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = dv(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const l of locals) {
    out.set(l, p);
    p += l.length;
  }
  for (const c of centrals) {
    out.set(c, p);
    p += c.length;
  }
  out.set(eocd, p);
  return out;
}

/* ============================= reading .docx ============================= */

/** Undoes XML entities. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/**
 * Pulls the readable text out of a .docx.
 *
 * Paragraph and line breaks are kept because a class test is structured by
 * them - "Aufgabe 2" on its own line has to stay on its own line, or the
 * transcript loses the task boundaries.
 */
export async function docxToText(bytes: Uint8Array): Promise<string> {
  const entries = await readZip(bytes);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new Error("No word/document.xml - not a .docx?");
  const xml = new TextDecoder().decode(doc.data);

  const paragraphs: string[] = [];
  for (const p of xml.split(/<w:p[ >]/).slice(1)) {
    let text = "";
    // <w:t> holds the words; <w:tab/> and <w:br/> are whitespace.
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      if (m[1] !== undefined) text += unescapeXml(m[1]);
      else if (m[0].startsWith("<w:tab")) text += "\t";
      else text += "\n";
    }
    paragraphs.push(text.trim());
  }
  // Collapse runs of empty paragraphs, keep single blank lines as separators.
  return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ============================= writing .docx ============================= */

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turns light LaTeX into readable text.
 *
 * The transcript asks for formulas in LaTeX so they are unambiguous while the
 * model works with them - but Word does not render it, and a teacher opening
 * the document should not find "\(6 \cdot 32\,\mathrm{g}\)" in the middle
 * of a sentence. Only the constructs that actually turn up in school
 * chemistry and maths are handled; anything else keeps its own text, which is
 * still more readable than the markup around it.
 */
export function latexToText(input: string): string {
  let s = String(input ?? "");

  // Delimiters first, so the content inside is treated like ordinary text.
  s = s.replace(/\\[\[\(]|\\[\]\)]/g, "").replace(/\$\$?/g, "");

  const SUP: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
    "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ",
  };
  const SUB: Record<string, string> = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅",
    "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋",
  };
  const map = (t: string, table: Record<string, string>) =>
    [...t].every((c) => table[c]) ? [...t].map((c) => table[c]).join("") : null;

  // Sub- and superscripts come first: they sit *inside* \mathrm{...}, and
  // leaving them would keep braces there that the next rule cannot match -
  // "\mathrm{C_6H_{12}O_6}" is the ordinary case in a chemistry test.
  s = s.replace(/\^\{([^{}]+)\}/g, (_m, t) => map(t, SUP) ?? `^${t}`);
  s = s.replace(/_\{([^{}]+)\}/g, (_m, t) => map(t, SUB) ?? `_${t}`);
  s = s.replace(/\^(\w)/g, (m, c) => SUP[c] ?? m);
  s = s.replace(/_(\w)/g, (m, c) => SUB[c] ?? m);

  // \frac{a}{b} -> a/b, applied repeatedly for nesting.
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2");
  }
  // \mathrm{g}, \text{...}, \mathbf{...} carry no meaning here.
  for (let i = 0; i < 3; i++) {
    s = s.replace(
      /\\(?:mathrm|mathbf|mathit|text|textrm|operatorname)\{([^{}]*)\}/g,
      "$1",
    );
  }

  const SYMBOLS: [RegExp, string][] = [
    [/\\cdot/g, "·"], [/\\times/g, "×"], [/\\div/g, "÷"],
    [/\\rightarrow|\\to|\\longrightarrow/g, "→"],
    [/\\leftarrow/g, "←"], [/\\leftrightarrow|\\rightleftharpoons/g, "⇌"],
    [/\\approx/g, "≈"], [/\\neq/g, "≠"], [/\\leq/g, "≤"], [/\\geq/g, "≥"],
    [/\\pm/g, "±"],
    // A control word swallows the space after it, which is what makes
    // "\degree C" read as "°C" and not "° C".
    [/\\(?:degree|circ)\s*/g, "°"], [/\\percent/g, "%"],
    [/\\alpha/g, "α"], [/\\beta/g, "β"], [/\\gamma/g, "γ"],
    [/\\Delta/g, "Δ"], [/\\delta/g, "δ"], [/\\pi/g, "π"],
    [/\\lambda/g, "λ"], [/\\mu/g, "µ"], [/\\Omega/g, "Ω"], [/\\infty/g, "∞"],
    [/\\sqrt\{([^{}]*)\}/g, "√($1)"],
  ];
  for (const [re, to] of SYMBOLS) s = s.replace(re, to);

  // Spacing commands, then leftover braces and stray backslashes.
  s = s.replace(/\\[,;:!> ]/g, " ").replace(/\\quad|\\qquad/g, "  ");
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\\([A-Za-z]+)/g, "$1");
  return s.replace(/[ \t]{2,}/g, " ").trim();
}

export type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string; italic?: boolean; bold?: boolean }
  | { kind: "bullet"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "pagebreak" };

const STYLE_OF: Record<string, string> = {
  h1: "Heading1",
  h2: "Heading2",
  h3: "Heading3",
  quote: "Quote",
  bullet: "ListParagraph",
};

/** One paragraph of WordprocessingML. */
function para(b: Block): string {
  if (b.kind === "pagebreak") {
    return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }
  const style = STYLE_OF[b.kind];
  const numbering = b.kind === "bullet"
    ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`
    : "";
  const pPr = style || numbering
    ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${numbering}</w:pPr>`
    : "";

  const italic = (b as { italic?: boolean }).italic;
  const bold = (b as { bold?: boolean }).bold;
  const rPr = italic || bold
    ? `<w:rPr>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}</w:rPr>`
    : "";

  // Line breaks inside a block become <w:br/>, so a multi-line answer keeps
  // its shape instead of collapsing into one long line.
  const runs = String(b.text).split("\n").map((line, i) =>
    `${i ? "<w:r><w:br/></w:r>" : ""}<w:r>${rPr}<w:t xml:space="preserve">${
      esc(line)
    }</w:t></w:r>`
  ).join("");

  return `<w:p>${pPr}${runs}</w:p>`;
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

/** Heading and quote styles, so Word shows a real outline. */
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
</w:styles>`;

const NUMBERING =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">
<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
</w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

/** Builds a .docx from blocks. */
export async function buildDocx(blocks: Block[]): Promise<Uint8Array> {
  const body = blocks.map(para).join("");
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
</w:document>`;

  const enc = new TextEncoder();
  return await writeZip([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "word/document.xml", data: enc.encode(document) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(DOC_RELS) },
    { name: "word/styles.xml", data: enc.encode(STYLES) },
    { name: "word/numbering.xml", data: enc.encode(NUMBERING) },
  ]);
}

/**
 * Turns light Markdown into blocks.
 *
 * The model writes its feedback in Markdown because that is what it is good
 * at; this maps the handful of constructs that actually appear.
 */
export function markdownToBlocks(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of String(md ?? "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line === "---" || line === "***") {
      out.push({ kind: "pagebreak" });
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      out.push({ kind: `h${h[1].length}` as "h1" | "h2" | "h3", text: strip(h[2]) });
      continue;
    }
    const b = line.match(/^\s*[-*+]\s+(.*)$/);
    if (b) {
      out.push({ kind: "bullet", text: strip(b[1]) });
      continue;
    }
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      out.push({ kind: "quote", text: strip(q[1]) });
      continue;
    }
    // A line that is entirely bold reads as a small heading in practice.
    const allBold = line.match(/^\*\*(.+)\*\*:?$/);
    if (allBold) {
      out.push({ kind: "p", text: strip(line), bold: true });
      continue;
    }
    out.push({ kind: "p", text: strip(line) });
  }
  return out;
}

/** Removes the Markdown emphasis marks we do not carry into Word runs. */
function strip(s: string): string {
  const plain = s.replace(/\*\*(.+?)\*\*/g, "$1").replace(
    /(^|\W)\*(\S.*?\S|\S)\*/g,
    "$1$2",
  );
  // Only touch lines that actually carry markup, so ordinary prose with a
  // stray backslash or underscore is left exactly as written.
  return /\\[a-zA-Z(\[]|\$|\^\{|_\{/.test(plain) ? latexToText(plain) : plain;
}
