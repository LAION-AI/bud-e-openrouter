/**
 * @file pptx.ts
 * @description Reads and writes PowerPoint files (.pptx) for the slide editor.
 *
 *              A deck is kept as plain data: slides, and on each slide a list
 *              of elements with a position and a size on a 960 x 540 canvas
 *              (16:9 at 96 dpi - exactly PowerPoint's default 10 x 5.625
 *              inches, so nothing is rescaled on the way in or out). Three
 *              kinds of element: text boxes, pictures, and shapes that may
 *              carry text.
 *
 *              Reading takes what PowerPoint, Keynote and LibreOffice write
 *              and keeps what the editor can show: positions, text with its
 *              formatting, pictures, simple shapes, backgrounds and speaker
 *              notes. Placeholders inherit their position from the layout
 *              and the master, as they do in PowerPoint; groups are
 *              flattened; tables become text. Charts and the like turn into a
 *              labelled box rather than vanishing without a word.
 *
 *              Writing produces a file with one blank layout and its master,
 *              which is all a deck of free-standing boxes needs. Every slide
 *              is complete on its own, so what the editor shows is what
 *              PowerPoint opens.
 *
 *              No DOM: this runs under Deno for the tests as it does in the
 *              browser, so the XML is walked with a small parser of its own.
 */

import { readZip, writeZip, type ZipEntry } from "./docx.ts";

/* ================================================================ model */

/** The canvas the editor works on, in CSS pixels. */
export const SLIDE_W = 960;
export const SLIDE_H = 540;
/** English Metric Units per pixel at 96 dpi. */
export const EMU_PER_PX = 9525;

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** "#rrggbb" */
  color?: string;
  /** Points. */
  size?: number;
  font?: string;
}

export interface Paragraph {
  runs: Run[];
  align?: "left" | "center" | "right" | "justify";
  bullet?: boolean;
  numbered?: boolean;
  /** Indent level, 0 = none. */
  level?: number;
}

interface BaseElement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation?: number;
}

export interface TextElement extends BaseElement {
  kind: "text";
  paragraphs: Paragraph[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  valign?: "top" | "middle" | "bottom";
  /** Where it came from, so a title stays a title on the way back out. */
  placeholder?: "title" | "subtitle" | "body";
}

export interface ImageElement extends BaseElement {
  kind: "image";
  /** A data: URL. */
  src: string;
}

export type ShapeKind =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "rightArrow"
  | "star5"
  | "hexagon"
  | "line";

export interface ShapeElement extends BaseElement {
  kind: "shape";
  shape: ShapeKind;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  paragraphs?: Paragraph[];
  valign?: "top" | "middle" | "bottom";
}

export type SlideElement = TextElement | ImageElement | ShapeElement;

export interface Slide {
  id: string;
  /** "#rrggbb"; white when absent. */
  background?: string;
  notes?: string;
  elements: SlideElement[];
}

export interface Deck {
  slides: Slide[];
  /** Which of the layout themes built it, so added slides match. */
  theme?: string;
}

export function newElementId(): string {
  return "e" + Math.random().toString(36).slice(2, 9);
}

export function newSlideId(): string {
  return "s" + Math.random().toString(36).slice(2, 9);
}

/** Text of a paragraph list, one line per paragraph. */
export function paragraphsText(ps: Paragraph[] | undefined): string {
  return (ps ?? []).map((p) => p.runs.map((r) => r.text).join("")).join("\n");
}

/** Plain-text paragraphs, one per line, with sensible defaults. */
export function textParagraphs(
  text: string,
  opts: Partial<Omit<Paragraph, "runs">> & Partial<Omit<Run, "text">> = {},
): Paragraph[] {
  const { align, bullet, numbered, level, ...run } = opts;
  return text.split("\n").map((line) => ({
    runs: [{ text: line, ...run }],
    ...(align ? { align } : {}),
    ...(bullet ? { bullet } : {}),
    ...(numbered ? { numbered } : {}),
    ...(level ? { level } : {}),
  }));
}

/* ========================================================== small XML */

interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const TOKEN =
  /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;

const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function unesc(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A tolerant tree out of well-formed XML. Enough for OOXML. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(xml))) {
    const [, cdata, close, open, attrText, selfClose, text] = m;
    const top = stack[stack.length - 1];
    if (cdata !== undefined) {
      top.text += cdata;
    } else if (close) {
      if (stack.length > 1) stack.pop();
    } else if (open) {
      const attrs: Record<string, string> = {};
      ATTR.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ATTR.exec(attrText ?? ""))) attrs[a[1]] = unesc(a[2] ?? a[3] ?? "");
      const node: XNode = { name: open, attrs, children: [], text: "" };
      top.children.push(node);
      if (!selfClose) stack.push(node);
    } else if (text !== undefined) {
      if (text.trim() || top.name === "a:t") top.text += unesc(text);
    }
  }
  return root;
}

const child = (n: XNode | undefined, name: string): XNode | undefined =>
  n?.children.find((c) => c.name === name);
const kids = (n: XNode | undefined, name: string): XNode[] =>
  n?.children.filter((c) => c.name === name) ?? [];
