/**
 * @file slideLayouts.ts
 * @description Turns what the assistant says about a slide into the slide.
 *
 *              The assistant thinks in content: a title, some bullet points,
 *              a picture, a note for the speaker. It should not have to think
 *              in pixels, and a model asked for coordinates produces boxes
 *              that overlap. So it names a layout and fills in the words, and
 *              this module places everything on a 960 x 540 canvas in a way
 *              that looks like someone meant it.
 *
 *              A handful of themes give the deck one consistent look; the
 *              blank default is a white slide with a dark title and a
 *              coloured rule beneath it.
 */

import {
  type Deck,
  newElementId,
  newSlideId,
  type Paragraph,
  type Run,
  type Slide,
  SLIDE_H,
  SLIDE_W,
  type SlideElement,
} from "./pptx.ts";

/** What the assistant may say about one slide. */
export interface SlideSpec {
  layout?:
    | "title"
    | "section"
    | "bullets"
    | "text"
    | "image-right"
    | "image-left"
    | "image-full"
    | "two-columns"
    | "quote";
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

export interface Theme {
  key: string;
  bg: string;
  title: string;
  text: string;
  accent: string;
  sectionBg: string;
  sectionText: string;
  font: string;
}

export const THEMES: Record<string, Theme> = {
  blue: {
    key: "blue",
    bg: "#ffffff",
    title: "#1f3864",
    text: "#262626",
    accent: "#2e75b6",
    sectionBg: "#1f3864",
    sectionText: "#ffffff",
    font: "Calibri",
  },
  green: {
    key: "green",
    bg: "#ffffff",
    title: "#1e4d2b",
    text: "#262626",
    accent: "#3a9d5d",
    sectionBg: "#1e4d2b",
    sectionText: "#ffffff",
    font: "Calibri",
  },
  warm: {
    key: "warm",
    bg: "#fffaf3",
    title: "#7a3e00",
    text: "#3b2a1a",
    accent: "#e07b00",
    sectionBg: "#c2410c",
    sectionText: "#fff7ed",
    font: "Georgia",
  },
  dark: {
    key: "dark",
    bg: "#1e1e2e",
    title: "#f5f5f5",
    text: "#e6e6e6",
    accent: "#7c9cff",
    sectionBg: "#11111b",
    sectionText: "#ffffff",
    font: "Calibri",
  },
  purple: {
    key: "purple",
    bg: "#ffffff",
    title: "#4c1d95",
    text: "#262626",
    accent: "#8b5cf6",
    sectionBg: "#4c1d95",
    sectionText: "#ffffff",
    font: "Calibri",
  },
  plain: {
    key: "plain",
    bg: "#ffffff",
    title: "#000000",
    text: "#262626",
    accent: "#000000",
    sectionBg: "#f2f2f2",
    sectionText: "#000000",
    font: "Arial",
  },
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
      runs: inlineRuns(line, { ...base, size: level ? (base.size ?? 20) - 2 : base.size }),
      bullet: true,
      ...(level ? { level } : {}),
    };
  });
}

function textParagraphsOf(text: string, base: Partial<Run>): Paragraph[] {
  return text.replace(/\r/g, "").split(/\n{2,}|\n/).filter((p, i, a) => p.trim() || i < a.length - 1)
    .map((p) => ({ runs: inlineRuns(p.trim(), base) }));
}

