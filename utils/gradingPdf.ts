/** Calm, printable student feedback: consistent heads, readable tables, no
 * teacher-only grouping headers. Long content is paginated, never clipped. */
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
} from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import {
  blockText,
  cellText,
  gradingColumnWidths,
  type GradingSheet,
  isPointsSummary,
} from "./gradingPresentation.ts";

const ink = rgb(.13, .20, .29),
  muted = rgb(.34, .41, .49),
  lineColor = rgb(.84, .88, .92),
  tint = rgb(.92, .95, .98);
const PAGE = [595.28, 841.89] as const, LEFT = 44, WIDTH = 507.28, BOTTOM = 55;
function printable(text: string): string {
  // deno-lint-ignore no-control-regex -- model/Word strings can contain control codes.
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(
    /\t/g,
    "  ",
  );
}
function wrap(
  text: string,
  width: number,
  font: PDFFont,
  size: number,
): string[] {
  const out: string[] = [];
  for (const para of printable(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(line + " " + word, size) > width) {
        out.push(line);
        line = "";
      }
      if (font.widthOfTextAtSize(word, size) > width) {
        for (const letter of word) {
          if (line && font.widthOfTextAtSize(line + letter, size) > width) {
            out.push(line);
            line = "";
          }
          line += letter;
        }
      } else line += (line ? " " : "") + word;
    }
    out.push(line);
  }
  return out;
}