function path(n: XNode | undefined, ...names: string[]): XNode | undefined {
  let cur = n;
  for (const nm of names) {
    cur = child(cur, nm);
    if (!cur) return undefined;
  }
  return cur;
}
function descendants(n: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of n.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

/* ============================================================ reading */

const SCHEME_COLORS: Record<string, string> = {
  dk1: "#000000",
  lt1: "#ffffff",
  dk2: "#44546a",
  lt2: "#e7e6e6",
  tx1: "#000000",
  bg1: "#ffffff",
  tx2: "#44546a",
  bg2: "#e7e6e6",
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
  hlink: "#0563c1",
  folHlink: "#954f72",
};

/** A colour out of a fill node (solidFill's child), if it is a plain one. */
function colorOf(fill: XNode | undefined): string | undefined {
  if (!fill) return undefined;
  const srgb = child(fill, "a:srgbClr");
  if (srgb) return "#" + srgb.attrs.val.toLowerCase();
  const scheme = child(fill, "a:schemeClr");
  if (scheme) {
    const base = SCHEME_COLORS[scheme.attrs.val];
    if (!base) return undefined;
    // lumMod/lumOff shade a theme colour; applied roughly.
    const mod = Number(child(scheme, "a:lumMod")?.attrs.val ?? 100000) / 100000;
    const off = Number(child(scheme, "a:lumOff")?.attrs.val ?? 0) / 100000;
    if (mod === 1 && off === 0) return base;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
    const adj = (v: number) => Math.max(0, Math.min(255, Math.round(v * mod + 255 * off)));
    return "#" + [r, g, b].map((v) => adj(v).toString(16).padStart(2, "0")).join("");
  }
  const sys = child(fill, "a:sysClr");
  if (sys?.attrs.lastClr) return "#" + sys.attrs.lastClr.toLowerCase();
  return undefined;
}

interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  chOff?: { x: number; y: number };
  chExt?: { w: number; h: number };
}

function readXfrm(xfrm: XNode | undefined): Xfrm | undefined {
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  if (!off || !ext) return undefined;
  const out: Xfrm = {
    x: Number(off.attrs.x) / EMU_PER_PX,
    y: Number(off.attrs.y) / EMU_PER_PX,
    w: Number(ext.attrs.cx) / EMU_PER_PX,
    h: Number(ext.attrs.cy) / EMU_PER_PX,
  };
  if (xfrm?.attrs.rot) out.rot = Number(xfrm.attrs.rot) / 60000;
  const chOff = child(xfrm, "a:chOff");
  const chExt = child(xfrm, "a:chExt");
  if (chOff && chExt) {
    out.chOff = { x: Number(chOff.attrs.x) / EMU_PER_PX, y: Number(chOff.attrs.y) / EMU_PER_PX };
    out.chExt = { w: Number(chExt.attrs.cx) / EMU_PER_PX, h: Number(chExt.attrs.cy) / EMU_PER_PX };
  }
  return out;
}

const PRST_TO_SHAPE: Record<string, ShapeKind> = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  rightArrow: "rightArrow",
  star5: "star5",
  hexagon: "hexagon",
  line: "line",
  straightConnector1: "line",
};

/** Default sizes for placeholder text without an explicit size, in points. */
const PH_SIZES: Record<string, number> = {
  title: 36,
  ctrTitle: 40,
  subTitle: 20,
  body: 18,
};

function readParagraphs(txBody: XNode | undefined, phType?: string): Paragraph[] {
  if (!txBody) return [];
  const out: Paragraph[] = [];
  for (const p of kids(txBody, "a:p")) {
    const pPr = child(p, "a:pPr");
    const para: Paragraph = { runs: [] };
    const algn = pPr?.attrs.algn;
    if (algn === "ctr") para.align = "center";
    else if (algn === "r") para.align = "right";
    else if (algn === "just") para.align = "justify";
    const lvl = Number(pPr?.attrs.lvl ?? 0);
    if (lvl) para.level = lvl;
    if (child(pPr, "a:buChar")) para.bullet = true;
    if (child(pPr, "a:buAutoNum")) para.numbered = true;
    // A body placeholder bullets by default in every template, and says so
    // only on the master - which we do not walk. The reverse marker is
    // explicit, so it wins.
    if (phType === "body" && !child(pPr, "a:buNone") && !para.numbered) para.bullet = true;

    for (const c of p.children) {
      if (c.name === "a:r" || c.name === "a:fld") {
        const rPr = child(c, "a:rPr");
        const run: Run = { text: child(c, "a:t")?.text ?? "" };
        if (rPr?.attrs.b === "1") run.bold = true;
        if (rPr?.attrs.i === "1") run.italic = true;
        if (rPr?.attrs.u && rPr.attrs.u !== "none") run.underline = true;
        if (rPr?.attrs.strike && rPr.attrs.strike !== "noStrike") run.strike = true;
        if (rPr?.attrs.sz) run.size = Number(rPr.attrs.sz) / 100;
        const color = colorOf(child(rPr, "a:solidFill"));
        if (color) run.color = color;
        const latin = child(rPr, "a:latin")?.attrs.typeface;
        if (latin && !latin.startsWith("+")) run.font = latin;
        para.runs.push(run);
      } else if (c.name === "a:br") {
        para.runs.push({ text: "\n" });
      }
    }
    if (phType && PH_SIZES[phType]) {
      const base = PH_SIZES[phType] - (phType === "body" ? Math.min(lvl, 3) * 2 : 0);
      for (const r of para.runs) if (!r.size) r.size = base;
      if ((phType === "title" || phType === "ctrTitle") && para.runs.length) {
        for (const r of para.runs) if (r.bold === undefined) r.bold = true;
      }
    }
    if (para.runs.length === 0) para.runs.push({ text: "" });
    out.push(para);
  }
  return out;
}

