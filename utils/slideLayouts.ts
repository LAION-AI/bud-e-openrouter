/**
 * @file slideLayouts.ts
 * @description Turns what the assistant says about a slide into the slide,
 *              and gives a deck one of the designs.
 *
 *              The assistant thinks in content: a title, some bullet points,
 *              a picture, a note for the speaker. It should not have to think
 *              in pixels, and a model asked for coordinates produces boxes
 *              that overlap. So it names a layout and fills in the words, and
 *              this module places everything on a 960 x 540 canvas in a way
 *              that looks like someone meant it.
 *
 *              The designs are made here rather than taken from anywhere:
 *              a colour world, two fonts, a background - plain or a gradient -
 *              and a few decorative shapes per slide kind. Shapes and
 *              gradients travel into the .pptx as what they are, so a deck
 *              looks in PowerPoint as it does here, and there is nothing to
 *              license. The decorations are ordinary elements: a writer can
 *              move or delete them, and a change of design swaps them out.
 */

import {
  type Deck,
  type Gradient,
  newElementId,
  newSlideId,
  type Paragraph,
  paragraphsText,
  type Run,
  type Slide,
  SLIDE_H,
  SLIDE_W,
  type SlideElement,
  type TextElement,
} from "./pptx.ts";

/* ================================================================ specs */

export type SlideLayout =
  | "title"
  | "section"
  | "bullets"
  | "text"
  | "image-right"
  | "image-left"
  | "image-full"
  | "two-columns"
  | "quote"
  | "blank";

/** What the assistant may say about one slide. */
export interface SlideSpec {
  layout?: SlideLayout;
  title?: string;
  subtitle?: string;
  /** Lines; two leading spaces make a sub-point. `**bold**` works. */
  bullets?: string[];
  /** Running text; blank lines separate paragraphs. */
  text?: string;
  /** An image id from the conversation (gen_00001, upl_00002) or a data: URL. */
  image?: string;
  caption?: string;
  left?: string[] | string;
  right?: string[] | string;
  leftTitle?: string;
  rightTitle?: string;
  quote?: string;
  author?: string;
  notes?: string;
  /** "#rrggbb" - overrides the theme for this slide only. */
  background?: string;
}

/** The layouts as the picker shows them. */
export const LAYOUTS: { key: SlideLayout; de: string; en: string }[] = [
  { key: "title", de: "Titelfolie", en: "Title slide" },
  { key: "section", de: "Abschnitt", en: "Section" },
  { key: "bullets", de: "Titel und Stichpunkte", en: "Title and bullets" },
  { key: "text", de: "Titel und Text", en: "Title and text" },
  { key: "image-right", de: "Bild rechts", en: "Picture right" },
  { key: "image-left", de: "Bild links", en: "Picture left" },
  { key: "image-full", de: "Großes Bild", en: "Large picture" },
  { key: "two-columns", de: "Zwei Spalten", en: "Two columns" },
  { key: "quote", de: "Zitat", en: "Quote" },
  { key: "blank", de: "Leer", en: "Blank" },
];

/** Placeholder content for a slide added from the picker. */
export function newSlideSpec(layout: SlideLayout, lang: string): SlideSpec {
  const de = lang !== "en";
  const t = (d: string, e: string) => de ? d : e;
  switch (layout) {
    case "title":
      return { layout, title: t("Titel der Präsentation", "Presentation title"), subtitle: t("Untertitel", "Subtitle") };
    case "section":
      return { layout, title: t("Neuer Abschnitt", "New section") };
    case "bullets":
      return { layout, title: t("Überschrift", "Heading"), bullets: [t("Erster Punkt", "First point"), t("Zweiter Punkt", "Second point"), t("Dritter Punkt", "Third point")] };
    case "text":
      return { layout, title: t("Überschrift", "Heading"), text: t("Text hier eingeben.", "Enter text here.") };
    case "image-right":
    case "image-left":
      return { layout, title: t("Überschrift", "Heading"), bullets: [t("Erster Punkt", "First point"), t("Zweiter Punkt", "Second point")] };
    case "image-full":
      return { layout, title: t("Überschrift", "Heading"), caption: t("Bildunterschrift", "Caption") };
    case "two-columns":
      return { layout, title: t("Vergleich", "Comparison"), leftTitle: t("Links", "Left"), rightTitle: t("Rechts", "Right"), left: [t("Punkt", "Point")], right: [t("Punkt", "Point")] };
    case "quote":
      return { layout, quote: t("Ein Zitat, das hängen bleibt.", "A quote that stays."), author: t("Name", "Name") };
    default:
      return { layout: "blank" };
  }
}

/* =============================================================== themes */

export interface Theme {
  key: string;
  label: { de: string; en: string };
  bg: string;
  bgGradient?: Gradient;
  title: string;
  text: string;
  accent: string;
  accent2: string;
  sectionBg: string;
  sectionGradient?: Gradient;
  sectionText: string;
  titleFont: string;
  bodyFont: string;
  /** Kept for callers that only know one font. */
  font: string;
  /** Decorative shapes for a kind of slide. */
  decor: (kind: "title" | "section" | "content") => SlideElement[];
}

const shape = (
  s: Partial<Extract<SlideElement, { kind: "shape" }>> & { x: number; y: number; w: number; h: number },
): SlideElement => ({
  kind: "shape",
  id: newElementId(),
  shape: "rect",
  decor: true,
  ...s,
} as SlideElement);

const none = () => [] as SlideElement[];

function theme(
  t: Omit<Theme, "font" | "decor" | "label"> & { label: { de: string; en: string }; decor?: Theme["decor"] },
): Theme {
  return { font: t.bodyFont, decor: none, ...t };
}