/** Point size that gets a list onto the slide without a scrollbar. */
function fitSize(lines: number, base: number): number {
  if (lines <= 4) return base;
  if (lines <= 6) return base - 2;
  if (lines <= 8) return base - 4;
  if (lines <= 11) return base - 6;
  return base - 8;
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
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b.length >= 24) {
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b.length >= 10) {
    return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  }
  // JPEG: walk the markers to the first SOF
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
  // WebP (VP8 / VP8L / VP8X)
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
  const layout = spec.layout ??
    (spec.quote
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
      : opts.first
      ? "title"
      : "section");

  const isSection = layout === "title" || layout === "section";
  const background = spec.background ?? (layout === "section" ? t.sectionBg : t.bg);
  const titleColor = layout === "section" ? t.sectionText : t.title;
  const textColor = layout === "section" ? t.sectionText : t.text;
  const base: Partial<Run> = { font: t.font, color: textColor };

  const text = (
    box: { x: number; y: number; w: number; h: number },
    paragraphs: Paragraph[],
    extra: Partial<Extract<SlideElement, { kind: "text" }>> = {},
  ) => {
    els.push({ kind: "text", id: newElementId(), ...box, paragraphs, ...extra });
  };
  const rule = (x: number, y: number, w: number) =>
    els.push({ kind: "shape", id: newElementId(), x, y, w, h: 5, shape: "rect", fill: t.accent });

  const heading = (title: string) => {
    text({ x: 60, y: 36, w: 840, h: 84 }, [{
      runs: inlineRuns(title, { ...base, color: titleColor, size: 32, bold: true }),
    }], { valign: "middle", placeholder: "title" });
    rule(60, 122, 110);
  };

  const bullets = (lines: string[], box: { x: number; y: number; w: number; h: number }, size = 20) =>
    text(box, bulletParagraphs(lines, { ...base, size: fitSize(lines.length, size) }), { placeholder: "body" });
  const running = (body: string, box: { x: number; y: number; w: number; h: number }, size = 20) => {
    const ps = textParagraphsOf(body, { ...base, size: fitSize(body.split(/\n/).length + Math.floor(body.length / 220), size) });
    text(box, ps, { placeholder: "body" });
  };
  const column = (content: string[] | string | undefined, box: { x: number; y: number; w: number; h: number }) => {
    if (Array.isArray(content)) bullets(content, box, 18);
    else if (content) running(content, box, 18);
  };

  switch (layout) {
    case "title": {
      if (!spec.background) {
        // A band of colour across the top third, so the opening slide is
        // not the same white as the ones after it.
        els.push({ kind: "shape", id: newElementId(), x: 0, y: 0, w: SLIDE_W, h: 200, shape: "rect", fill: t.sectionBg });
      }
      text({ x: 80, y: 215, w: 800, h: 120 }, [{
        runs: inlineRuns(spec.title ?? "", { ...base, color: t.title, size: 40, bold: true }),
        align: "center",
      }], { valign: "middle", placeholder: "title" });
      rule(400, 342, 160);
      if (spec.subtitle) {
        text({ x: 120, y: 360, w: 720, h: 90 }, [{
          runs: inlineRuns(spec.subtitle, { ...base, size: 22 }),
          align: "center",
        }], { valign: "top", placeholder: "subtitle" });
      }
      break;
    }
    case "section": {
      text({ x: 80, y: 180, w: 800, h: 130 }, [{
        runs: inlineRuns(spec.title ?? "", { ...base, color: titleColor, size: 40, bold: true }),
        align: "center",
      }], { valign: "middle", placeholder: "title" });
      els.push({ kind: "shape", id: newElementId(), x: 400, y: 318, w: 160, h: 5, shape: "rect", fill: t.accent });
      if (spec.subtitle ?? spec.text) {
        text({ x: 120, y: 336, w: 720, h: 120 }, textParagraphsOf(spec.subtitle ?? spec.text ?? "", { ...base, size: 22 })
          .map((p) => ({ ...p, align: "center" as const })), { placeholder: "subtitle" });
      }
      break;
    }
    case "bullets": {
      heading(spec.title ?? "");
      bullets(spec.bullets ?? (spec.text ? spec.text.split("\n") : []), { x: 60, y: 142, w: 840, h: 356 });
      break;
    }
    case "text": {
      heading(spec.title ?? "");
      running(spec.text ?? (spec.bullets ?? []).join("\n"), { x: 60, y: 142, w: 840, h: 356 });
      break;
    }
    case "image-right":
    case "image-left": {
      heading(spec.title ?? "");
      const right = layout === "image-right";
      const textBox = { x: right ? 60 : 500, y: 142, w: 410, h: 356 };
      const imgSlot = { x: right ? 510 : 60, y: 142, w: 390, h: 356 };
      if (hasBullets) bullets(spec.bullets!, textBox, 20);
      else if (hasText) running(spec.text!, textBox, 20);
      if (src) {
        const img = fitImage(src, spec.caption ? { ...imgSlot, h: imgSlot.h - 40 } : imgSlot);
        els.push(img);
        if (spec.caption) {
          text({ x: imgSlot.x, y: img.y + img.h + 6, w: imgSlot.w, h: 34 }, [{
            runs: inlineRuns(spec.caption, { ...base, size: 12, italic: true, color: "#6b6b6b" }),
            align: "center",
          }]);
        }
      }
      break;
    }
    case "image-full": {
      const withTitle = !!spec.title;
      if (withTitle) heading(spec.title!);
      const slot = withTitle ? { x: 60, y: 138, w: 840, h: spec.caption ? 330 : 370 } : { x: 40, y: 30, w: 880, h: spec.caption ? 440 : 480 };
      if (src) {
        const img = fitImage(src, slot);
        els.push(img);
        if (spec.caption) {
          text({ x: 60, y: img.y + img.h + 8, w: 840, h: 40 }, [{
            runs: inlineRuns(spec.caption, { ...base, size: 14, italic: true, color: "#6b6b6b" }),
            align: "center",
          }]);
        }
      } else if (spec.text || spec.bullets) {
        // No picture came: the words still have to be somewhere.
        if (spec.bullets) bullets(spec.bullets, { x: 60, y: 142, w: 840, h: 356 });
        else running(spec.text!, { x: 60, y: 142, w: 840, h: 356 });
      }
      break;
    }
    case "two-columns": {
      heading(spec.title ?? "");
      const top = spec.leftTitle || spec.rightTitle ? 190 : 142;
      if (spec.leftTitle) {
        text({ x: 60, y: 140, w: 400, h: 44 }, [{ runs: inlineRuns(spec.leftTitle, { ...base, size: 20, bold: true, color: t.accent }) }], { valign: "middle" });
      }
      if (spec.rightTitle) {
        text({ x: 500, y: 140, w: 400, h: 44 }, [{ runs: inlineRuns(spec.rightTitle, { ...base, size: 20, bold: true, color: t.accent }) }], { valign: "middle" });
      }
      column(spec.left, { x: 60, y: top, w: 400, h: 498 - top });
      column(spec.right, { x: 500, y: top, w: 400, h: 498 - top });
      break;
    }
    case "quote": {
      if (spec.title) heading(spec.title);
      const q = spec.quote ?? spec.text ?? "";
      text({ x: 100, y: spec.title ? 160 : 120, w: 760, h: 260 }, [{
        runs: inlineRuns(`„${q}“`, { ...base, size: q.length > 160 ? 22 : 28, italic: true, color: t.title }),
        align: "center",
      }], { valign: "middle" });
      if (spec.author) {
        text({ x: 100, y: 430, w: 760, h: 40 }, [{
          runs: inlineRuns(`— ${spec.author}`, { ...base, size: 16 }),
          align: "right",
        }]);
      }
      break;
    }
  }

  void isSection;
  const slide: Slide = {
    id: newSlideId(),
    ...(background && background !== "#ffffff" ? { background } : {}),
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

export { SLIDE_H, SLIDE_W };