/** Placeholder position from a layout or master, matched like PowerPoint. */
function placeholderXfrm(tree: XNode | undefined, type: string | undefined, idx: string | undefined): Xfrm | undefined {
  if (!tree) return undefined;
  const sps = descendants(tree, "p:sp");
  const match = (want: (ph: XNode) => boolean) =>
    sps.find((sp) => {
      const ph = path(sp, "p:nvSpPr", "p:nvPr", "p:ph");
      return ph ? want(ph) : false;
    });
  const byIdx = idx !== undefined ? match((ph) => ph.attrs.idx === idx) : undefined;
  const t = type ?? "body";
  const byType = match((ph) => (ph.attrs.type ?? "body") === t || (t === "ctrTitle" && ph.attrs.type === "title"));
  const hit = byIdx ?? byType;
  return readXfrm(path(hit, "p:spPr", "a:xfrm"));
}

interface Rels {
  byId: Record<string, { target: string; type: string }>;
}

function readRels(entries: Map<string, Uint8Array>, relsPath: string): Rels {
  const bytes = entries.get(relsPath);
  const out: Rels = { byId: {} };
  if (!bytes) return out;
  const root = parseXml(new TextDecoder().decode(bytes));
  for (const r of descendants(root, "Relationship")) {
    out.byId[r.attrs.Id] = { target: r.attrs.Target, type: r.attrs.Type };
  }
  return out;
}

/** Resolves a relationship target against the part it belongs to. */
function resolve(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const dir = fromPart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") dir.pop();
    else if (seg !== ".") dir.push(seg);
  }
  return dir.join("/");
}

function relsPathFor(part: string): string {
  const parts = part.split("/");
  const name = parts.pop();
  return [...parts, "_rels", `${name}.rels`].join("/");
}

function mimeFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "jpg" || ext === "jpeg"
    ? "image/jpeg"
    : ext === "gif"
    ? "image/gif"
    : ext === "svg"
    ? "image/svg+xml"
    : ext === "webp"
    ? "image/webp"
    : ext === "bmp"
    ? "image/bmp"
    : "image/png";
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Reads a .pptx into a deck.
 *
 * Decks that are not 16:9 are scaled uniformly to fit the canvas and
 * centred, so a 4:3 presentation keeps its proportions with a margin on
 * either side rather than being stretched.
 */
