/** A dedicated, editable student-handout style. Does not change the Docs editor. */
import { writeZip } from "./docx.ts";
import { blocksToDocx, type RichBlock, type Run } from "./docxRich.ts";
import {
  blockText,
  cellText,
  gradingColumnWidths,
  type GradingSheet,
  isPointsSummary,
} from "./gradingPresentation.ts";

const esc = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function runsXml(runs: Run[], size?: number, strong = false): string {
  return runs.map((run) => {
    const props = `${strong || run.bold ? "<w:b/>" : ""}${
      run.italic ? "<w:i/>" : ""
    }${run.strike ? "<w:strike/>" : ""}${
      run.sup || run.sub
        ? `<w:vertAlign w:val="${run.sup ? "superscript" : "subscript"}"/>`
        : ""
    }${size ? `<w:sz w:val="${size}"/>` : ""}${
      run.font === "Consolas"
        ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
        : ""
    }`;
    return run.text.split("\n").map((text, at) =>
      `${at ? "<w:r><w:br/></w:r>" : ""}<w:r>${
        props ? `<w:rPr>${props}</w:rPr>` : ""
      }<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
    ).join("");
  }).join("");
}
function p(runs: Run[], style = "Normal"): string {
  style = style === "Title" ? "Heading1" : style === "TaskHeading" ? "Heading2" : style;
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${
    runsXml(runs)
  }</w:p>`;
}
function table(block: Extract<RichBlock, { kind: "table" }>): string {
  const rows = block.rows.map((r) => r.map(cellText));
  const widths = gradingColumnWidths(rows, 505.3).map((n) =>
    Math.round(n * 20)
  );
  const content = block.rows.map((row, at) =>
    `<w:tr><w:trPr><w:cantSplit/>${
      at === 0 && block.head ? "<w:tblHeader/>" : ""
    }</w:trPr>${
      row.map((cell, col) =>
        `<w:tc><w:tcPr><w:tcW w:w="${
          widths[col]
        }" w:type="dxa"/><w:shd w:fill="${
          at === 0 && block.head ? "EAF0F7" : at % 2 === 0 ? "F8FAFC" : "FFFFFF"
        }"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr>${
          runsXml(cell, 18, at === 0 && block.head === true)
        }</w:p></w:tc>`
      ).join("")
    }</w:tr>`
  ).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="10106" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="45" w:type="dxa"/><w:bottom w:w="45" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D6E0EB"/><w:bottom w:val="single" w:sz="4" w:color="D6E0EB"/><w:insideH w:val="single" w:sz="3" w:color="E2E8F0"/></w:tblBorders></w:tblPr><w:tblGrid>${
    widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")
  }</w:tblGrid>${content}</w:tbl>`;
}
function header(sheet: GradingSheet): RichBlock[] {
  return [
    {
      kind: "h1",
      runs: [{
        text: sheet.title || "Deine Rückmeldung",
      }],
    },
    {
      kind: "p",
      runs: [{
        text: `Name: ${sheet.name || "________________"}    Klasse: ${
          sheet.className || "________"
        }    Datum: ${sheet.date || "________"}${
          sheet.version ? `    Version: ${sheet.version}` : ""
        }`,
      }],
    },
  ];
}
export function buildStudentGradingWord(
  sheets: GradingSheet[],
): Promise<Uint8Array> {
  if (sheets.some((sheet) => sheet.blocks.some((b) => b.kind === "image"))) {
    return blocksToDocx(
      sheets.flatMap((
        sheet,
        at,
      ) => [
        ...(at ? [{ kind: "pagebreak" as const }] : []),
        ...header(sheet),
        ...sheet.blocks,
      ]),
      { compact: true },
    );
  }
  const body = sheets.map((sheet, at) => {
    const start = at ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : "";
    return start + p(
      header(sheet)[0].kind === "h1"
        ? (header(sheet)[0] as { runs: Run[] }).runs
        : [],
      "Title",
    ) +
      (sheet.showMetadata === false
        ? ""
        : p((header(sheet)[1] as { runs: Run[] }).runs, "Metadata")) +
      sheet.blocks.map((block) => {
        if (block.kind === "table") {
          return table(block);
        }
        if (!("runs" in block)) return "";
        const text = blockText(block);
        const style = isPointsSummary(text)
          ? "Points"
          : /^h[123]$/.test(block.kind)
          ? "TaskHeading"
          : "Normal";
        const runs = block.kind === "bullet" || block.kind === "number"
          ? [{ text: "• " }, ...block.runs]
          : block.runs;
        return p(runs, style);
      }).join("");
  }).join("");
  const styles =
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/><w:color w:val="24364B"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="65" w:line="245" w:lineRule="auto"/><w:widowControl/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Feedback Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="90"/><w:pBdr><w:top w:val="single" w:sz="18" w:space="8" w:color="4B668C"/></w:pBdr></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="203A5B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Feedback Metadata"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="140"/></w:pPr><w:rPr><w:sz w:val="18"/><w:color w:val="53657A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TaskHeading"><w:name w:val="Task Heading"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="125" w:after="65"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:color w:val="203A5B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Feedback Table"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="220" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Points"><w:name w:val="Your Points"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="95"/><w:shd w:fill="EAF0F7"/><w:ind w:left="100" w:right="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="21"/><w:color w:val="203A5B"/></w:rPr></w:style>
</w:styles>`;
  const enc = new TextEncoder();
  const xml = (name: string, text: string) => ({
    name,
    data: enc.encode(text),
  });
  return writeZip([
    xml(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    ),
    xml(
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    xml(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="1050" w:left="900"/></w:sectPr></w:body></w:document>`,
    ),
    xml("word/styles.xml", styles.replaceAll('w:styleId="Title"','w:styleId="Heading1"').replaceAll('w:styleId="TaskHeading"','w:styleId="Heading2"')),
    xml(
      "word/_rels/document.xml.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
  ]);
}