export const THEMES: Record<string, Theme> = {
  blue: theme({
    key: "blue",
    label: { de: "Klassisch Blau", en: "Classic blue" },
    bg: "#ffffff",
    title: "#1f3864",
    text: "#262626",
    accent: "#2e75b6",
    accent2: "#9dc3e6",
    sectionBg: "#1f3864",
    sectionText: "#ffffff",
    titleFont: "Calibri",
    bodyFont: "Calibri",
    decor: (k) => k === "title" ? [shape({ x: 0, y: 0, w: SLIDE_W, h: 180, fill: "#1f3864" })] : [],
  }),
  green: theme({
    key: "green",
    label: { de: "Natur", en: "Nature" },
    bg: "#ffffff",
    bgGradient: { from: "#ffffff", to: "#eef7ee", angle: 90 },
    title: "#1e4d2b",
    text: "#262626",
    accent: "#3a9d5d",
    accent2: "#a7d7b8",
    sectionBg: "#1e4d2b",
    sectionGradient: { from: "#1e4d2b", to: "#2f7a45", angle: 45 },
    sectionText: "#ffffff",
    titleFont: "Calibri",
    bodyFont: "Calibri",
    decor: (k) =>
      k === "content"
        ? [shape({ shape: "ellipse", x: 880, y: 470, w: 120, h: 60, rotation: -30, fill: "#a7d7b8" })]
        : [
          shape({ shape: "ellipse", x: 720, y: 468, w: 260, h: 110, rotation: -25, fill: "#3a9d5d" }),
          shape({ shape: "ellipse", x: 820, y: 500, w: 200, h: 90, rotation: -20, fill: "#a7d7b8" }),
          shape({ shape: "ellipse", x: -40, y: -30, w: 200, h: 90, rotation: 30, fill: "#a7d7b8" }),
        ],
  }),
  warm: theme({
    key: "warm",
    label: { de: "Warm", en: "Warm" },
    bg: "#fffaf3",
    title: "#7a3e00",
    text: "#3b2a1a",
    accent: "#e07b00",
    accent2: "#f6c78a",
    sectionBg: "#c2410c",
    sectionText: "#fff7ed",
    titleFont: "Georgia",
    bodyFont: "Calibri",
    decor: (k) => k === "title" ? [shape({ x: 0, y: 0, w: SLIDE_W, h: 180, fill: "#c2410c" })] : [shape({ x: 0, y: 520, w: SLIDE_W, h: 20, fill: "#f6c78a" })],
  }),
  dark: theme({
    key: "dark",
    label: { de: "Dunkel", en: "Dark" },
    bg: "#1e1e2e",
    bgGradient: { from: "#1e1e2e", to: "#2b2b45", angle: 90 },
    title: "#f5f5f5",
    text: "#e6e6e6",
    accent: "#7c9cff",
    accent2: "#3d4a7a",
    sectionBg: "#11111b",
    sectionText: "#ffffff",
    titleFont: "Calibri",
    bodyFont: "Calibri",
    decor: (k) => [shape({ shape: "ellipse", x: k === "content" ? 860 : 700, y: k === "content" ? -60 : -120, w: k === "content" ? 200 : 380, h: k === "content" ? 200 : 380, fill: "#3d4a7a" })],
  }),
  purple: theme({
    key: "purple",
    label: { de: "Violett", en: "Violet" },
    bg: "#ffffff",
    title: "#4c1d95",
    text: "#262626",
    accent: "#8b5cf6",
    accent2: "#ddd6fe",
    sectionBg: "#4c1d95",
    sectionGradient: { from: "#4c1d95", to: "#7c3aed", angle: 45 },
    sectionText: "#ffffff",
    titleFont: "Calibri",
    bodyFont: "Calibri",
    decor: (k) => k === "content" ? [shape({ x: 0, y: 0, w: 14, h: SLIDE_H, fill: "#8b5cf6" })] : [shape({ x: 0, y: 0, w: 40, h: SLIDE_H, fill: "#8b5cf6" })],
  }),
  plain: theme({
    key: "plain",
    label: { de: "Schlicht", en: "Plain" },
    bg: "#ffffff",
    title: "#000000",
    text: "#262626",
    accent: "#000000",
    accent2: "#bfbfbf",
    sectionBg: "#f2f2f2",
    sectionText: "#000000",
    titleFont: "Arial",
    bodyFont: "Arial",
  }),
  technologie: theme({
    key: "technologie",
    label: { de: "Technologie", en: "Technology" },
    bg: "#0b1a2f",
    bgGradient: { from: "#0b1a2f", to: "#12355b", angle: 45 },
    title: "#e6f6ff",
    text: "#d7e3ee",
    accent: "#22d3ee",
    accent2: "#155e75",
    sectionBg: "#06111f",
    sectionGradient: { from: "#06111f", to: "#0e7490", angle: 45 },
    sectionText: "#ffffff",
    titleFont: "Arial",
    bodyFont: "Arial",
    decor: (k) => {
      const nodes = (x0: number, y0: number, n: number) => {
        const out: SlideElement[] = [];
        for (let i = 0; i < n; i++) {
          out.push(shape({ shape: "line", x: x0 + i * 46, y: y0 + 12, w: 40, h: 2, stroke: "#22d3ee", strokeWidth: 1.5 }));
          out.push(shape({ x: x0 + i * 46 - 4, y: y0 + 8, w: 10, h: 10, fill: "#22d3ee" }));
        }
        return out;
      };
      return k === "content"
        ? [...nodes(700, 500, 5), shape({ x: 0, y: 0, w: SLIDE_W, h: 4, fill: "#22d3ee" })]
        : [...nodes(60, 480, 8), ...nodes(60, 30, 6), shape({ shape: "hexagon", x: 770, y: 30, w: 160, h: 140, stroke: "#22d3ee", strokeWidth: 2 })];
    },
  }),
  soziales: theme({
    key: "soziales",
    label: { de: "Soziales", en: "Social" },
    bg: "#fff6f2",
    title: "#9a3412",
    text: "#3b2a1a",
    accent: "#f97362",
    accent2: "#fdba9d",
    sectionBg: "#f97362",
    sectionGradient: { from: "#f97362", to: "#fb923c", angle: 45 },
    sectionText: "#ffffff",
    titleFont: "Calibri",
    bodyFont: "Calibri",
    decor: (k) =>
      k === "content"
        ? [shape({ shape: "ellipse", x: 890, y: 480, w: 90, h: 90, fill: "#fdba9d" }), shape({ shape: "ellipse", x: 850, y: 500, w: 60, h: 60, fill: "#f97362" })]
        : [
          shape({ shape: "ellipse", x: -70, y: -90, w: 260, h: 260, fill: "#fdba9d" }),
          shape({ shape: "ellipse", x: 100, y: -60, w: 170, h: 170, fill: "#f97362" }),
          shape({ shape: "ellipse", x: 780, y: 420, w: 240, h: 240, fill: "#fde5d8" }),
          shape({ shape: "ellipse", x: 870, y: 470, w: 130, h: 130, fill: "#fdba9d" }),
        ],
  }),
  spiel: theme({
    key: "spiel",
    label: { de: "Spiel", en: "Games" },
    bg: "#1a103d",
    bgGradient: { from: "#1a103d", to: "#3b1d6b", angle: 45 },
    title: "#fde047",
    text: "#f3e8ff",
    accent: "#f472b6",
    accent2: "#facc15",
    sectionBg: "#3b1d6b",
    sectionGradient: { from: "#3b1d6b", to: "#7e22ce", angle: 45 },
    sectionText: "#fde047",
    titleFont: "Verdana",
    bodyFont: "Verdana",
    decor: (k) =>
      k === "content"
        ? [shape({ shape: "star5", x: 890, y: 470, w: 50, h: 50, fill: "#facc15" }), shape({ shape: "diamond", x: 850, y: 495, w: 30, h: 30, fill: "#f472b6" })]
        : [
          shape({ shape: "star5", x: 780, y: 40, w: 120, h: 120, fill: "#facc15" }),
          shape({ shape: "triangle", x: 50, y: 40, w: 100, h: 90, rotation: 15, fill: "#f472b6" }),
          shape({ shape: "diamond", x: 870, y: 450, w: 70, h: 70, fill: "#22d3ee" }),
          shape({ shape: "ellipse", x: 60, y: 470, w: 50, h: 50, fill: "#4ade80" }),
        ],
  }),
  sport: theme({
    key: "sport",
    label: { de: "Sport", en: "Sports" },
    bg: "#ffffff",
    title: "#111111",
    text: "#262626",
    accent: "#dc2626",
    accent2: "#111111",
    sectionBg: "#111111",
    sectionText: "#ffffff",
    titleFont: "Arial",
    bodyFont: "Arial",
    decor: (k) =>
      k === "content"
        ? [shape({ x: 0, y: 0, w: SLIDE_W, h: 12, fill: "#dc2626" }), shape({ x: 0, y: 12, w: SLIDE_W, h: 4, fill: "#111111" })]
        : [
          shape({ x: 885, y: -100, w: 64, h: 760, rotation: 20, fill: "#dc2626" }),
          shape({ x: 953, y: -100, w: 30, h: 760, rotation: 20, fill: "#111111" }),
        ],
  }),
  gesellschaft: theme({
    key: "gesellschaft",
    label: { de: "Gesellschaft", en: "Society" },
    bg: "#f8fafc",
    title: "#134e4a",
    text: "#1f2937",
    accent: "#0f766e",
    accent2: "#99f6e4",
    sectionBg: "#134e4a",
    sectionGradient: { from: "#134e4a", to: "#0f766e", angle: 45 },
    sectionText: "#ffffff",
    titleFont: "Calibri",
    bodyFont: "Calibri",
    decor: (k) =>
      k === "content"
        ? [shape({ x: 0, y: 526, w: SLIDE_W, h: 14, fill: "#99f6e4" })]
        : [
          shape({ x: 0, y: 486, w: SLIDE_W, h: 16, fill: "#99f6e4" }),
          shape({ x: 0, y: 502, w: SLIDE_W, h: 18, fill: "#5eead4" }),
          shape({ x: 0, y: 520, w: SLIDE_W, h: 20, fill: "#0f766e" }),
        ],
  }),
  kunst: theme({
    key: "kunst",
    label: { de: "Kunst", en: "Art" },
    bg: "#fffdf7",
    title: "#1f2937",
    text: "#374151",
    accent: "#db2777",
    accent2: "#fbbf24",
    sectionBg: "#fffdf7",
    sectionText: "#1f2937",
    titleFont: "Georgia",
    bodyFont: "Calibri",
    decor: (k) =>
      k === "content"
        ? [
          shape({ shape: "ellipse", x: 900, y: 470, w: 70, h: 70, fill: "#fbbf24" }),
          shape({ shape: "ellipse", x: 870, y: 500, w: 50, h: 50, fill: "#db2777" }),
        ]
        : [
          shape({ shape: "ellipse", x: 700, y: -110, w: 240, h: 240, fill: "#fbbf24" }),
          shape({ shape: "ellipse", x: 850, y: -20, w: 180, h: 180, fill: "#db2777" }),
          shape({ shape: "ellipse", x: 790, y: 90, w: 110, h: 110, fill: "#3b82f6" }),
          shape({ shape: "ellipse", x: -60, y: -60, w: 200, h: 200, fill: "#a3e635" }),
          shape({ shape: "ellipse", x: 40, y: 470, w: 80, h: 80, fill: "#db2777" }),
        ],
  }),
  literatur: theme({
    key: "literatur",
    label: { de: "Literatur", en: "Literature" },
    bg: "#f7f1e3",
    title: "#3f2a14",
    text: "#3b3225",
    accent: "#7c2d12",
    accent2: "#c9a97a",
    sectionBg: "#3f2a14",
    sectionText: "#f7f1e3",
    titleFont: "Georgia",
    bodyFont: "Georgia",
    decor: (k) =>
      k === "section"
        ? [shape({ x: 40, y: 40, w: SLIDE_W - 80, h: SLIDE_H - 80, stroke: "#c9a97a", strokeWidth: 1.5 })]
        : [
          shape({ x: 24, y: 24, w: SLIDE_W - 48, h: SLIDE_H - 48, stroke: "#c9a97a", strokeWidth: 1.5 }),
          shape({ x: 32, y: 32, w: SLIDE_W - 64, h: SLIDE_H - 64, stroke: "#c9a97a", strokeWidth: 0.75 }),
        ],
  }),
  wissenschaft: theme({
    key: "wissenschaft",
    label: { de: "Wissenschaft", en: "Science" },
    bg: "#ffffff",
    bgGradient: { from: "#ffffff", to: "#eaf2ff", angle: 90 },
    title: "#1e3a8a",
    text: "#1f2937",
    accent: "#2563eb",
    accent2: "#bfdbfe",
    sectionBg: "#1e3a8a",
    sectionGradient: { from: "#1e3a8a", to: "#2563eb", angle: 45 },
    sectionText: "#ffffff",
    titleFont: "Calibri",
    bodyFont: "Calibri",
    decor: (k) => {
      const hex = (x: number, y: number, w: number, fill?: string) =>
        shape({ shape: "hexagon", x, y, w, h: w * 0.87, ...(fill ? { fill } : { stroke: "#2563eb", strokeWidth: 1.5 }) });
      return k === "content"
        ? [hex(880, 470, 60), hex(925, 500, 40, "#bfdbfe")]
        : [hex(720, 20, 120), hex(810, 80, 120, "#bfdbfe"), hex(650, 100, 90), hex(40, 460, 70, "#bfdbfe"), hex(100, 490, 55)];
    },
  }),
  geschichte: theme({
    key: "geschichte",
    label: { de: "Geschichte", en: "History" },
    bg: "#efe4cf",
    bgGradient: { from: "#f4ecdc", to: "#e2cfae", angle: 90 },
    title: "#4a2c0f",
    text: "#3b2a1a",
    accent: "#8b5a2b",
    accent2: "#c9a97a",
    sectionBg: "#4a2c0f",
    sectionText: "#f4ecdc",
    titleFont: "Georgia",
    bodyFont: "Georgia",
    decor: (k) =>
      k === "content"
        ? [shape({ x: 60, y: 512, w: SLIDE_W - 120, h: 2, fill: "#8b5a2b" })]
        : [shape({ x: 0, y: 500, w: SLIDE_W, h: 40, fill: "#8b5a2b" }), shape({ x: 0, y: 492, w: SLIDE_W, h: 4, fill: "#c9a97a" })],
  }),
  musik: theme({
    key: "musik",
    label: { de: "Musik", en: "Music" },
    bg: "#111827",
    bgGradient: { from: "#111827", to: "#312e81", angle: 60 },
    title: "#fbbf24",
    text: "#e5e7eb",
    accent: "#f59e0b",
    accent2: "#6366f1",
    sectionBg: "#312e81",
    sectionText: "#fbbf24",
    titleFont: "Verdana",
    bodyFont: "Calibri",
    decor: (k) => {
      const bars = (x0: number, y0: number, heights: number[], w: number) =>
        heights.map((h, i) => shape({ x: x0 + i * (w + 6), y: y0 - h, w, h, fill: i % 2 ? "#6366f1" : "#f59e0b" }));
      return k === "content" ? bars(840, 530, [20, 40, 28, 48, 24], 14) : bars(690, 528, [40, 80, 55, 100, 45, 90, 65, 110], 26);
    },
  }),
};