export async function pptxToDeck(bytes: Uint8Array): Promise<Deck> {
  const entries = new Map<string, Uint8Array>();
  for (const e of await readZip(bytes)) entries.set(e.name, e.data);
  const xml = (part: string): XNode | undefined => {
    const b = entries.get(part);
    return b ? parseXml(new TextDecoder().decode(b)) : undefined;
  };

  const presPart = "ppt/presentation.xml";
  const pres = xml(presPart);
  if (!pres) throw new Error("keine ppt/presentation.xml - ist das wirklich eine .pptx?");
  const presRels = readRels(entries, relsPathFor(presPart));

  // Scale: source slide size onto our canvas.
  const sldSz = path(pres, "p:presentation", "p:sldSz");
  const srcW = Number(sldSz?.attrs.cx ?? 9144000) / EMU_PER_PX;
  const srcH = Number(sldSz?.attrs.cy ?? 5143500) / EMU_PER_PX;
  const scale = Math.min(SLIDE_W / srcW, SLIDE_H / srcH);
  const dx = (SLIDE_W - srcW * scale) / 2;
  const dy = (SLIDE_H - srcH * scale) / 2;
  const fit = (f: Xfrm, parent?: { ox: number; oy: number; sx: number; sy: number }) => {
    const p = parent ?? { ox: 0, oy: 0, sx: 1, sy: 1 };
    return {
      x: Math.round((p.ox + f.x * p.sx) * scale + dx),
      y: Math.round((p.oy + f.y * p.sy) * scale + dy),
      w: Math.max(4, Math.round(f.w * p.sx * scale)),
      h: Math.max(4, Math.round(f.h * p.sy * scale)),
    };
  };

  const deck: Deck = { slides: [] };
  const layoutCache = new Map<string, { layout?: XNode; master?: XNode }>();

  for (const sldId of kids(path(pres, "p:presentation", "p:sldIdLst"), "p:sldId")) {
    const rel = presRels.byId[sldId.attrs["r:id"]];
    if (!rel) continue;
    const slidePart = resolve(presPart, rel.target);
    const sld = xml(slidePart);
    if (!sld) continue;
    const slideRels = readRels(entries, relsPathFor(slidePart));

    // Layout and master, for placeholder positions and the background.
    let layout: XNode | undefined;
    let master: XNode | undefined;
    const layoutRel = Object.values(slideRels.byId).find((r) => r.type.endsWith("/slideLayout"));
    if (layoutRel) {
      const layoutPart = resolve(slidePart, layoutRel.target);
      if (!layoutCache.has(layoutPart)) {
        const l = xml(layoutPart);
        const lRels = readRels(entries, relsPathFor(layoutPart));
        const mRel = Object.values(lRels.byId).find((r) => r.type.endsWith("/slideMaster"));
        const m = mRel ? xml(resolve(layoutPart, mRel.target)) : undefined;
        layoutCache.set(layoutPart, { layout: l, master: m });
      }
      ({ layout, master } = layoutCache.get(layoutPart)!);
    }

    const slide: Slide = { id: newSlideId(), elements: [] };
    const bgOf = (tree: XNode | undefined) =>
      colorOf(path(tree, tree?.name === "#root" ? tree.children[0]?.name ?? "" : "", "p:cSld", "p:bg", "p:bgPr", "a:solidFill"));
    const bg = bgOf(sld) ?? bgOf(layout) ?? bgOf(master);
    if (bg && bg !== "#ffffff") slide.background = bg;

    const spTree = path(sld, "p:sld", "p:cSld", "p:spTree");
    let counter = 0;

    const walk = (node: XNode, parent?: { ox: number; oy: number; sx: number; sy: number }) => {
      for (const c of node.children) {
        if (c.name === "p:grpSp") {
          const gx = readXfrm(path(c, "p:grpSpPr", "a:xfrm"));
          if (gx?.chOff && gx.chExt) {
            const sx = gx.chExt.w ? gx.w / gx.chExt.w : 1;
            const sy = gx.chExt.h ? gx.h / gx.chExt.h : 1;
            const p = parent ?? { ox: 0, oy: 0, sx: 1, sy: 1 };
            walk(c, {
              ox: p.ox + (gx.x - gx.chOff.x * sx) * p.sx,
              oy: p.oy + (gx.y - gx.chOff.y * sy) * p.sy,
              sx: sx * p.sx,
              sy: sy * p.sy,
            });
          } else walk(c, parent);
          continue;
        }

        if (c.name === "p:sp" || c.name === "p:cxnSp") {
          const ph = path(c, "p:nvSpPr", "p:nvPr", "p:ph");
          const phType = ph ? (ph.attrs.type ?? "body") : undefined;
          let xf = readXfrm(path(c, "p:spPr", "a:xfrm"));
          if (!xf && ph) {
            xf = placeholderXfrm(layout, phType, ph.attrs.idx) ??
              placeholderXfrm(master, phType, ph.attrs.idx);
          }
          if (!xf) continue;
          const txBody = child(c, "p:txBody");
          const paragraphs = readParagraphs(txBody, phType);
          const hasText = paragraphs.some((p) => p.runs.some((r) => r.text.trim()));
          // Empty placeholders ("Click to add title") have nothing to show.
          if (ph && !hasText) continue;

          const spPr = child(c, "p:spPr");
          const prst = path(spPr, "a:prstGeom")?.attrs.prst ?? "rect";
          // A shape drawn with the toolbar has no fill of its own; it points
          // at the theme with <p:style>, and PowerPoint paints it in the
          // accent colour. Without reading that, such a shape has no colour
          // and looks like nothing at all.
          const style = child(c, "p:style");
          const fillRef = child(style, "a:fillRef");
          const lnRef = child(style, "a:lnRef");
          const styleFill = fillRef && fillRef.attrs.idx !== "0" ? colorOf(fillRef) : undefined;
          const styleLine = lnRef && lnRef.attrs.idx !== "0" ? colorOf(lnRef) : undefined;
          const fill = child(spPr, "a:noFill") ? undefined : colorOf(child(spPr, "a:solidFill")) ?? styleFill;
          const ln = child(spPr, "a:ln");
          const stroke = ln && child(ln, "a:noFill")
            ? undefined
            : (ln ? colorOf(child(ln, "a:solidFill")) : undefined) ?? styleLine;
          const strokeWidth = ln?.attrs.w ? Number(ln.attrs.w) / EMU_PER_PX : undefined;
          const anchor = child(txBody, "a:bodyPr")?.attrs.anchor;
          const valign = anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : undefined;
          const box = fit(xf, parent);
          const id = `e${++counter}_${slide.id}`;
          const shape = PRST_TO_SHAPE[prst];

          if (shape && shape !== "rect" || (shape === "rect" && (fill || stroke) && !ph)) {
            slide.elements.push({
              kind: "shape",
              id,
              ...box,
              ...(xf.rot ? { rotation: xf.rot } : {}),
              shape: shape ?? "rect",
              ...(fill ? { fill } : {}),
              ...(stroke ? { stroke } : {}),
              ...(strokeWidth ? { strokeWidth } : {}),
              ...(hasText ? { paragraphs } : {}),
              ...(valign ? { valign } : {}),
            });
          } else if (hasText) {
            slide.elements.push({
              kind: "text",
              id,
              ...box,
              ...(xf.rot ? { rotation: xf.rot } : {}),
              paragraphs,
              ...(fill ? { fill } : {}),
              ...(stroke ? { stroke, strokeWidth: strokeWidth ?? 1 } : {}),
              ...(valign ? { valign } : {}),
              ...(phType === "title" || phType === "ctrTitle"
                ? { placeholder: "title" as const }
                : phType === "subTitle"
                ? { placeholder: "subtitle" as const }
                : phType === "body"
                ? { placeholder: "body" as const }
                : {}),
            });
          } else if (!shape && prst !== "rect") {
            // A geometry the editor has no drawing for: keep its place.
            slide.elements.push({
              kind: "shape",
              id,
              ...box,
              shape: "rect",
              ...(fill ? { fill } : {}),
              ...(stroke ? { stroke } : {}),
            });
          }
          continue;
        }

        if (c.name === "p:pic") {
          const xf = readXfrm(path(c, "p:spPr", "a:xfrm"));
          const embed = path(c, "p:blipFill", "a:blip")?.attrs["r:embed"];
          const rel = embed ? slideRels.byId[embed] : undefined;
          if (!xf || !rel) continue;
          const mediaPart = resolve(slidePart, rel.target);
          const data = entries.get(mediaPart);
          if (!data) continue;
          const mime = mimeFor(mediaPart);
          if (mime === "image/svg+xml" || mime === "image/bmp") continue;
          slide.elements.push({
            kind: "image",
            id: `e${++counter}_${slide.id}`,
            ...fit(xf, parent),
            ...(xf.rot ? { rotation: xf.rot } : {}),
            src: `data:${mime};base64,${encodeBase64(data)}`,
          });
          continue;
        }

        if (c.name === "p:graphicFrame") {
          const xf = readXfrm(child(c, "p:xfrm"));
          if (!xf) continue;
          const tbl = descendants(c, "a:tbl")[0];
          const box = fit(xf, parent);
          const id = `e${++counter}_${slide.id}`;
          if (tbl) {
            // Rows become lines, cells are separated by a tab and a bar -
            // legible, and PowerPoint gets a text box it can show.
            const rows = kids(tbl, "a:tr").map((tr) =>
              kids(tr, "a:tc").map((tc) =>
                readParagraphs(child(tc, "a:txBody")).map((p) => p.runs.map((r) => r.text).join("")).join(" ")
              ).join("  |  ")
            );
            slide.elements.push({
              kind: "text",
              id,
              ...box,
              paragraphs: rows.map((r, i) => ({ runs: [{ text: r, size: 14, ...(i === 0 ? { bold: true } : {}) }] })),
              stroke: "#bfbfbf",
              strokeWidth: 1,
            });
          } else {
            const label = descendants(c, "c:chart").length ? "Diagramm" : "Objekt";
            slide.elements.push({
              kind: "shape",
              id,
              ...box,
              shape: "rect",
              fill: "#f2f2f2",
              stroke: "#bfbfbf",
              paragraphs: [{ runs: [{ text: `[${label}]`, color: "#7f7f7f", size: 14 }], align: "center" }],
              valign: "middle",
            });
          }
        }
      }
    };
    if (spTree) walk(spTree);

    // Speaker notes.
    const notesRel = Object.values(slideRels.byId).find((r) => r.type.endsWith("/notesSlide"));
    if (notesRel) {
      const notes = xml(resolve(slidePart, notesRel.target));
      const bodySp = descendants(notes ?? { name: "", attrs: {}, children: [], text: "" }, "p:sp").find((sp) =>
        path(sp, "p:nvSpPr", "p:nvPr", "p:ph")?.attrs.type === "body"
      );
      const text = paragraphsText(readParagraphs(child(bodySp, "p:txBody"))).trim();
      if (text) slide.notes = text;
    }

    deck.slides.push(slide);
  }
  return deck;
}