export async function buildStudentGradingPdf(
  sheets: GradingSheet[],
  fonts: [Uint8Array, Uint8Array],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts[0], { subset: true }),
    bold = await pdf.embedFont(fonts[1], { subset: true });
  const drawSheet = async (sheet: GradingSheet, scale: number) => {
    const pages: PDFPage[] = [];
    let page!: PDFPage, y = 0;
    const size = 10.3 * scale, tableSize = 9.1 * scale, leading = size * 1.30;
    const next = () => {
      page = pdf.addPage([...PAGE]);
      pages.push(page);
      page.drawRectangle({
        x: LEFT,
        y: PAGE[1] - 47,
        width: WIDTH,
        height: 2.5,
        color: rgb(.30, .41, .56),
      });
      page.drawText(
        (sheet.title || "Deine Rückmeldung") +
          (pages.length > 1 ? " · Fortsetzung" : ""),
        { x: LEFT, y: PAGE[1] - 72, size: 16 * scale, font: bold, color: ink },
      );
      const meta = `Name: ${sheet.name || "________________"}    Klasse: ${
        sheet.className || "________"
      }    Datum: ${sheet.date || "________"}${
        sheet.version ? `    Version: ${sheet.version}` : ""
      }`;
      y = PAGE[1] - 92;
      for (
        const text of sheet.showMetadata === false
          ? []
          : wrap(meta, WIDTH, regular, 8.6 * scale)
      ) {
        page.drawText(text, {
          x: LEFT,
          y,
          size: 8.6 * scale,
          font: regular,
          color: muted,
        });
        y -= 12 * scale;
      }
      y -= 10 * scale;
    };
    const ensure = (height: number) => {
      if (y - height < BOTTOM) next();
    };
    const paragraph = (
      text: string,
      strong = false,
      summary = false,
      indent = 0,
    ) => {
      const font = strong ? bold : regular;
      const lines = wrap(text, WIDTH - indent - (summary ? 16 : 0), font, size);
      if (summary && lines.length * leading + 12 < 630) {
        ensure(lines.length * leading + 15);
        page.drawRectangle({
          x: LEFT,
          y: y - lines.length * leading - 5,
          width: WIDTH,
          height: lines.length * leading + 12,
          color: tint,
        });
        y -= 2;
      }
      for (const row of lines) {
        ensure(leading);
        page.drawText(row, {
          x: LEFT + indent + (summary ? 8 : 0),
          y,
          size,
          font,
          color: ink,
        });
        y -= leading;
      }
      y -= summary ? 11 * scale : 5 * scale;
    };
    next();
    for (let index = 0; index < sheet.blocks.length; index++) {
      const block = sheet.blocks[index];
      if (block.kind === "image") {
        const match = /^data:image\/(png|jpeg|jpg);base64,([a-zA-Z0-9+/=]+)$/
          .exec(block.src);
        if (!match) {
          paragraph(
            block.alt ? `Bild: ${block.alt}` : "Bild im Original prüfen.",
          );
          continue;
        }
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        const image = match[1] === "png"
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);
        const factor = Math.min(WIDTH / image.width, 250 / image.height);
        const height = image.height * factor;
        ensure(height + 12);
        page.drawImage(image, {
          x: LEFT,
          y: y - height,
          width: image.width * factor,
          height,
        });
        y -= height + 10;
        continue;
      }
      if (block.kind === "table") {
        if (!block.rows.length) continue;
        const columns = Math.max(...block.rows.map((r) => r.length));
        if (!columns) continue;
        const rows = block.rows.map((r) =>
          Array.from(
            { length: columns },
            (_, n) => printable(cellText(r[n] ?? [])),
          )
        );
        if (columns > 8) {
          for (const row of rows) paragraph(row.join(" · "));
          continue;
        }
        const widths = gradingColumnWidths(rows, WIDTH),
          rowLeading = tableSize * 1.27,
          pad = 3.5 * scale;
        const cells = (row: string[], head = false) =>
          row.map((text, n) =>
            wrap(text, widths[n] - 12 * scale, head ? bold : regular, tableSize)
          );
        const draw = (
          content: string[][],
          offset: number,
          count: number,
          head: boolean,
          stripe: boolean,
        ) => {
          const height = count * rowLeading + pad * 2;
          if (head || stripe) {
            page.drawRectangle({
              x: LEFT,
              y: y - height,
              width: WIDTH,
              height,
              color: head ? tint : rgb(.98, .985, .99),
            });
          }
          let x = LEFT;
          for (let n = 0; n < columns; n++) {
            content[n].slice(offset, offset + count).forEach((text, at) => {
              if (text) {
                page.drawText(text, {
                  x: x + 6 * scale,
                  y: y - pad - tableSize - at * rowLeading,
                  size: tableSize,
                  font: head ? bold : regular,
                  color: ink,
                });
              }
            });
            x += widths[n];
          }
          page.drawLine({
            start: { x: LEFT, y: y - height },
            end: { x: LEFT + WIDTH, y: y - height },
            thickness: .35,
            color: lineColor,
          });
          y -= height;
        };
        const head = block.head ? cells(rows[0], true) : null;
        if (head && Math.max(...head.map((cell) => cell.length)) > 20) {
          for (const row of rows) paragraph(row.join(" · "));
          continue;
        }
        const header = () => {
          if (head) {
            const h = Math.max(...head.map((c) => c.length));
            ensure(h * rowLeading + pad * 2 + 22);
            draw(head, 0, h, true, false);
          }
        };
        header();
        for (let r = block.head ? 1 : 0; r < rows.length; r++) {
          const content = cells(rows[r]),
            length = Math.max(...content.map((c) => c.length));
          let offset = 0;
          while (offset < length) {
            if (y - BOTTOM < rowLeading + pad * 2) {
              next();
              header();
            }
            const count = Math.min(
              length - offset,
              Math.max(1, Math.floor((y - BOTTOM - pad * 2) / rowLeading)),
            );
            draw(content, offset, count, false, r % 2 === 0);
            offset += count;
          }
        }
        y -= 8 * scale;
        continue;
      }
      if (!("runs" in block)) continue;
      const text = printable(blockText(block));
      if (/^h[123]$/.test(block.kind)) {
        const headingSize = 11.3 * scale,
          lines = wrap(text, WIDTH, bold, headingSize);
        ensure(lines.length * headingSize * 1.3 + 28);
        y -= 3 * scale;
        for (const row of lines) {
          page.drawText(row, {
            x: LEFT,
            y,
            size: headingSize,
            font: bold,
            color: ink,
          });
          y -= headingSize * 1.27;
        }
        y -= 4 * scale;
      } else if (block.kind === "bullet" || block.kind === "number") {
        paragraph("• " + text, false, false, 8 * scale);
      } else {paragraph(
          text,
          isPointsSummary(text) || /^Punkte\s*:/i.test(text),
          isPointsSummary(text),
        );}
    }
    for (const [at, p] of pages.entries()) {
      p.drawLine({
        start: { x: LEFT, y: 39 },
        end: { x: LEFT + WIDTH, y: 39 },
        thickness: .45,
        color: lineColor,
      });
      p.drawText(
        "Rückmeldung zu deiner Arbeit" +
          (pages.length > 1 ? ` · ${at + 1}/${pages.length}` : ""),
        { x: LEFT, y: 26, size: 7.5, font: regular, color: muted },
      );
    }
    return pages.length;
  };
  for (const sheet of sheets) {
    for (const scale of [1, .97, .94]) {
      const before = pdf.getPageCount(), count = await drawSheet(sheet, scale);
      if (count === 1 || scale === .94) break;
      while (pdf.getPageCount() > before) {
        pdf.removePage(pdf.getPageCount() - 1);
      }
    }
  }
  if (!pdf.getPageCount()) pdf.addPage([...PAGE]);
  pdf.setTitle("Rückmeldungen zu deinen Aufgaben");
  return pdf.save();
}