export const DEFAULT_THEME = "blue";

export function themeOf(key: string | undefined): Theme {
  return THEMES[(key ?? "").toLowerCase()] ?? THEMES[DEFAULT_THEME];
}

/* ------------------------------------------------------------ inline text */

/** `**bold**` and `*italic*` inside a line, nothing else. */
function inlineRuns(line: string, base: Partial<Run>): Run[] {
  const runs: Run[] = [];
  const rx = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(line))) {
    if (m.index > last) runs.push({ ...base, text: line.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ ...base, text: m[1], bold: true });
    else runs.push({ ...base, text: m[2], italic: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) runs.push({ ...base, text: line.slice(last) });
  return runs.length ? runs : [{ ...base, text: "" }];
}

function bulletParagraphs(lines: string[], base: Partial<Run>): Paragraph[] {
  return lines.map((raw) => {
    const level = /^\s{2,}/.test(raw) ? 1 : 0;
    const line = raw.trim().replace(/^[-*•]\s+/, "");
    return {
      runs: inlineRuns(line, { ...base, size: level ? (base.size ?? 26) - 4 : base.size }),
      bullet: true,
      ...(level ? { level } : {}),
    };
  });
}

function textParagraphsOf(text: string, base: Partial<Run>): Paragraph[] {
  return text.replace(/\r/g, "").split(/\n{2,}|\n/).filter((p, i, a) => p.trim() || i < a.length - 1)
    .map((p) => ({ runs: inlineRuns(p.trim(), base) }));
}

/**
 * Point size that gets a list onto the slide without a scrollbar.
 *
 * PowerPoint's own body text is 28 points; anything much smaller leaves the
 * lower half of a widescreen slide empty and reads like a document. So the
 * base is generous and only comes down when the list is long.
 */
function fitSize(lines: number, base: number): number {
  if (lines <= 4) return base;
  if (lines <= 6) return base - 2;
  if (lines <= 8) return base - 5;
  if (lines <= 11) return base - 8;
  return base - 10;
}

/* --------------------------------------------------------------- images */

/** Pixel size out of a PNG, JPEG, GIF or WebP data: URL, without decoding it. */
export function imageSize(dataUrl: string): { w: number; h: number } | null {
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/s);
  if (!m) return null;
  let bin: string;
  try {
    bin = atob(m[2].slice(0, 4096)); // headers live at the front
  } catch {
    return null;
  }
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const dv = new DataView(b.buffer);
  if (b[0] === 0x89 && b[1] === 0x50 && b.length >= 24) {
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b.length >= 10) {
    return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
      }
      i += 2 + dv.getUint16(i + 2);
    }
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b.length >= 30) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    if (fourcc === "VP8L") {
      const bits = dv.getUint32(21, true);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === "VP8X") {
      return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
  }
  return null;
}