/* ============================================================ writing */

const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.presentationml";

const emu = (px: number) => Math.round(px * EMU_PER_PX);
const hex = (c: string) => c.replace("#", "").toUpperCase().padStart(6, "0");

function solidFill(color: string): string {
  return `<a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>`;
}

function lineXml(stroke?: string, width?: number): string {
  if (!stroke) return "<a:ln><a:noFill/></a:ln>";
  return `<a:ln w="${emu(width ?? 1)}">${solidFill(stroke)}</a:ln>`;
}

function runXml(r: Run, lang: string): string {
  if (r.text === "\n") return "<a:br/>";
  const attrs = [
    `lang="${lang}"`,
    r.size ? `sz="${Math.round(r.size * 100)}"` : "",
    r.bold ? 'b="1"' : "",
    r.italic ? 'i="1"' : "",
    r.underline ? 'u="sng"' : "",
    r.strike ? 'strike="sngStrike"' : "",
    'dirty="0"',
  ].filter(Boolean).join(" ");
  const inner = (r.color ? solidFill(r.color) : "") +
    (r.font ? `<a:latin typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/>` : "");
  return `<a:r><a:rPr ${attrs}>${inner}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
}

function paragraphXml(p: Paragraph, lang: string): string {
  const level = p.level ?? 0;
  const algn = p.align === "center" ? "ctr" : p.align === "right" ? "r" : p.align === "justify" ? "just" : undefined;
  const indent = p.bullet || p.numbered;
  const marL = indent ? 342900 * (level + 1) : level ? 342900 * level : 0;
  const pAttrs = [
    marL ? `marL="${marL}"` : "",
    indent ? 'indent="-342900"' : "",
    level ? `lvl="${level}"` : "",
    algn ? `algn="${algn}"` : "",
  ].filter(Boolean).join(" ");
  const bu = p.numbered
    ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>'
    : p.bullet
    ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>'
    : "<a:buNone/>";
  const size = p.runs.find((r) => r.size)?.size;
  const endPr = `<a:endParaRPr lang="${lang}"${size ? ` sz="${Math.round(size * 100)}"` : ""} dirty="0"/>`;
  return `<a:p><a:pPr${pAttrs ? " " + pAttrs : ""}>${bu}</a:pPr>${p.runs.map((r) => runXml(r, lang)).join("")}${endPr}</a:p>`;
}

function txBodyXml(paragraphs: Paragraph[], valign: string | undefined, lang: string): string {
  const anchor = valign === "middle" ? "ctr" : valign === "bottom" ? "b" : "t";
  const ps = paragraphs.length ? paragraphs : [{ runs: [{ text: "" }] }];
  return `<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${
    ps.map((p) => paragraphXml(p, lang)).join("")
  }</p:txBody>`;
}

function xfrmXml(e: BaseElement): string {
  const rot = e.rotation ? ` rot="${Math.round(e.rotation * 60000)}"` : "";
  return `<a:xfrm${rot}><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(e.w)}" cy="${emu(e.h)}"/></a:xfrm>`;
}

