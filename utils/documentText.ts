/**
 * @file documentText.ts
 * @description Turns an uploaded document into plain text for the model.
 *
 *              PDFs are a special case and are not handled here: OpenRouter
 *              takes them whole, extracts them itself and, for a scanned
 *              page, can fall back to reading the pixels. Anything we did
 *              locally would be worse.
 *
 *              Everything else has to be unpacked here, because no chat API
 *              accepts a .docx. Three families:
 *
 *                zip + XML   .docx, .odt   - unpacked and stripped of tags
 *                RTF         .rtf          - control words removed
 *                plain text  .txt .md .csv - passed through, encoding guessed
 *
 *              The old .doc from Word 97 is a different thing entirely: a
 *              compound binary file, not a zip. Rather than half-read one,
 *              it is refused with a sentence saying what to do instead -
 *              a wrong extraction of a marking scheme would be worse than
 *              none.
 */

import { readZip } from "./docx.ts";

export interface ExtractedDoc {
  name: string;
  text: string;
  /** What it was: "docx", "odt", "rtf", "text". */
  kind: string;
  /** Characters before any clipping. */
  chars: number;
}

/** How much of one document goes to the model. */
export const MAX_DOC_TEXT = 120_000;

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * Reads text, guessing the encoding.
 *
 * A file saved by Notepad on Windows is UTF-16 with a byte order mark and
 * would otherwise arrive as text separated by null bytes. Everything without
 * a mark is treated as UTF-8, and if that produces replacement characters,
 * Windows-1252 is tried - which is what most older German text files are.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    }
  }
  // UTF-8 BOM is handled by the decoder itself.
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 0 && bad > utf8.length / 500) {
    try {
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      // Not available: keep what we have rather than nothing.
    }
  }
  return utf8;
}

/** Paragraph text out of a WordprocessingML or ODF body. */
function xmlToText(xml: string, paraTag: string, textTag: string): string {
  const paragraphs: string[] = [];
  const rx = new RegExp(`<${textTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${textTag}>|<[a-z:]*tab\\s*/>|<[a-z:]*(?:br|line-break)\\s*/>`, "g");
  for (const p of xml.split(new RegExp(`<${paraTag}[ >]`)).slice(1)) {
    let text = "";
    for (const m of p.matchAll(rx)) {
      if (m[1] !== undefined) text += unescapeXml(m[1]);
      else if (/tab/.test(m[0])) text += "\t";
      else text += "\n";
    }
    paragraphs.push(text.trim());
  }
  return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function fromDocx(bytes: Uint8Array): Promise<string> {
  const entries = await readZip(bytes);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new Error("keine word/document.xml - ist das wirklich eine .docx?");
  return xmlToText(new TextDecoder().decode(doc.data), "w:p", "w:t");
}

async function fromOdt(bytes: Uint8Array): Promise<string> {
  const entries = await readZip(bytes);
  const doc = entries.find((e) => e.name === "content.xml");
  if (!doc) throw new Error("keine content.xml - ist das wirklich eine .odt?");
  const xml = new TextDecoder().decode(doc.data);
  // Headings and paragraphs both carry their words in <text:span> or directly.
  const body = xml.match(/<office:body>([\s\S]*)<\/office:body>/)?.[1] ?? xml;
  const paragraphs: string[] = [];
  for (const m of body.matchAll(/<text:(p|h)(?:\s[^>]*)?>([\s\S]*?)<\/text:\1>/g)) {
    const inner = m[2]
      .replace(/<text:tab\s*\/>/g, "\t")
      .replace(/<text:line-break\s*\/>/g, "\n")
      .replace(/<text:s\s*\/>/g, " ")
      .replace(/<text:s\s+text:c="(\d+)"\s*\/>/g, (_, n) => " ".repeat(Number(n)))
      .replace(/<[^>]+>/g, "");
    paragraphs.push(unescapeXml(inner).trim());
  }
  return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Text out of an RTF file.
 *
 * RTF is control words, braces and text mixed together. Everything that is
 * not text is dropped, and the escapes that carry accented characters are
 * turned back into the letters they stand for - without that, a German text
 * loses every umlaut.
 */
export function fromRtf(raw: string): string {
  let s = raw;
  // Whole groups that never hold body text.
  //
  // Nested braces are the catch: a font table is `{\\fonttbl{\\f0 Times;}}`,
  // and a non-greedy match ends at the first closing brace, leaving "Times;"
  // behind as if it were part of the document. So the group is walked to its
  // real end, counting braces.
  const dropGroups = (input: string): string => {
    // `{\fonttbl` has one backslash; `{\*\generator` has the ignore marker in
    // between. The old pattern demanded two and therefore matched neither -
    // which is how "Times;" ended up in the text.
    // Two kinds go: the named tables, and anything marked `{\*` - the RTF
    // spec says a reader that does not understand such a group must skip it
    // whole, which is exactly what we are.
    const rx =
      /\{\\\*|\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|generator|listtable|listoverridetable|rsidtbl|xmlnstbl|filetbl|revtbl|upr)\b/g;
    let out = "";
    let at = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(input))) {
      out += input.slice(at, m.index);
      let depth = 0;
      let i = m.index;
      for (; i < input.length; i++) {
        const ch = input[i];
        if (ch === "\\") { i++; continue; }   // an escaped brace is not one
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
      }
      at = i;
      rx.lastIndex = i;
    }
    return out + input.slice(at);
  };
  s = dropGroups(s);
  // \'e4 is a byte in the document's code page; RTF from Word is 1252.
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => {
    const code = parseInt(h, 16);
    try {
      return new TextDecoder("windows-1252").decode(new Uint8Array([code]));
    } catch {
      return String.fromCharCode(code);
    }
  });
  // 舒? is a Unicode code point with an ASCII stand-in after it. The
  // stand-in has to go with it - otherwise an em dash leaves a "?" behind,
  // and \uc2 style files leave two.
  s = s.replace(/\\u(-?\d+)\s?[?]{0,2}/g, (_, d) => {
    let code = Number(d);
    if (code < 0) code += 65536; // RTF writes them as signed 16-bit
    return String.fromCodePoint(code);
  });
  s = s
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\line\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\cell\b/g, "\t")
    .replace(/\\row\b/g, "\n")
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\");
  return s.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Which extensions can be turned into text here. */