/** A picture fitted into a slot, keeping its proportions and centred. */
function fitImage(src: string, slot: { x: number; y: number; w: number; h: number }): SlideElement {
  const size = imageSize(src) ?? { w: 4, h: 3 };
  const scale = Math.min(slot.w / size.w, slot.h / size.h);
  const w = Math.round(size.w * scale);
  const h = Math.round(size.h * scale);
  return {
    kind: "image",
    id: newElementId(),
    x: Math.round(slot.x + (slot.w - w) / 2),
    y: Math.round(slot.y + (slot.h - h) / 2),
    w,
    h,
    src,
  };
}

/* ---------------------------------------------------------------- build */

export interface BuiltSlide {
  slide: Slide;
  /** An image reference that could not be resolved, if any. */
  missingImage?: string;
}

/** The layout a spec means when it does not say. */
function inferLayout(spec: SlideSpec, src: string | null, first: boolean): SlideLayout {
  const hasBullets = !!spec.bullets?.length;
  const hasText = !!spec.text?.trim();
  return spec.quote
    ? "quote"
    : spec.left !== undefined || spec.right !== undefined
    ? "two-columns"
    : src && (hasBullets || hasText)
    ? "image-right"
    : src
    ? "image-full"
    : hasBullets
    ? "bullets"
    : hasText
    ? "text"
    : first
    ? "title"
    : spec.title
    ? "section"
    : "blank";
}