const SHAPE_TO_PRST: Record<ShapeKind, string> = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  rightArrow: "rightArrow",
  star5: "star5",
  hexagon: "hexagon",
  line: "line",
};

function elementXml(
  e: SlideElement,
  n: number,
  lang: string,
  imageRel: (src: string) => string,
): string {
  if (e.kind === "image") {
    const rId = imageRel(e.src);
    return `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="Bild ${n}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr>${xfrmXml(e)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }
  if (e.kind === "text") {
    // A title carries the placeholder mark, so a reader - ours, PowerPoint's
    // outline view, a screen reader - knows which box is the heading. The
    // layout below defines that placeholder, which keeps the file valid; the
    // box brings its own position and formatting and overrides the layout's.
    const isTitle = e.placeholder === "title";
    const nv = isTitle
      ? `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr>`
      : `<p:cNvSpPr txBox="1"/><p:nvPr/>`;
    return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="${isTitle ? "Titel" : "Textfeld"} ${n}"/>${nv}</p:nvSpPr>` +
      `<p:spPr>${xfrmXml(e)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${e.fill ? solidFill(e.fill) : "<a:noFill/>"}${
        lineXml(e.stroke, e.strokeWidth)
      }</p:spPr>${txBodyXml(e.paragraphs, e.valign, lang)}</p:sp>`;
  }
  // shape
  const prst = SHAPE_TO_PRST[e.shape] ?? "rect";
  const isLine = e.shape === "line";
  const fill = isLine ? "<a:noFill/>" : e.fill ? solidFill(e.fill) : "<a:noFill/>";
  const stroke = isLine ? (e.stroke ?? "#000000") : e.stroke;
  const body = isLine ? "" : txBodyXml(e.paragraphs ?? [], e.valign ?? "middle", lang);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="Form ${n}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrmXml(e)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${fill}${lineXml(stroke, e.strokeWidth ?? (isLine ? 2 : 1))}</p:spPr>${body}</p:sp>`;
}

function slideXml(slide: Slide, lang: string, imageRel: (src: string) => string): string {
  const bg = slide.background
    ? `<p:bg><p:bgPr>${solidFill(slide.background)}<a:effectLst/></p:bgPr></p:bg>`
    : "";
  const shapes = slide.elements.map((e, i) => elementXml(e, i + 2, lang, imageRel)).join("");
  return XMLDECL +
    `<p:sld ${NS_A} ${NS_R} ${NS_P}><p:cSld>${bg}<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    shapes +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function notesXml(text: string, lang: string): string {
  const paragraphs = textParagraphs(text);
  return XMLDECL +
    `<p:notes ${NS_A} ${NS_R} ${NS_P}><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Folienbildplatzhalter 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notizenplatzhalter 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map((p) => paragraphXml(p, lang)).join("")}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const THEME = XMLDECL +
  `<a:theme ${NS_A} name="Office"><a:themeElements><a:clrScheme name="Office">` +
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>` +
  `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>` +
  `<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>` +
  `<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>` +
  `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme>` +
  `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const EMPTY_TREE =
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;