export const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".json", ".xml",
  ".html", ".htm", ".rtf", ".docx", ".odt",
];

/** Everything the upload button offers, PDFs included. */
export const UPLOAD_ACCEPT = [".pdf", ...TEXT_EXTENSIONS, ".doc"].join(",");

/**
 * Extracts the text of one document.
 *
 * Throws with a sentence the reader can act on - "this file is empty" and
 * "this format cannot be read here" call for different things, and an error
 * that says which is worth the extra branch.
 */
export async function extractDocumentText(
  name: string,
  bytes: Uint8Array,
): Promise<ExtractedDoc> {
  const lower = name.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  let text = "";
  let kind = "text";

  if (ext === ".docx") {
    kind = "docx";
    text = await fromDocx(bytes);
  } else if (ext === ".odt") {
    kind = "odt";
    text = await fromOdt(bytes);
  } else if (ext === ".rtf") {
    kind = "rtf";
    text = fromRtf(decodeText(bytes));
  } else if (ext === ".doc") {
    // Word 97 binary. Detected by its signature rather than the extension,
    // because a .doc that is really a .docx inside is common enough.
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (isZip) {
      kind = "docx";
      text = await fromDocx(bytes);
    } else {
      throw new Error(
        `"${name}" ist eine alte Word-Datei (.doc). Die lässt sich hier nicht ` +
          `zuverlässig lesen - speichere sie in Word oder LibreOffice einmal ` +
          `als .docx oder .pdf, dann geht es.`,
      );
    }
  } else if (ext === ".html" || ext === ".htm") {
    kind = "text";
    text = decodeText(bytes)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    text = unescapeXml(text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } else {
    kind = "text";
    text = decodeText(bytes).replace(/\r\n?/g, "\n").trim();
  }

  if (!text.trim()) {
    throw new Error(
      `Aus "${name}" ließ sich kein Text lesen. Wenn es eingescannte Seiten ` +
        `sind, lade sie als PDF oder als Bild hoch - dann kann Bud-E sie ansehen.`,
    );
  }
  return { name, kind, chars: text.length, text };
}

/** The text as it goes into the conversation, clipped and labelled. */
export function documentAsMessage(doc: ExtractedDoc): string {
  const clipped = doc.text.length > MAX_DOC_TEXT
    ? doc.text.slice(0, MAX_DOC_TEXT) +
      `\n\n[... gekürzt, ${doc.text.length - MAX_DOC_TEXT} weitere Zeichen]`
    : doc.text;
  return `--- Datei "${doc.name}" (${doc.chars} Zeichen) ---\n${clipped}\n--- Ende von "${doc.name}" ---`;
}