/**
 * One slide out of one spec.
 *
 * `resolveImage` turns an id from the conversation into a data: URL; when it
 * cannot, the slide is built without the picture and the reference is
 * reported, so the assistant can generate one and try again.
 */
export function buildSlide(
  spec: SlideSpec,
  theme: Theme,
  resolveImage: (ref: string) => string | null,
  opts: { first?: boolean } = {},
): BuiltSlide {
  const t = theme;
  const els: SlideElement[] = [];
  let missingImage: string | undefined;

  let src: string | null = null;
  if (spec.image) {
    src = spec.image.startsWith("data:") ? spec.image : resolveImage(spec.image);
    if (!src) missingImage = spec.image;
  }

  const hasBullets = !!spec.bullets?.length;
  const hasText = !!spec.text?.trim();
  const layout = spec.layout ?? inferLayout(spec, src, !!opts.first);
  const kind = layout === "title" ? "title" : layout === "section" ? "section" : "content";

  const isSection = layout === "section";
  const background = spec.background ?? (isSection ? t.sectionBg : t.bg);
  const gradient = spec.background ? undefined : isSection ? t.sectionGradient : t.bgGradient;
  const titleColor = isSection ? t.sectionText : t.title;
  const textColor = isSection ? t.sectionText : t.text;
  const base: Partial<Run> = { font: t.bodyFont, color: textColor };
  const titleBase: Partial<Run> = { font: t.titleFont, color: titleColor };

  // Decoration first, so it lies behind everything else.
  if (!spec.background) els.push(...t.decor(kind));

  const text = (
    box: { x: number; y: number; w: number; h: number },
    paragraphs: Paragraph[],
    extra: Partial<TextElement> = {},
  ) => {
    els.push({ kind: "text", id: newElementId(), ...box, paragraphs, ...extra } as TextElement);
  };
  const rule = (x: number, y: number, w: number) =>
    els.push({ kind: "shape", id: newElementId(), x, y, w, h: 5, shape: "rect", fill: t.accent, decor: true });

  const heading = (title: string) => {
    // One line, always: a heading that wraps lands on the body text.
    const n = title.replace(/\*/g, "").length;
    const size = n > 44 ? 26 : n > 34 ? 30 : n > 26 ? 33 : 36;
    text({ x: 60, y: 34, w: 840, h: 92 }, [{
      runs: inlineRuns(title, { ...titleBase, size, bold: true }),
    }], { valign: "middle", placeholder: "title" });
    rule(60, 130, 120);
  };
  const BODY = { x: 60, y: 150, w: 840, h: 350 };

  const bullets = (lines: string[], box: { x: number; y: number; w: number; h: number }, size = 26) =>
    text(box, bulletParagraphs(lines, { ...base, size: fitSize(lines.length, size) }), { placeholder: "body" });
  const running = (body: string, box: { x: number; y: number; w: number; h: number }, size = 24) => {
    const ps = textParagraphsOf(body, { ...base, size: fitSize(body.split(/\n/).length + Math.floor(body.length / 180), size) });
    text(box, ps, { placeholder: "body" });
  };
  const column = (content: string[] | string | undefined, box: { x: number; y: number; w: number; h: number }) => {
    if (Array.isArray(content)) bullets(content, box, 22);
    else if (content) running(content, box, 20);
    else text(box, [{ runs: [{ ...base, size: 22, text: "" }], bullet: true }], { placeholder: "body" });
  };

  switch (layout) {
    case "title": {
      const long = (spec.title ?? "").length > 34;
      text({ x: 60, y: 205, w: 840, h: 140 }, [{
        runs: inlineRuns(spec.title ?? "", { ...titleBase, size: long ? 40 : 48, bold: true }),
        align: "center",
      }], { valign: "middle", placeholder: "title" });
      rule(400, 352, 160);
      if (spec.subtitle) {
        text({ x: 100, y: 372, w: 760, h: 100 }, [{
          runs: inlineRuns(spec.subtitle, { ...base, size: 26 }),
          align: "center",
        }], { valign: "top", placeholder: "subtitle" });
      }
      break;
    }
    case "section": {
      const long = (spec.title ?? "").length > 34;
      text({ x: 60, y: 165, w: 840, h: 150 }, [{
        runs: inlineRuns(spec.title ?? "", { ...titleBase, size: long ? 38 : 44, bold: true }),
        align: "center",
      }], { valign: "middle", placeholder: "title" });
      els.push({ kind: "shape", id: newElementId(), x: 400, y: 322, w: 160, h: 5, shape: "rect", fill: t.accent, decor: true });
      if (spec.subtitle ?? spec.text) {
        text({ x: 100, y: 342, w: 760, h: 130 }, textParagraphsOf(spec.subtitle ?? spec.text ?? "", { ...base, size: 24 })
          .map((p) => ({ ...p, align: "center" as const })), { placeholder: "subtitle" });
      }
      break;
    }
    case "bullets": {
      heading(spec.title ?? "");
      bullets(spec.bullets ?? (spec.text ? spec.text.split("\n") : [""]), BODY);
      break;
    }
    case "text": {
      heading(spec.title ?? "");
      running(spec.text ?? (spec.bullets ?? [""]).join("\n"), BODY);
      break;
    }
    case "image-right":
    case "image-left": {
      heading(spec.title ?? "");
      const right = layout === "image-right";
      const textBox = { x: right ? 60 : 490, y: 150, w: 420, h: 350 };
      const imgSlot = { x: right ? 510 : 60, y: 150, w: 390, h: 350 };
      if (hasBullets) bullets(spec.bullets!, textBox, 24);
      else if (hasText) running(spec.text!, textBox, 22);
      else bullets([""], textBox, 24);
      if (src) {
        const img = fitImage(src, spec.caption ? { ...imgSlot, h: imgSlot.h - 40 } : imgSlot);
        els.push(img);
        if (spec.caption) {
          text({ x: imgSlot.x, y: img.y + img.h + 6, w: imgSlot.w, h: 36 }, [{
            runs: inlineRuns(spec.caption, { ...base, size: 14, italic: true }),
            align: "center",
          }], { placeholder: "caption" });
        }
      } else {
        // No picture yet: a frame shows where one belongs.
        els.push({ kind: "shape", id: newElementId(), ...imgSlot, shape: "rect", stroke: t.accent2, strokeWidth: 1.5, paragraphs: [{ runs: [{ ...base, size: 14, text: "🖼" }], align: "center" }], valign: "middle" });
      }
      break;
    }
    case "image-full": {
      const withTitle = !!spec.title;
      if (withTitle) heading(spec.title!);
      const slot = withTitle ? { x: 60, y: 146, w: 840, h: spec.caption ? 316 : 354 } : { x: 40, y: 30, w: 880, h: spec.caption ? 436 : 480 };
      if (src) {
        const img = fitImage(src, slot);
        els.push(img);
        if (spec.caption) {
          text({ x: 60, y: img.y + img.h + 8, w: 840, h: 40 }, [{
            runs: inlineRuns(spec.caption, { ...base, size: 16, italic: true }),
            align: "center",
          }], { placeholder: "caption" });
        }
      } else if (spec.text || spec.bullets) {
        if (spec.bullets) bullets(spec.bullets, BODY);
        else running(spec.text!, BODY);
      } else {
        els.push({ kind: "shape", id: newElementId(), ...slot, shape: "rect", stroke: t.accent2, strokeWidth: 1.5, paragraphs: [{ runs: [{ ...base, size: 14, text: "🖼" }], align: "center" }], valign: "middle" });
        if (spec.caption) {
          text({ x: 60, y: slot.y + slot.h + 8, w: 840, h: 40 }, [{ runs: inlineRuns(spec.caption, { ...base, size: 16, italic: true }), align: "center" }], { placeholder: "caption" });
        }
      }
      break;
    }
    case "two-columns": {
      heading(spec.title ?? "");
      const titled = !!(spec.leftTitle || spec.rightTitle);
      const top = titled ? 206 : 150;
      // A thin divider between the columns, in the accent colour.
      els.push({ kind: "shape", id: newElementId(), x: 479, y: 150, w: 2, h: 340, shape: "rect", fill: t.accent2, decor: true });
      if (spec.leftTitle) {
        text({ x: 60, y: 148, w: 400, h: 50 }, [{ runs: inlineRuns(spec.leftTitle, { ...base, size: 24, bold: true, color: t.accent }) }], { valign: "middle", placeholder: "columnTitle" });
      }
      if (spec.rightTitle) {
        text({ x: 500, y: 148, w: 400, h: 50 }, [{ runs: inlineRuns(spec.rightTitle, { ...base, size: 24, bold: true, color: t.accent }) }], { valign: "middle", placeholder: "columnTitle" });
      }
      column(spec.left, { x: 60, y: top, w: 400, h: 500 - top });
      column(spec.right, { x: 500, y: top, w: 400, h: 500 - top });
      break;
    }
    case "quote": {
      if (spec.title) heading(spec.title);
      const q = spec.quote ?? spec.text ?? "";
      // A large opening quotation mark in the accent colour sets the tone;
      // the quote itself sits large and centred, the author beneath it.
      els.push({
        kind: "text",
        id: newElementId(),
        x: 50,
        y: spec.title ? 120 : 40,
        w: 220,
        h: 220,
        paragraphs: [{ runs: [{ text: "\u201c", size: 140, bold: true, color: t.accent2, font: "Georgia" }] }],
        decor: true,
      } as TextElement);
      text({ x: 110, y: spec.title ? 170 : 130, w: 740, h: 250 }, [{
        runs: inlineRuns(q, { ...titleBase, size: q.length > 160 ? 26 : q.length > 90 ? 30 : 34, italic: true }),
        align: "center",
      }], { valign: "middle", placeholder: "quote" });
      if (spec.author) {
        els.push({ kind: "shape", id: newElementId(), x: 430, y: 428, w: 100, h: 3, shape: "rect", fill: t.accent, decor: true });
        text({ x: 110, y: 438, w: 740, h: 50 }, [{
          runs: inlineRuns(spec.author, { ...base, size: 20 }),
          align: "center",
        }], { placeholder: "author" });
      }
      break;
    }
    case "blank":
      break;
  }

  const slide: Slide = {
    id: newSlideId(),
    layout,
    ...(gradient ? { gradient } : background && background !== "#ffffff" ? { background } : {}),
    elements: els,
    ...(spec.notes?.trim() ? { notes: spec.notes.trim() } : {}),
  };
  return { slide, ...(missingImage ? { missingImage } : {}) };
}