const CLR_MAP =
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;

function lvlStyles(prefix: string, sizes: number[]): string {
  return sizes.map((sz, i) =>
    `<a:lvl${i + 1}pPr marL="${i * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">` +
    `<a:defRPr sz="${sz * 100}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="${prefix}"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${i + 1}pPr>`
  ).join("");
}

const SLIDE_MASTER = XMLDECL +
  `<p:sldMaster ${NS_A} ${NS_R} ${NS_P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld>${CLR_MAP}` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
  `<p:txStyles><p:titleStyle>${lvlStyles("+mj-lt", [44])}</p:titleStyle>` +
  `<p:bodyStyle>${lvlStyles("+mn-lt", [28, 24, 20, 18, 18])}</p:bodyStyle>` +
  `<p:otherStyle>${lvlStyles("+mn-lt", [18, 18, 18, 18, 18])}</p:otherStyle></p:txStyles></p:sldMaster>`;

/** The one layout: a title placeholder, so slides may mark their heading. */
const SLIDE_LAYOUT = XMLDECL +
  `<p:sldLayout ${NS_A} ${NS_R} ${NS_P} type="titleOnly" preserve="1"><p:cSld name="Nur Titel"><p:spTree>` +
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Titel 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="${emu(60)}" y="${emu(36)}"/><a:ext cx="${emu(840)}" cy="${emu(84)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
  `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="de-DE"/></a:p></p:txBody></p:sp>` +
  `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const NOTES_MASTER = XMLDECL +
  `<p:notesMaster ${NS_A} ${NS_R} ${NS_P}><p:cSld>${EMPTY_TREE}</p:cSld>${CLR_MAP}` +
  `<p:notesStyle>${lvlStyles("+mn-lt", [12, 12, 12, 12, 12])}</p:notesStyle></p:notesMaster>`;

function rels(list: { id: string; type: string; target: string }[]): string {
  return XMLDECL +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    list.map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${r.target}"/>`).join("") +
    `</Relationships>`;
}

/** Content type by data: URL prefix. */
function imageMeta(src: string): { ext: string; mime: string; bytes: Uint8Array } {
  const m = src.match(/^data:(image\/[a-z+]+);base64,(.*)$/s);
  if (!m) throw new Error("Bild ist keine data:-URL");
  const mime = m[1];
  const ext = mime === "image/jpeg" ? "jpeg" : mime === "image/gif" ? "gif" : mime === "image/webp" ? "webp" : "png";
  return { ext, mime, bytes: decodeBase64(m[2]) };
}

/**
 * Writes a deck as a .pptx.
 *
 * Every picture is stored once, however many slides show it - the same data
 * URL maps to the same media part.
 */
