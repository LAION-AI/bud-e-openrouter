import { marked, type Token, type Tokens } from "npm:marked@18.1.0";
import type { RichBlock } from "./docxRich.ts";
import { latexToText } from "./docx.ts";
import {
  type GradingSheet,
  prepareGradingSheets,
} from "./gradingPresentation.ts";
import { buildStudentGradingWord } from "./gradingDocx.ts";
import { buildStudentGradingPdf } from "./gradingPdf.ts";

const inline = (tokens: Token[]): string =>
  tokens.map((token) => {
    if ("tokens" in token && Array.isArray(token.tokens)) {
      return inline(token.tokens);
    }
    return "text" in token && typeof token.text === "string"
      ? token.text
      : token.type === "br"
      ? "\n"
      : token.raw;
  }).join("");
export function gradingExportBlocks(text: string): RichBlock[] {
  text = text.replace(
    /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g,
    (math) => latexToText(math),
  );
  const blocks: RichBlock[] = [];
  for (const token of marked.lexer(text)) {
    if (token.type === "space") continue;
    if (token.type === "hr") {
      blocks.push({ kind: "pagebreak" });
      continue;
    }
    if (token.type === "table") {
      const table = token as Tokens.Table;
      blocks.push({
        kind: "table",
        head: true,
        rows: [
          table.header.map((
            cell,
          ) => [{ text: inline(cell.tokens), bold: true }]),
          ...table.rows.map((row) =>
            row.map((cell) => [{ text: inline(cell.tokens) }])
          ),
        ],
      });
      continue;
    }
    if (token.type === "list") {
      for (const item of (token as Tokens.List).items) {
        blocks.push({
          kind: "bullet",
          runs: [{ text: item.text.replace(/\*\*/g, "") }],
        });
      }
      continue;
    }
    const kind = token.type === "heading"
      ? (`h${Math.min(3, (token as Tokens.Heading).depth)}` as
        | "h1"
        | "h2"
        | "h3")
      : token.type === "blockquote"
      ? "quote"
      : "p";
    const content = "tokens" in token && Array.isArray(token.tokens)
      ? inline(token.tokens)
      : "text" in token && typeof token.text === "string"
      ? token.text
      : token.raw;
    blocks.push({ kind, runs: [{ text: content }] });
  }
  return blocks;
}
export type GradingExportOptions = { audience?: "student" | "transcript" };
export function gradingExportSheets(
  blocks: RichBlock[],
  options: GradingExportOptions = {},
): GradingSheet[] {
  if (options.audience !== "transcript") return prepareGradingSheets(blocks);
  const groups: RichBlock[][] = [[]];
  for (const block of blocks) {
    if (block.kind === "pagebreak") {
      if (groups.at(-1)!.length) groups.push([]);
    } else groups.at(-1)!.push(block);
  }
  return groups.filter((g) => g.length).map((group) => ({
    title: "Abschrift · bitte am Original prüfen",
    showMetadata: false,
    name: "",
    className: "",
    date: "",
    version: "",
    blocks: group,
    teacherNotes: [],
  }));
}
export function buildGradingWord(
  text: string,
  options: GradingExportOptions = {},
): Promise<Uint8Array> {
  return buildStudentGradingWord(
    gradingExportSheets(gradingExportBlocks(text), options),
  );
}
export function buildGradingWordFromBlocks(
  blocks: RichBlock[],
  options: GradingExportOptions = {},
): Promise<Uint8Array> {
  return buildStudentGradingWord(gradingExportSheets(blocks, options));
}
let fonts: Promise<[Uint8Array, Uint8Array]> | undefined;
export function loadGradingFonts(): Promise<[Uint8Array, Uint8Array]> {
  return fonts ??= Promise.all(
    ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map(async (name) => {
      const response = await fetch("/fonts/" + name);
      if (!response.ok) {
        throw new Error("PDF-Schrift konnte nicht geladen werden.");
      }
      return new Uint8Array(await response.arrayBuffer());
    }),
  ).then(([regular, bold]) => [regular, bold] as [Uint8Array, Uint8Array])
    .catch((error) => {
      fonts = undefined;
      throw error;
    });
}
/** Actual downloadable PDF with separate pupil sheets. */
export async function buildGradingPdf(
  text: string,
  fontBytes?: [Uint8Array, Uint8Array],
  options: GradingExportOptions = {},
): Promise<Uint8Array> {
  return buildStudentGradingPdf(
    gradingExportSheets(gradingExportBlocks(text), options),
    fontBytes ?? await loadGradingFonts(),
  );
}
export async function buildGradingPdfFromBlocks(
  blocks: RichBlock[],
  fontBytes?: [Uint8Array, Uint8Array],
  options: GradingExportOptions = {},
): Promise<Uint8Array> {
  return buildStudentGradingPdf(
    gradingExportSheets(blocks, options),
    fontBytes ?? await loadGradingFonts(),
  );
}