/** A whole deck out of a list of specs. */
export function buildDeck(
  specs: SlideSpec[],
  themeKey: string | undefined,
  resolveImage: (ref: string) => string | null,
): { deck: Deck; missingImages: string[] } {
  const theme = themeOf(themeKey);
  const missingImages: string[] = [];
  const slides: Slide[] = specs.map((spec, i) => {
    const built = buildSlide(spec, theme, resolveImage, { first: i === 0 });
    if (built.missingImage) missingImages.push(built.missingImage);
    return built.slide;
  });
  return { deck: { slides, theme: theme.key }, missingImages };
}

/* ------------------------------------------------- back from a slide */

/**
 * The content of a slide, as a spec.
 *
 * What a change of layout or design needs: the words and the picture, not
 * the boxes they were in. Elements carry the role they were built for; on
 * an imported slide the title and body placeholders from PowerPoint fill
 * the same roles, and the rest is guessed from position.
 */
export function slideToSpec(slide: Slide): SlideSpec {
  const texts = slide.elements.filter((e): e is TextElement => e.kind === "text");
  const byRole = (role: string) => texts.filter((e) => e.placeholder === role);
  const plain = (e: TextElement | undefined) => (e ? paragraphsText(e.paragraphs).trim() : "");
  const linesOf = (e: TextElement): string[] =>
    e.paragraphs.map((p) => (p.level ? "  " : "") + p.runs.map((r) => (r.bold ? `**${r.text}**` : r.text)).join("")).filter((l) => l.trim());

  const spec: SlideSpec = {};
  const title = byRole("title")[0];
  if (title) spec.title = plain(title);
  const subtitle = byRole("subtitle")[0];
  if (subtitle) spec.subtitle = plain(subtitle);
  const bodies = byRole("body").sort((a, b) => a.x - b.x);
  const colTitles = byRole("columnTitle").sort((a, b) => a.x - b.x);
  const quote = byRole("quote")[0];
  if (quote) spec.quote = plain(quote).replace(/^[„"“]/, "").replace(/[“"”]$/, "");
  const author = byRole("author")[0];
  if (author) spec.author = plain(author).replace(/^[—–-]\s*/, "");
  const caption = byRole("caption")[0];
  if (caption) spec.caption = plain(caption);

  const asContent = (e: TextElement): string[] | string =>
    e.paragraphs.some((p) => p.bullet || p.numbered) ? linesOf(e) : plain(e);

  if (bodies.length >= 2) {
    spec.left = asContent(bodies[0]);
    spec.right = asContent(bodies[1]);
    if (colTitles[0]) spec.leftTitle = plain(colTitles[0]);
    if (colTitles[1]) spec.rightTitle = plain(colTitles[1]);
  } else if (bodies.length === 1) {
    const c = asContent(bodies[0]);
    if (Array.isArray(c)) spec.bullets = c;
    else spec.text = c;
  } else {
    // Free text boxes without a role - the largest one is the body.
    const loose = texts.filter((e) => !e.placeholder).sort((a, b) => b.w * b.h - a.w * a.h);
    if (loose[0] && plain(loose[0])) {
      const c = asContent(loose[0]);
      if (Array.isArray(c)) spec.bullets = c;
      else spec.text = c;
    }
  }
  const img = slide.elements.find((e) => e.kind === "image");
  if (img && img.kind === "image") spec.image = img.src;
  if (slide.notes) spec.notes = slide.notes;
  const known = LAYOUTS.some((l) => l.key === slide.layout);
  if (known) spec.layout = slide.layout as SlideLayout;
  return spec;
}