export async function deckToPptx(deck: Deck, opts: { lang?: string; title?: string } = {}): Promise<Uint8Array> {
  const lang = opts.lang === "en" ? "en-US" : "de-DE";
  const enc = new TextEncoder();
  const files: ZipEntry[] = [];
  const put = (name: string, content: string | Uint8Array) =>
    files.push({ name, data: typeof content === "string" ? enc.encode(content) : content });

  const media = new Map<string, string>(); // src -> media part name
  const mediaTypes = new Set<string>();
  let mediaN = 0;
  const mediaFor = (src: string): string => {
    let part = media.get(src);
    if (!part) {
      const { ext, bytes } = imageMeta(src);
      part = `ppt/media/image${++mediaN}.${ext}`;
      media.set(src, part);
      mediaTypes.add(ext);
      put(part, bytes);
    }
    return part;
  };

  const slides = deck.slides.length ? deck.slides : [{ id: newSlideId(), elements: [] }];
  const withNotes = slides.some((s) => s.notes?.trim());

  slides.forEach((slide, i) => {
    const n = i + 1;
    const slideRels: { id: string; type: string; target: string }[] = [
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
    ];
    const imageRel = (src: string) => {
      const part = mediaFor(src);
      const existing = slideRels.find((r) => r.target === "../" + part.slice(4));
      if (existing) return existing.id;
      const id = `rId${slideRels.length + 1}`;
      slideRels.push({ id, type: "image", target: "../" + part.slice(4) });
      return id;
    };
    put(`ppt/slides/slide${n}.xml`, slideXml(slide, lang, imageRel));
    if (slide.notes?.trim()) {
      slideRels.push({ id: `rId${slideRels.length + 1}`, type: "notesSlide", target: `../notesSlides/notesSlide${n}.xml` });
      put(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(slide.notes, lang));
      put(
        `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
        rels([
          { id: "rId1", type: "notesMaster", target: "../notesMasters/notesMaster1.xml" },
          { id: "rId2", type: "slide", target: `../slides/slide${n}.xml` },
        ]),
      );
    }
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels));
  });

  put("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER);
  put(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
    ]),
  );
  put("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT);
  put(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]),
  );
  put("ppt/theme/theme1.xml", THEME);
  if (withNotes) {
    put("ppt/notesMasters/notesMaster1.xml", NOTES_MASTER);
    put(
      "ppt/notesMasters/_rels/notesMaster1.xml.rels",
      rels([{ id: "rId1", type: "theme", target: "../theme/theme2.xml" }]),
    );
    put("ppt/theme/theme2.xml", THEME);
  }

  const presRels: { id: string; type: string; target: string }[] = [
    { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
    ...slides.map((_, i) => ({ id: `rId${i + 2}`, type: "slide", target: `slides/slide${i + 1}.xml` })),
  ];
  const themeId = `rId${presRels.length + 1}`;
  presRels.push({ id: themeId, type: "theme", target: "theme/theme1.xml" });
  presRels.push({ id: `rId${presRels.length + 1}`, type: "presProps", target: "presProps.xml" });
  presRels.push({ id: `rId${presRels.length + 1}`, type: "viewProps", target: "viewProps.xml" });
  presRels.push({ id: `rId${presRels.length + 1}`, type: "tableStyles", target: "tableStyles.xml" });
  let notesMasterId = "";
  if (withNotes) {
    notesMasterId = `rId${presRels.length + 1}`;
    presRels.push({ id: notesMasterId, type: "notesMaster", target: "notesMasters/notesMaster1.xml" });
  }
  put("ppt/_rels/presentation.xml.rels", rels(presRels));

  put(
    "ppt/presentation.xml",
    XMLDECL +
      `<p:presentation ${NS_A} ${NS_R} ${NS_P} saveSubsetFonts="1">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      (withNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterId}"/></p:notesMasterIdLst>` : "") +
      `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst>` +
      `<p:sldSz cx="${emu(SLIDE_W)}" cy="${emu(SLIDE_H)}"/><p:notesSz cx="6858000" cy="9144000"/>` +
      `<p:defaultTextStyle>${lvlStyles("+mn-lt", [18, 18, 18, 18, 18, 18, 18, 18, 18])}</p:defaultTextStyle>` +
      `</p:presentation>`,
  );
  put("ppt/presProps.xml", XMLDECL + `<p:presentationPr ${NS_A} ${NS_R} ${NS_P}/>`);
  put("ppt/viewProps.xml", XMLDECL + `<p:viewPr ${NS_A} ${NS_R} ${NS_P}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>`);
  put("ppt/tableStyles.xml", XMLDECL + `<a:tblStyleLst ${NS_A} def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  put(
    "docProps/core.xml",
    XMLDECL +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${esc(opts.title ?? "")}</dc:title><dc:creator>Bud-E</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  put(
    "docProps/app.xml",
    XMLDECL +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Bud-E</Application><Slides>${slides.length}</Slides></Properties>`,
  );
  // The package relationships: core properties live under the package
  // namespace, the other two under the office one.
  put(
    "_rels/.rels",
    XMLDECL +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>` +
      `</Relationships>`,
  );

  const overrides = [
    `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.slideLayout+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    `<Override PartName="/ppt/presProps.xml" ContentType="${CT}.presProps+xml"/>`,
    `<Override PartName="/ppt/viewProps.xml" ContentType="${CT}.viewProps+xml"/>`,
    `<Override PartName="/ppt/tableStyles.xml" ContentType="${CT}.tableStyles+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
    ...slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT}.slide+xml"/>`),
    ...slides.flatMap((s, i) =>
      s.notes?.trim()
        ? [`<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="${CT}.notesSlide+xml"/>`]
        : []
    ),
    ...(withNotes
      ? [
        `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${CT}.notesMaster+xml"/>`,
        `<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
      ]
      : []),
  ];
  const defaults = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
    ...[...mediaTypes].map((ext) =>
      `<Default Extension="${ext}" ContentType="image/${ext === "jpeg" ? "jpeg" : ext}"/>`
    ),
  ];
  files.unshift({
    name: "[Content_Types].xml",
    data: enc.encode(
      XMLDECL +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}${overrides.join("")}</Types>`,
    ),
  });

  return await writeZip(files);
}

/* ============================================================ text view */

/** The deck as text, for the assistant and for tests. */
export function deckToText(deck: Deck): string {
  return deck.slides.map((s, i) => {
    const lines: string[] = [`Folie ${i + 1}${s.background ? ` (Hintergrund ${s.background})` : ""}:`];
    for (const e of s.elements) {
      if (e.kind === "image") {
        lines.push(`  [Bild ${Math.round(e.w)}x${Math.round(e.h)} bei ${Math.round(e.x)},${Math.round(e.y)}]`);
      } else {
        const text = paragraphsText(e.paragraphs).trim();
        const label = e.kind === "shape" ? `Form ${e.shape}` : e.placeholder === "title" ? "Titel" : "Text";
        if (text) lines.push(`  ${label}: ${text.replace(/\n/g, " / ")}`);
        else if (e.kind === "shape") lines.push(`  [${label}]`);
      }
    }
    if (s.notes?.trim()) lines.push(`  Notizen: ${s.notes.trim().replace(/\n/g, " / ")}`);
    return lines.join("\n");
  }).join("\n\n");
}