/** The same slide in another layout, with its content and its id. */
export function relayoutSlide(slide: Slide, layout: SlideLayout, theme: Theme, lang = "de"): Slide {
  const spec = { ...slideToSpec(slide), layout };
  // A layout that needs content the slide does not have gets placeholders.
  const fresh = newSlideSpec(layout, lang);
  for (const k of Object.keys(fresh) as (keyof SlideSpec)[]) {
    if (spec[k] === undefined && k !== "layout") (spec as Record<string, unknown>)[k] = fresh[k];
  }
  const built = buildSlide(spec, theme, () => null).slide;
  return { ...built, id: slide.id };
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const m = hex.replace("#", "");
  if (m.length < 6) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How far a colour is from grey, 0 (grey) to 1 (pure hue). */
function chroma(hex: string): number {
  const m = hex.replace("#", "");
  if (m.length < 6) return 0;
  const v = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  return Math.max(...v) - Math.min(...v);
}

/**
 * Whether text of one colour would vanish on a ground of the other - both
 * dark or both light. A saturated colour is someone's choice and stays: red
 * on navy is legible, and it was meant to be red.
 */
function sameSide(text: string, ground: string): boolean {
  if (chroma(text) > 0.25) return false;
  const a = luminance(text), b = luminance(ground);
  return (a < 0.4 && b < 0.4) || (a > 0.6 && b > 0.6);
}

/**
 * The deck in another design.
 *
 * Slides built by a layout are rebuilt from their content, so the new
 * colours, fonts and decorations apply throughout. Slides that came from a
 * file or were laid out by hand keep their boxes where they are; they get
 * the background, the decoration and the title colour, nothing more.
 */
export function applyTheme(deck: Deck, themeKey: string): Deck {
  const t = themeOf(themeKey);
  // The design the deck had until now. Shapes in its colours - a band in
  // its section colour, a rule in its accent - are its decoration even when
  // a file written before the marks existed does not say so.
  const old = deck.theme ? THEMES[deck.theme] : undefined;
  const oldColors = old ? new Set([old.accent, old.accent2, old.sectionBg, old.sectionGradient?.from].filter(Boolean)) : new Set<string>();
  const isOldDecor = (e: SlideElement) =>
    e.kind === "shape" && !paragraphsText(e.paragraphs).trim() &&
    ((e.fill && oldColors.has(e.fill)) || (!e.fill && e.stroke && oldColors.has(e.stroke)));
  const slides = deck.slides.map((s, i) => {
    if (LAYOUTS.some((l) => l.key === s.layout) && s.layout !== "blank") {
      const built = buildSlide(slideToSpec(s), t, () => null, { first: i === 0 }).slide;
      return { ...built, id: s.id, ...(s.audio ? { audio: s.audio } : {}) };
    }
    // No layout yet: the first slide becomes the title slide, every other
    // one gets a heading with its content beneath - so the design shows at
    // once, with whatever words and pictures the slide already had.
    const hasContent = s.elements.some((e) => e.kind === "image" || (e.kind === "text" && paragraphsText(e.paragraphs).trim()));
    if (!hasContent || !s.elements.some((e) => e.kind === "shape" && !e.decor && !isOldDecor(e))) {
      const spec = slideToSpec(s);
      const layout: SlideLayout = i === 0 ? "title" : spec.image ? "image-right" : spec.text && !spec.bullets ? "text" : "bullets";
      const fresh = newSlideSpec(layout, "de");
      for (const k of Object.keys(fresh) as (keyof SlideSpec)[]) {
        if (spec[k] === undefined) (spec as Record<string, unknown>)[k] = fresh[k];
      }
      const built = buildSlide({ ...spec, layout }, t, () => null, { first: i === 0 }).slide;
      return { ...built, id: s.id, ...(s.audio ? { audio: s.audio } : {}) };
    }
    const bgColor = t.bgGradient?.from ?? t.bg;
    const kept = s.elements.filter((e) => !e.decor && !isOldDecor(e)).map((e) => {
      if (e.kind === "text" && e.placeholder === "title") {
        return { ...e, paragraphs: e.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, color: t.title, font: t.titleFont })) })) };
      }
      if (e.kind === "text") {
        // Text that would vanish on the new background - dark on dark, light
        // on light - takes the design's text colour. Anything else keeps
        // the colour someone chose for it.
        return {
          ...e,
          paragraphs: e.paragraphs.map((p) => ({
            ...p,
            runs: p.runs.map((r) => sameSide(r.color ?? "#262626", bgColor) ? { ...r, color: t.text } : r),
          })),
        };
      }
      return e;
    });
    const { background: _b, gradient: _g, ...rest } = s;
    return {
      ...rest,
      ...(t.bgGradient ? { gradient: t.bgGradient } : t.bg !== "#ffffff" ? { background: t.bg } : {}),
      elements: [...t.decor("content"), ...kept],
    };
  });
  return { ...deck, theme: t.key, slides };
}

export { SLIDE_H, SLIDE_W };
