// components/SlidesModal.tsx
//
// A slide editor, in the same overlay as the word processor.
//
// The slide is a 960 x 540 canvas scaled to whatever room there is; every
// element on it is a box the reader can drag, resize and double-click into.
// Shapes are drawn as SVG, text lives in a contenteditable while it is being
// edited and as plain markup the rest of the time. Nothing is loaded from a
// CDN - the content policy here forbids it, and a slide editor is mostly
// pointer arithmetic anyway.
//
// Decks live in IndexedDB (slideStore.ts) and travel as .pptx in and out
// (pptx.ts). The assistant sees the names of the decks and can build or
// change one when it is allowed to - never their contents unasked.

import { useEffect, useRef, useState } from "preact/hooks";
import { slidesContent } from "../internalization/content.ts";
import {
  type Deck,
  deckToPptx,
  newElementId,
  newSlideId,
  type Paragraph,
  paragraphsText,
  pptxToDeck,
  type Run,
  type ShapeKind,
  type Slide,
  SLIDE_H,
  SLIDE_W,
  slideBackgroundCss,
  type SlideElement,
} from "../utils/pptx.ts";
import {
  applyTheme,
  buildSlide,
  imageSize,
  LAYOUTS,
  newSlideSpec,
  relayoutSlide,
  type SlideLayout,
  THEMES,
  themeOf,
} from "../utils/slideLayouts.ts";
import {
  type DeckMeta,
  deleteDeck,
  freeDeckName,
  listDecks,
  loadDeck,
  newDeckId,
  saveDeck,
} from "../utils/slideStore.ts";
import { isSlidesAssistantAllowed, setSlidesAssistantAllowed } from "../utils/slidesTools.ts";
import { type AudioNote, audioKb, canRecord, type Recorder, startRecording } from "../utils/audioNote.ts";

const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60];
/** Where the editor left off: which deck, which slide. */
const LAST_KEY = "bude-slides-last";
const AUTOSAVE_MS = 800;

function readLast(): { id: string; slide: number } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeLast(id: string, slide: number) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ id, slide }));
  } catch {
    // Private mode: it simply will not remember.
  }
}
const MAX_IMAGE_PX = 1600;
const HISTORY = 60;

const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "rect", label: "▭" },
  { kind: "roundRect", label: "▢" },
  { kind: "ellipse", label: "◯" },
  { kind: "triangle", label: "△" },
  { kind: "diamond", label: "◇" },
  { kind: "rightArrow", label: "⇨" },
  { kind: "star5", label: "☆" },
  { kind: "hexagon", label: "⬡" },
  { kind: "line", label: "╱" },
];

interface Props {
  lang?: string;
  onClose: () => void;
  /** Tells the chat which deck the assistant should act on. */
  onDeckOpen?: (meta: DeckMeta | null) => void;
  /** Bumped by the chat after a tool changed something, so we re-read. */
  revision?: number;
  /** Opened straight away: a .pptx from a message or the computer. */
  incoming?: { name: string; bytes: Uint8Array } | null;
  /** Opened straight away: a deck already in the store. */
  openId?: string;
}

/* ============================================================== helpers */

const emptySlide = (): Slide => ({ id: newSlideId(), elements: [] });
const emptyDeck = (): Deck => ({ slides: [emptySlide()] });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function hexColor(value: string): string | undefined {
  const v = value.trim();
  if (!v || v === "inherit" || v === "transparent") return undefined;
  if (v.startsWith("#")) return v.length === 4 ? "#" + [...v.slice(1)].map((c) => c + c).join("") : v.toLowerCase();
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return undefined;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

/** Text of a run as inline HTML, for the editable box. */
function runHtml(r: Run): string {
  if (r.text === "\n") return "<br>";
  const esc = r.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const style = [
    r.bold ? "font-weight:bold" : "",
    r.italic ? "font-style:italic" : "",
    r.underline || r.strike
      ? `text-decoration:${[r.underline ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean).join(" ")}`
      : "",
    r.color ? `color:${r.color}` : "",
    r.size ? `font-size:${r.size}pt` : "",
    r.font ? `font-family:'${r.font}'` : "",
  ].filter(Boolean).join(";");
  return style ? `<span style="${style}">${esc || "&#8203;"}</span>` : esc;
}

function paragraphsHtml(ps: Paragraph[]): string {
  return ps.map((p) => {
    const tag = p.bullet ? "li" : p.numbered ? "li" : "div";
    const attrs = [
      p.align ? `style="text-align:${p.align}${p.level ? `;margin-left:${p.level * 24}px` : ""}"` : p.level ? `style="margin-left:${p.level * 24}px"` : "",
      p.bullet ? 'data-bullet="1"' : "",
      p.numbered ? 'data-numbered="1"' : "",
      p.level ? `data-level="${p.level}"` : "",
    ].filter(Boolean).join(" ");
    const inner = p.runs.map(runHtml).join("") || "<br>";
    const el = `<${tag}${attrs ? " " + attrs : ""}>${inner}</${tag}>`;
    return p.bullet ? `<ul>${el}</ul>` : p.numbered ? `<ol>${el}</ol>` : el;
  }).join("").replace(/<\/ul><ul>/g, "").replace(/<\/ol><ol>/g, "");
}

/** Paragraphs out of what the editable box contains afterwards. */
function htmlToParagraphs(root: HTMLElement, base: Partial<Run>): Paragraph[] {
  const out: Paragraph[] = [];

  const marksOf = (el: HTMLElement, inherited: Partial<Run>): Partial<Run> => {
    const m = { ...inherited };
    const tag = el.tagName;
    if (tag === "B" || tag === "STRONG") m.bold = true;
    if (tag === "I" || tag === "EM") m.italic = true;
    if (tag === "U") m.underline = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") m.strike = true;
    const st = el.style;
    if (st.fontWeight === "bold" || Number(st.fontWeight) >= 600) m.bold = true;
    if (st.fontWeight === "normal") m.bold = false;
    if (st.fontStyle === "italic") m.italic = true;
    if (st.textDecoration.includes("underline")) m.underline = true;
    if (st.textDecoration.includes("line-through")) m.strike = true;
    const color = hexColor(st.color) ?? (tag === "FONT" ? hexColor(el.getAttribute("color") ?? "") : undefined);
    if (color) m.color = color;
    if (st.fontSize) {
      const n = parseFloat(st.fontSize);
      if (st.fontSize.endsWith("px")) m.size = Math.round(n * 0.75);
      else if (st.fontSize.endsWith("pt")) m.size = Math.round(n);
    }
    if (st.fontFamily) m.font = st.fontFamily.replace(/["']/g, "").split(",")[0].trim();
    return m;
  };

  const walkInline = (node: Node, marks: Partial<Run>, runs: Run[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/​/g, "");
      if (text) runs.push({ ...marks, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      runs.push({ text: "\n" });
      return;
    }
    const m = marksOf(el, marks);
    for (const c of Array.from(el.childNodes)) walkInline(c, m, runs);
  };

  const block = (el: HTMLElement, list: "ul" | "ol" | null) => {
    const runs: Run[] = [];
    for (const c of Array.from(el.childNodes)) walkInline(c, marksOf(el, base), runs);
    // A trailing line break is the editor's own, not a paragraph's.
    while (runs.length && runs[runs.length - 1].text === "\n") runs.pop();
    const p: Paragraph = { runs: runs.length ? runs : [{ ...base, text: "" }] };
    const align = el.style.textAlign;
    if (align === "center" || align === "right" || align === "justify") p.align = align;
    const level = Number(el.dataset.level ?? 0) || Math.round(parseFloat(el.style.marginLeft || "0") / 24);
    if (level) p.level = level;
    if (list === "ul" || el.dataset.bullet) p.bullet = true;
    if (list === "ol" || el.dataset.numbered) p.numbered = true;
    out.push(p);
  };

  const walkBlocks = (parent: HTMLElement, list: "ul" | "ol" | null) => {
    let loose: Node[] = [];
    const flushLoose = () => {
      if (!loose.length) return;
      const wrap = document.createElement("div");
      for (const n of loose) wrap.appendChild(n.cloneNode(true));
      block(wrap, list);
      loose = [];
    };
    for (const c of Array.from(parent.childNodes)) {
      const el = c as HTMLElement;
      const tag = c.nodeType === Node.ELEMENT_NODE ? el.tagName : "";
      if (tag === "UL" || tag === "OL") {
        flushLoose();
        walkBlocks(el, tag === "UL" ? "ul" : "ol");
      } else if (tag === "DIV" || tag === "P" || tag === "LI" || /^H[1-6]$/.test(tag)) {
        flushLoose();
        // A div holding only further blocks is a wrapper the browser made.
        const inner = Array.from(el.childNodes);
        if (inner.length && inner.every((n) => n.nodeType === Node.ELEMENT_NODE && /^(DIV|P|UL|OL|LI)$/.test((n as HTMLElement).tagName))) {
          walkBlocks(el, list);
        } else block(el, list);
      } else {
        loose.push(c);
      }
    }
    flushLoose();
  };
  walkBlocks(root, null);
  return out.length ? out : [{ runs: [{ ...base, text: "" }] }];
}

/** The size most of an element's text has - what the size box shows. */
function dominantRun(ps: Paragraph[] | undefined): Run {
  const runs = (ps ?? []).flatMap((p) => p.runs).filter((r) => r.text.trim());
  return runs[0] ?? { text: "" };
}

/* ============================================================= drawing */

function ShapeSvg({ el }: { el: Extract<SlideElement, { kind: "shape" }> }) {
  const { w, h } = el;
  const fill = el.fill ?? "none";
  const stroke = el.stroke ?? (el.shape === "line" ? "#000000" : "none");
  const sw = el.strokeWidth ?? (el.shape === "line" ? 2 : 1);
  const common = { fill, stroke, "stroke-width": sw, "vector-effect": "non-scaling-stroke" } as Record<string, unknown>;
  const pts = (list: number[][]) => list.map(([x, y]) => `${x * w},${y * h}`).join(" ");
  let body: preact.JSX.Element;
  switch (el.shape) {
    case "ellipse":
      body = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
      break;
    case "roundRect":
      body = <rect x={0} y={0} width={w} height={h} rx={Math.min(w, h) * 0.16} {...common} />;
      break;
    case "triangle":
      body = <polygon points={pts([[0.5, 0], [1, 1], [0, 1]])} {...common} />;
      break;
    case "diamond":
      body = <polygon points={pts([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])} {...common} />;
      break;
    case "rightArrow":
      body = <polygon points={pts([[0, 0.25], [0.65, 0.25], [0.65, 0], [1, 0.5], [0.65, 1], [0.65, 0.75], [0, 0.75]])} {...common} />;
      break;
    case "hexagon":
      body = <polygon points={pts([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]])} {...common} />;
      break;
    case "star5": {
      const p: number[][] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.19 : 0.5;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        p.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a) * (1)]);
      }
      body = <polygon points={pts(p)} {...common} />;
      break;
    }
    case "line":
      body = <line x1={0} y1={h / 2} x2={w} y2={h / 2} {...common} />;
      break;
    default:
      body = <rect x={0} y={0} width={w} height={h} {...common} />;
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} class="absolute inset-0 overflow-visible" style="pointer-events:none">
      {body}
    </svg>
  );
}

function TextView({ paragraphs, valign }: { paragraphs: Paragraph[]; valign?: string }) {
  const justify = valign === "middle" ? "center" : valign === "bottom" ? "flex-end" : "flex-start";
  let num = 0;
  return (
    <div class="absolute inset-0 flex flex-col overflow-hidden px-2 py-1" style={`justify-content:${justify}`}>
      {paragraphs.map((p, i) => {
        num = p.numbered ? num + 1 : 0;
        const indent = (p.level ?? 0) * 24 + (p.bullet || p.numbered ? 22 : 0);
        return (
          <div
            key={i}
            class="relative leading-[1.3] whitespace-pre-wrap break-words"
            style={`text-align:${p.align ?? "left"};padding-left:${indent}px;min-height:1em;${
              (p.bullet || p.numbered) && !(p.level) ? "margin-top:0.3em;" : p.level ? "margin-top:0.1em;" : i > 0 ? "margin-top:0.45em;" : ""
            }`}
          >
            {(p.bullet || p.numbered) && (
              <span class="absolute" style={`left:${(p.level ?? 0) * 24 + 2}px;${p.runs[0]?.size ? `font-size:${p.runs[0].size}pt;` : ""}${p.runs[0]?.color ? `color:${p.runs[0].color}` : ""}`}>
                {p.numbered ? `${num}.` : "•"}
              </span>
            )}
            {p.runs.map((r, j) =>
              r.text === "\n" ? <br key={j} /> : (
                <span
                  key={j}
                  style={[
                    r.bold ? "font-weight:bold" : "",
                    r.italic ? "font-style:italic" : "",
                    r.underline || r.strike
                      ? `text-decoration:${[r.underline ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean).join(" ")}`
                      : "",
                    r.color ? `color:${r.color}` : "",
                    r.size ? `font-size:${r.size}pt` : "",
                    r.font ? `font-family:'${r.font}'` : "",
                  ].filter(Boolean).join(";")}
                >
                  {r.text}
                </span>
              )
            )}
            {p.runs.every((r) => !r.text) && <br />}
          </div>
        );
      })}
    </div>
  );
}

/** One slide, drawn at a scale. Used for the stage and for thumbnails. */
export function SlideView(
  { slide, scale, interactive, selected, editing, onPointerDown, onDoubleClick, editRef }: {
    slide: Slide;
    scale: number;
    interactive?: boolean;
    selected?: string | null;
    editing?: string | null;
    onPointerDown?: (e: PointerEvent, el: SlideElement | null, handle?: string) => void;
    onDoubleClick?: (el: SlideElement) => void;
    editRef?: { current: HTMLDivElement | null };
  },
) {
  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  return (
    <div
      class="relative shadow-lg select-none"
      style={`width:${SLIDE_W * scale}px;height:${SLIDE_H * scale}px;background:${slideBackgroundCss(slide)}`}
    >
      <div
        class="absolute left-0 top-0 origin-top-left"
        style={`width:${SLIDE_W}px;height:${SLIDE_H}px;transform:scale(${scale});font-family:Calibri,Carlito,'Segoe UI',system-ui,sans-serif;font-size:18pt;color:#262626;touch-action:none`}
        onPointerDown={interactive ? (e) => {
          if (e.target === e.currentTarget) onPointerDown?.(e, null);
        } : undefined}
      >
        {slide.elements.map((el) => {
          const isSel = selected === el.id;
          const isEdit = editing === el.id;
          const rot = el.rotation ? `transform:rotate(${el.rotation}deg);` : "";
          return (
            <div
              key={el.id}
              class={`absolute ${interactive ? "cursor-move" : ""}`}
              style={`left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;${rot}${
                el.kind !== "image" && el.kind !== "shape" && el.fill ? `background:${el.fill};` : ""
              }${el.kind === "text" && el.stroke ? `outline:${el.strokeWidth ?? 1}px solid ${el.stroke};` : ""}`}
              onPointerDown={interactive && !isEdit ? (e) => {
                // Without this the browser starts a native drag of any text
                // that happens to be selected, fires pointercancel, and the
                // box stops following the pointer after the first pixel.
                e.preventDefault();
                e.stopPropagation();
                onPointerDown?.(e, el);
              } : undefined}
              onDblClick={interactive && el.kind !== "image" ? (e) => {
                e.stopPropagation();
                onDoubleClick?.(el);
              } : undefined}
            >
              {el.kind === "image" && (
                <img src={el.src} class="w-full h-full object-fill pointer-events-none" draggable={false} alt="" />
              )}
              {el.kind === "shape" && <ShapeSvg el={el} />}
              {el.kind !== "image" && !isEdit && (el.kind === "text" || el.paragraphs) && (
                <TextView paragraphs={el.paragraphs ?? []} valign={el.valign ?? (el.kind === "shape" ? "middle" : undefined)} />
              )}
              {isEdit && (
                <div
                  ref={editRef as never}
                  contentEditable
                  class="absolute inset-0 px-2 py-1 outline-none overflow-hidden slides-edit leading-[1.25]"
                  style={`display:flex;flex-direction:column;justify-content:${
                    (() => {
                      const v = el.kind === "image" ? "top" : (el.valign ?? (el.kind === "shape" ? "middle" : "top"));
                      return v === "middle" ? "center" : v === "bottom" ? "flex-end" : "flex-start";
                    })()
                  }`}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              )}
              {isSel && interactive && !isEdit && (
                <>
                  <div class="absolute inset-0 pointer-events-none" style="outline:2px solid #2563eb;outline-offset:1px" />
                  {handles.map((h) => (
                    <div
                      key={h}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPointerDown?.(e, el, h);
                      }}
                      class="absolute bg-white border-2 border-blue-600 rounded-sm"
                      style={`width:${12 / scale}px;height:${12 / scale}px;${
                        h.includes("n") ? `top:${-6 / scale}px;` : h.includes("s") ? `bottom:${-6 / scale}px;` : `top:calc(50% - ${6 / scale}px);`
                      }${
                        h.includes("w") ? `left:${-6 / scale}px;` : h.includes("e") ? `right:${-6 / scale}px;` : `left:calc(50% - ${6 / scale}px);`
                      }cursor:${h}-resize`}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================ modal */

export default function SlidesModal(
  { lang = "en", onClose, onDeckOpen, revision = 0, incoming, openId }: Props,
) {
  const t = (key: string) => (slidesContent[lang]?.[key] ?? slidesContent.en[key] ?? key) as string;

  const [decks, setDecks] = useState<DeckMeta[]>([]);
  const [id, setId] = useState<string>(() => newDeckId());
  const [name, setName] = useState(t("untitled"));
  const [created, setCreated] = useState<string | undefined>(undefined);
  const [deck, setDeckState] = useState<Deck>(emptyDeck);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [assistantAllowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(0.6);
  const [presenting, setPresenting] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  /** Which picker is open: a new slide, a layout for this one, or a design. */
  const [picker, setPicker] = useState<null | "new" | "layout" | "design">(null);
  const [showNotes, setShowNotes] = useState(false);
  /** Recording for the current slide: idle, running, or being encoded. */
  const [recState, setRecState] = useState<"idle" | "recording" | "encoding">("idle");
  const [recError, setRecError] = useState("");
  const [recSeconds, setRecSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const recorderRef = useRef<Recorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** In the show: play each slide's narration and move on when it ends. */
  const [autoAdvance, setAutoAdvance] = useState(true);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const editRef = useRef<HTMLDivElement | null>(null);
  const savedJson = useRef("");
  const deckRef = useRef(deck);
  // Kept in step with the state on every render. Handlers that live in a
  // setTimeout or a document listener read these, so a keystroke right after
  // a change never sees the state from before it.
  const nameRef = useRef(name);
  const idRef = useRef(id);
  const createdRef = useRef(created);
  const currentRef = useRef(current);
  const editingRef = useRef(editing);
  const history = useRef<{ past: Deck[]; future: Deck[] }>({ past: [], future: [] });
  const drag = useRef<
    | { mode: "move"; id: string; sx: number; sy: number; ox: number; oy: number }
    | { mode: "resize"; id: string; handle: string; sx: number; sy: number; box: { x: number; y: number; w: number; h: number } }
    | null
  >(null);

  deckRef.current = deck;
  nameRef.current = name;
  idRef.current = id;
  createdRef.current = created;
  currentRef.current = current;
  editingRef.current = editing;
  const slide = deck.slides[current] ?? deck.slides[0];
  const sel = slide?.elements.find((e) => e.id === selected) ?? null;

  /** Replaces the deck, remembering the previous state for undo. */
  const setDeck = (next: Deck | ((d: Deck) => Deck), opts: { silent?: boolean } = {}) => {
    const value = typeof next === "function" ? next(deckRef.current) : next;
    if (!opts.silent) {
      history.current.past.push(clone(deckRef.current));
      if (history.current.past.length > HISTORY) history.current.past.shift();
      history.current.future = [];
      setDirty(true);
    }
    deckRef.current = value;
    setDeckState(value);
  };

  const updateSlide = (fn: (s: Slide) => Slide, opts?: { silent?: boolean; current?: number }) => {
    const at = opts?.current ?? current;
    setDeck((d) => ({ ...d, slides: d.slides.map((s, i) => (i === at ? fn(s) : s)) }), opts);
  };

  const updateElement = (elId: string, fn: (e: SlideElement) => SlideElement, opts?: { silent?: boolean; current?: number }) =>
    updateSlide((s) => ({ ...s, elements: s.elements.map((e) => (e.id === elId ? fn(e) : e)) }), opts);

  const undo = () => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(clone(deckRef.current));
    deckRef.current = prev;
    setDeckState(prev);
    setDirty(true);
    setSelected(null);
    setCurrent((c) => Math.min(c, prev.slides.length - 1));
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(clone(deckRef.current));
    deckRef.current = next;
    setDeckState(next);
    setDirty(true);
    setSelected(null);
    setCurrent((c) => Math.min(c, next.slides.length - 1));
  };

  // ------------------------------------------------------------- loading

  const refresh = async () => setDecks(await listDecks());

  useEffect(() => {
    setAllowed(isSlidesAssistantAllowed());
    refresh();
    // Back where it was left, unless something specific was asked for.
    if (incoming || openId) return;
    const last = readLast();
    if (!last) return;
    (async () => {
      const rec = await loadDeck(last.id);
      if (!rec) return;
      load(rec);
      setCurrent(Math.max(0, Math.min(last.slide, rec.deck.slides.length - 1)));
    })();
  }, []);

  // Remember the place, and save every change after a short pause. Closing
  // the window, opening another deck, losing the tab - none of it loses work
  // any more; "Save" is still there for those who want to press it.
  useEffect(() => {
    if (!id) return;
    writeLast(id, current);
  }, [id, current]);

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      autosave();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, deck, name]);

  const load = (rec: { id: string; name: string; deck: Deck; created?: string }) => {
    setId(rec.id);
    setName(rec.name);
    setCreated(rec.created);
    const d = rec.deck.slides.length ? rec.deck : emptyDeck();
    deckRef.current = d;
    setDeckState(d);
    savedJson.current = JSON.stringify(d);
    history.current = { past: [], future: [] };
    setCurrent(0);
    setSelected(null);
    setEditing(null);
    setDirty(false);
  };

  // A tool call changed something behind our back.
  useEffect(() => {
    if (revision === 0) return;
    (async () => {
      await refresh();
      const mine = await loadDeck(id);
      if (mine && JSON.stringify(mine.deck) !== savedJson.current) {
        const keep = current;
        load(mine);
        setCurrent(Math.min(keep, mine.deck.slides.length - 1));
        setStatus(t("changedByAssistant"));
      }
    })();
  }, [revision]);

  useEffect(() => {
    if (!incoming) return;
    (async () => {
      setBusy(true);
      if (dirty) await autosave();
      try {
        const d = await pptxToDeck(incoming.bytes);
        const deckName = await freeDeckName(incoming.name.replace(/\.pptx?$/i, ""));
        const fresh = newDeckId();
        await saveDeck({ id: fresh, name: deckName, deck: d });
        load({ id: fresh, name: deckName, deck: d });
        await refresh();
        setStatus(t("opened"));
      } catch (err) {
        setStatus(`${t("openFailed")}: ${String(err).slice(0, 120)}`);
      } finally {
        setBusy(false);
      }
    })();
  }, [incoming]);

  useEffect(() => {
    if (!openId) return;
    open(openId);
  }, [openId]);

  useEffect(() => {
    onDeckOpen?.(
      decks.find((d) => d.id === id) ??
        { id, name, created: created ?? "", updated: "", slideCount: deck.slides.length },
    );
  }, [id, name, decks]);

  // Fit the stage to the room it has.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth - 24;
      const h = el.clientHeight - 24;
      setScale(Math.max(0.15, Math.min(w / SLIDE_W, h / SLIDE_H, 1.4)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [presenting, sidebarOpen, showNotes]);

  // -------------------------------------------------------------- actions

  /** Saves without ceremony; used by the timer and on the way out. */
  const autosave = async () => {
    const ok = await saveDeck({
      id: idRef.current,
      name: nameRef.current,
      deck: deckRef.current,
      created: createdRef.current,
    });
    if (ok) {
      savedJson.current = JSON.stringify(deckRef.current);
      setDirty(false);
      setStatus(t("autosaved"));
      refresh();
    } else {
      setStatus(t("saveFailed"));
    }
    return ok;
  };

  const save = async () => {
    commitEdit();
    setBusy(true);
    const ok = await saveDeck({
      id: idRef.current,
      name: nameRef.current,
      deck: deckRef.current,
      created: createdRef.current,
    });
    setBusy(false);
    if (ok) {
      savedJson.current = JSON.stringify(deckRef.current);
      setDirty(false);
      setStatus(t("saved"));
      await refresh();
    } else {
      setStatus(t("saveFailed"));
    }
  };

  const open = async (deckId: string) => {
    commitEdit();
    if (dirty) await autosave();
    const rec = await loadDeck(deckId);
    if (!rec) return;
    load(rec);
    setStatus("");
    setSidebarOpen(false);
  };

  const create = async () => {
    commitEdit();
    if (dirty) await autosave();
    load({ id: newDeckId(), name: await freeDeckName(t("untitled")), deck: emptyDeck() });
    setStatus("");
  };

  const remove = async (deckId: string) => {
    if (!confirm(t("confirmDelete"))) return;
    await deleteDeck(deckId);
    const rest = await listDecks();
    setDecks(rest);
    if (deckId === id) {
      if (rest[0]) await open(rest[0].id);
      else await create();
    }
  };

  const download = async () => {
    commitEdit();
    setBusy(true);
    try {
      const bytes = await deckToPptx(deckRef.current, { lang, title: name });
      const blob = new Blob([bytes as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[\\/:*?"<>|]/g, "_")}.pptx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus(t("downloaded"));
    } catch (err) {
      setStatus(`${t("exportFailed")}: ${String(err).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    if (dirty) await autosave();
    if (/\.ppt$/i.test(file.name) && !/\.pptx$/i.test(file.name)) {
      setStatus(t("oldPpt"));
      return;
    }
    if (!/\.pptx$/i.test(file.name)) {
      setStatus(t("unsupportedFile"));
      return;
    }
    setBusy(true);
    try {
      const d = await pptxToDeck(new Uint8Array(await file.arrayBuffer()));
      const deckName = await freeDeckName(file.name.replace(/\.[^.]+$/, ""));
      const fresh = newDeckId();
      await saveDeck({ id: fresh, name: deckName, deck: d });
      load({ id: fresh, name: deckName, deck: d });
      await refresh();
      setStatus(t("imported"));
      setSidebarOpen(false);
    } catch (err) {
      setStatus(`${t("openFailed")}: ${String(err).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------- slide actions

  const themeNow = () => themeOf(deck.theme);

  /** A slide from the picker, with placeholder text in the right places. */
  const addSlideFromLayout = (layout: SlideLayout) => {
    const built = buildSlide(newSlideSpec(layout, lang), themeNow(), () => null, { first: deck.slides.length === 0 }).slide;
    setDeck((d) => ({ ...d, slides: [...d.slides.slice(0, current + 1), built, ...d.slides.slice(current + 1)] }));
    setCurrent(current + 1);
    setSelected(null);
    setPicker(null);
  };

  /** The current slide's content, rearranged. Boxes moved by hand start over. */
  const changeLayout = (layout: SlideLayout) => {
    commitEdit();
    const next = relayoutSlide(deckRef.current.slides[current], layout, themeNow(), lang);
    setDeck((d) => ({ ...d, slides: d.slides.map((sl, i) => (i === current ? next : sl)) }));
    setSelected(null);
    setPicker(null);
  };

  const changeTheme = (key: string) => {
    commitEdit();
    setDeck((d) => applyTheme(d, key));
    setSelected(null);
    setPicker(null);
    setStatus(t("designApplied"));
  };

  const addSlide = (after = current) => {
    const s = emptySlide();
    if (slide?.background) s.background = slide.background;
    setDeck((d) => ({ ...d, slides: [...d.slides.slice(0, after + 1), s, ...d.slides.slice(after + 1)] }));
    setCurrent(after + 1);
    setSelected(null);
  };
  const duplicateSlide = () => {
    const copy = clone(slide);
    copy.id = newSlideId();
    copy.elements.forEach((e) => (e.id = newElementId()));
    setDeck((d) => ({ ...d, slides: [...d.slides.slice(0, current + 1), copy, ...d.slides.slice(current + 1)] }));
    setCurrent(current + 1);
  };
  const deleteSlide = () => {
    if (deck.slides.length <= 1) {
      setDeck((d) => ({ ...d, slides: [emptySlide()] }));
      return;
    }
    setDeck((d) => ({ ...d, slides: d.slides.filter((_, i) => i !== current) }));
    setCurrent(Math.max(0, current - 1));
    setSelected(null);
  };
  const moveSlide = (dir: -1 | 1) => {
    const to = current + dir;
    if (to < 0 || to >= deck.slides.length) return;
    setDeck((d) => {
      const s = [...d.slides];
      [s[current], s[to]] = [s[to], s[current]];
      return { ...d, slides: s };
    });
    setCurrent(to);
  };

  // ----------------------------------------------------- element actions

  const themeFont = THEMES[deck.theme ?? ""]?.bodyFont;
  const addText = () => {
    const el: SlideElement = {
      kind: "text",
      id: newElementId(),
      x: 180,
      y: 200,
      w: 600,
      h: 80,
      paragraphs: [{ runs: [{ text: t("textPlaceholder"), size: 20, ...(themeFont ? { font: themeFont } : {}) }] }],
    };
    updateSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelected(el.id);
    setTimeout(() => startEdit(el.id), 0);
  };
  const addShape = (shape: ShapeKind) => {
    const accent = THEMES[deck.theme ?? ""]?.accent ?? "#2e75b6";
    const el: SlideElement = shape === "line"
      ? { kind: "shape", id: newElementId(), x: 280, y: 268, w: 400, h: 4, shape, stroke: accent, strokeWidth: 3 }
      : { kind: "shape", id: newElementId(), x: 380, y: 170, w: 200, h: 200, shape, fill: accent };
    updateSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelected(el.id);
    setShowShapes(false);
  };
  const insertImage = async (file: File) => {
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Bild nicht lesbar"));
        i.src = dataUrl;
      });
      let src = dataUrl;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_IMAGE_PX || h > MAX_IMAGE_PX) {
        const s = MAX_IMAGE_PX / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")?.drawImage(img, 0, 0, w, h);
        src = c.toDataURL("image/jpeg", 0.85);
      }
      const fit = Math.min(420 / w, 320 / h, 1);
      const ew = Math.round(w * fit), eh = Math.round(h * fit);
      const el: SlideElement = { kind: "image", id: newElementId(), x: Math.round((SLIDE_W - ew) / 2), y: Math.round((SLIDE_H - eh) / 2), w: ew, h: eh, src };
      updateSlide((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelected(el.id);
      setStatus(t("imageAdded"));
    } catch (err) {
      setStatus(`${t("imageFailed")}: ${String(err).slice(0, 90)}`);
    } finally {
      setBusy(false);
    }
  };
  const deleteElement = () => {
    if (!sel) return;
    updateSlide((s) => ({ ...s, elements: s.elements.filter((e) => e.id !== sel.id) }));
    setSelected(null);
  };
  const duplicateElement = () => {
    if (!sel) return;
    const copy = clone(sel);
    copy.id = newElementId();
    copy.x += 20;
    copy.y += 20;
    updateSlide((s) => ({ ...s, elements: [...s.elements, copy] }));
    setSelected(copy.id);
  };
  const reorder = (dir: "front" | "back") => {
    if (!sel) return;
    updateSlide((s) => {
      const rest = s.elements.filter((e) => e.id !== sel.id);
      return { ...s, elements: dir === "front" ? [...rest, sel] : [sel, ...rest] };
    });
  };

  /** Applies a change to every run of the selected element. */
  const restyle = (fn: (r: Run) => Run, pfn?: (p: Paragraph) => Paragraph) => {
    if (!sel || sel.kind === "image") return;
    if (editing === sel.id) {
      // While typing, the browser's own commands act on the selection; the
      // model is read back when editing ends.
      return;
    }
    updateElement(sel.id, (e) => {
      if (e.kind === "image") return e;
      const ps = (e.paragraphs ?? []).map((p) => {
        const q = pfn ? pfn(p) : p;
        return { ...q, runs: q.runs.map(fn) };
      });
      return { ...e, paragraphs: ps };
    });
  };
  const toggleMark = (key: "bold" | "italic" | "underline" | "strike", cmd: string) => {
    if (sel && editing === sel.id) {
      document.execCommand(cmd, false);
      return;
    }
    const on = !dominantRun(sel && sel.kind !== "image" ? sel.paragraphs : [])[key];
    restyle((r) => ({ ...r, [key]: on }));
  };
  const setSize = (size: number) => {
    if (sel && editing === sel.id) {
      document.execCommand("fontSize", false, "7");
      editRef.current?.querySelectorAll('font[size="7"]').forEach((el) => {
        const span = document.createElement("span");
        span.style.fontSize = `${size}pt`;
        span.innerHTML = (el as HTMLElement).innerHTML;
        el.replaceWith(span);
      });
      return;
    }
    restyle((r) => ({ ...r, size }));
  };
  const setColor = (color: string) => {
    if (sel && editing === sel.id) {
      document.execCommand("foreColor", false, color);
      return;
    }
    restyle((r) => ({ ...r, color }));
  };
  const setAlign = (align: Paragraph["align"]) => {
    if (sel && editing === sel.id) {
      document.execCommand(align === "center" ? "justifyCenter" : align === "right" ? "justifyRight" : "justifyLeft", false);
      return;
    }
    restyle((r) => r, (p) => ({ ...p, align }));
  };
  const toggleList = (kind: "bullet" | "numbered") => {
    if (sel && editing === sel.id) {
      document.execCommand(kind === "bullet" ? "insertUnorderedList" : "insertOrderedList", false);
      return;
    }
    const on = !(sel && sel.kind !== "image" && sel.paragraphs?.[0]?.[kind]);
    restyle((r) => r, (p) => ({ ...p, bullet: kind === "bullet" ? on : false, numbered: kind === "numbered" ? on : false }));
  };

  // ------------------------------------------------------------ editing

  const startEdit = (elId: string) => {
    // From the ref, not the render: a box that was added a moment ago is
    // not in this render's slide yet, and this is called right after adding.
    const el = deckRef.current.slides[currentRef.current]?.elements.find((e) => e.id === elId);
    if (!el || el.kind === "image" || (el.kind === "shape" && el.shape === "line")) return;
    setSelected(elId);
    setEditing(elId);
    setTimeout(() => {
      const box = editRef.current;
      if (!box) return;
      box.innerHTML = paragraphsHtml(el.paragraphs ?? [{ runs: [{ text: "" }] }]);
      box.focus();
      const range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      const s = getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, 0);
  };

  const commitEdit = () => {
    const elId = editingRef.current;
    if (!elId) return;
    const box = editRef.current;
    editingRef.current = null;
    setEditing(null);
    if (!box) return;
    const el = deckRef.current.slides[currentRef.current]?.elements.find((e) => e.id === elId);
    if (!el || el.kind === "image") return;
    const base = dominantRun(el.paragraphs);
    const { text: _t, ...baseMarks } = base;
    const paragraphs = htmlToParagraphs(box, baseMarks);
    if (JSON.stringify(paragraphs) !== JSON.stringify(el.paragraphs)) {
      updateElement(elId, (e) => (e.kind === "image" ? e : { ...e, paragraphs }), { current: currentRef.current });
    }
  };

  // ------------------------------------------------------------ pointer

  const onPointerDown = (e: PointerEvent, el: SlideElement | null, handle?: string) => {
    if (editing) commitEdit();
    if (!el) {
      setSelected(null);
      return;
    }
    setSelected(el.id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (handle) {
      drag.current = { mode: "resize", id: el.id, handle, sx: e.clientX, sy: e.clientY, box: { x: el.x, y: el.y, w: el.w, h: el.h } };
    } else {
      drag.current = { mode: "move", id: el.id, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y };
    }
    history.current.past.push(clone(deckRef.current));
    history.current.future = [];
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.sx) / scale;
      const dy = (e.clientY - d.sy) / scale;
      if (d.mode === "move") {
        updateElement(d.id, (el) => ({ ...el, x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) }), { silent: true });
      } else {
        const b = d.box;
        let { x, y, w, h } = b;
        if (d.handle.includes("e")) w = Math.max(10, b.w + dx);
        if (d.handle.includes("s")) h = Math.max(4, b.h + dy);
        if (d.handle.includes("w")) {
          w = Math.max(10, b.w - dx);
          x = b.x + (b.w - w);
        }
        if (d.handle.includes("n")) {
          h = Math.max(4, b.h - dy);
          y = b.y + (b.h - h);
        }
        updateElement(d.id, (el) => ({ ...el, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }), { silent: true });
      }
      setDirty(true);
    };
    const up = () => {
      drag.current = null;
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
    };
  }, [scale, current]);

  // ----------------------------------------------------------- keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = editing || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (presenting) {
        if (e.key === "Escape") setPresenting(false);
        if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") setCurrent((c) => Math.min(c + 1, deckRef.current.slides.length - 1));
        if (e.key === "ArrowLeft" || e.key === "PageUp") setCurrent((c) => Math.max(c - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        if (editing) commitEdit();
        else if (selected) setSelected(null);
        else if (picker) setPicker(null);
        else {
          (async () => {
            if (dirty) await autosave();
            onClose();
          })();
        }
        return;
      }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        sel ? duplicateElement() : duplicateSlide();
        return;
      }
      if (sel && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        deleteElement();
        return;
      }
      if (sel && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        updateElement(sel.id, (el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
        return;
      }
      if (!sel && e.key === "PageDown") setCurrent((c) => Math.min(c + 1, deckRef.current.slides.length - 1));
      if (!sel && e.key === "PageUp") setCurrent((c) => Math.max(c - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, selected, sel, dirty, presenting, current, id, name]);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", before);
    return () => removeEventListener("beforeunload", before);
  }, [dirty]);

  // ----------------------------------------------------------- narration

  const startRec = async () => {
    setRecError("");
    if (!canRecord()) {
      setRecError(t("noMic"));
      return;
    }
    try {
      audioRef.current?.pause();
      setPlaying(false);
      recorderRef.current = await startRecording();
      setRecState("recording");
      setRecSeconds(0);
    } catch (err) {
      setRecError(`${t("micDenied")} (${String(err instanceof Error ? err.message : err).slice(0, 80)})`);
    }
  };

  const stopRec = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecState("encoding");
    try {
      const note: AudioNote = await rec.stop();
      const at = currentRef.current;
      updateSlide((sl) => ({ ...sl, audio: note }), { current: at });
    } catch (err) {
      setRecError(String(err instanceof Error ? err.message : err).slice(0, 120));
    } finally {
      setRecState("idle");
    }
  };

  const deleteAudio = () => {
    audioRef.current?.pause();
    setPlaying(false);
    updateSlide((sl) => {
      const { audio: _a, ...rest } = sl;
      return rest;
    });
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.currentTime = 0;
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  // The seconds tick while recording, and any recording stops with the
  // slide it belongs to: switching slides mid-recording ends it there.
  useEffect(() => {
    if (recState !== "recording") return;
    const timer = setInterval(() => setRecSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [recState]);
  useEffect(() => {
    if (recState === "recording") stopRec();
    audioRef.current?.pause();
    setPlaying(false);
  }, [current]);

  // In the show, the narration plays as each slide comes up.
  useEffect(() => {
    if (!presenting) return;
    const el = audioRef.current;
    if (!el || !slide?.audio) return;
    el.currentTime = 0;
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [presenting, current]);

  // ---------------------------------------------------------------- view

  if (presenting) {
    return (
      <div class="fixed inset-0 bg-black z-[60] flex items-center justify-center" onClick={() => setCurrent((c) => Math.min(c + 1, deck.slides.length - 1))}>
        <div ref={stageRef} class="w-full h-full flex items-center justify-center">
          <SlideView slide={slide} scale={scale} />
        </div>
        <div class="absolute bottom-3 right-4 text-white/60 text-sm select-none flex items-center gap-3">
          {slide?.audio && <span title={t("narration")}>{playing ? "🔊" : "🔈"} {slide.audio.seconds}s</span>}
          <span>{current + 1} / {deck.slides.length} · Esc</span>
        </div>
        {slide?.audio && (
          <audio
            key={slide.id}
            ref={audioRef}
            src={slide.audio.src}
            onEnded={() => {
              setPlaying(false);
              // On to the next slide once the narration is over - the show
              // runs itself, the way a recorded talk should.
              if (autoAdvance && current < deck.slides.length - 1) setTimeout(() => setCurrent((c) => Math.min(c + 1, deck.slides.length - 1)), 600);
            }}
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setPresenting(false);
          }}
          class="absolute top-3 right-4 text-white/70 hover:text-white text-2xl"
          title={t("close")}
        >
          ✕
        </button>
      </div>
    );
  }

  const run = dominantRun(sel && sel.kind !== "image" ? sel.paragraphs : []);
  const textSel = sel && sel.kind !== "image" && !(sel.kind === "shape" && sel.shape === "line");

  return (
    <div class="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-1 md:p-4">
      <div class="bg-white rounded-xl shadow-2xl w-full h-full md:w-[96vw] md:h-[93vh] flex flex-col overflow-hidden relative">
        {/* ---------------------------------------------------- title bar */}
        <header class="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 bg-slate-800 text-white shrink-0">
          <button onClick={() => setSidebarOpen((v) => !v)} title={t("myDecks")} class="p-1.5 rounded hover:bg-white/15 shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
            </svg>
          </button>
          <div class="min-w-0 flex items-baseline gap-2 flex-1">
            <span class="text-2xl leading-none">📊</span>
            <input
              value={name}
              onInput={(e) => {
                setName((e.target as HTMLInputElement).value);
                setDirty(true);
              }}
              title={t("nameHint")}
              class="bg-transparent font-semibold truncate outline-none border-b border-transparent hover:border-white/30 focus:border-white/60 min-w-0 w-full md:w-64"
            />
            {dirty && <span class="text-xs text-amber-300 shrink-0">{t("unsaved")}</span>}
          </div>
          {status && <span class="text-xs text-slate-300 hidden lg:block truncate max-w-xs">{status}</span>}
          <button onClick={() => setPresenting(true)} title={t("present")} class="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold shrink-0">▶</button>
          <button onClick={save} disabled={busy} class="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-sm font-semibold disabled:opacity-50 shrink-0">
            {t("save")}
          </button>
          <button onClick={download} disabled={busy} title={t("downloadHint")} class="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-sm font-semibold disabled:opacity-50 shrink-0 hidden sm:block">
            {t("download")}
          </button>
          <button
            onClick={async () => {
              commitEdit();
              if (dirty) await autosave();
              onClose();
            }}
            title={t("close")}
            class="p-1.5 rounded hover:bg-white/15 shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z" />
            </svg>
          </button>
        </header>

        {/* ------------------------------------------------------ toolbar */}
        <div class="flex flex-wrap items-center gap-1 px-2 md:px-3 py-1.5 border-b bg-slate-50 shrink-0 text-sm">
          <Btn onClick={() => setPicker(picker === "new" ? null : "new")} title={t("newSlide")} label={<span>+ {t("slide")} ▾</span>} active={picker === "new"} />
          <Btn onClick={() => setPicker(picker === "layout" ? null : "layout")} title={t("layoutHint")} label={<span>{t("layout")}</span>} active={picker === "layout"} />
          <Btn onClick={() => setPicker(picker === "design" ? null : "design")} title={t("designHint")} label={<span>🎨 {t("design")}</span>} active={picker === "design"} />
          <Btn onClick={duplicateSlide} title={t("duplicateSlide")} label={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>} />
          <Btn onClick={deleteSlide} title={t("deleteSlide")} label={<span>🗑</span>} />
          <Sep />
          <Btn onClick={addText} title={t("addText")} label={<span class="font-serif font-bold">T</span>} />
          <div class="relative">
            <Btn onClick={() => setShowShapes((v) => !v)} title={t("addShape")} label={<span>◯▭</span>} />
            {showShapes && (
              <div class="absolute z-20 top-8 left-0 bg-white border rounded-lg shadow-lg p-1.5 grid grid-cols-5 gap-1 w-44">
                {SHAPES.map((s) => (
                  <button key={s.kind} onClick={() => addShape(s.kind)} class="h-7 rounded hover:bg-slate-100 text-base" title={s.kind}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Btn onClick={() => imageRef.current?.click()} title={t("addImage")} label={<span>🖼️</span>} />
          <Sep />
          <Btn onClick={undo} title={t("undo")} label={<span>↶</span>} />
          <Btn onClick={redo} title={t("redo")} label={<span>↷</span>} />

          {textSel && (
            <>
              <Sep />
              <Btn onClick={() => toggleMark("bold", "bold")} title={t("bold")} label={<b>B</b>} active={!!run.bold} />
              <Btn onClick={() => toggleMark("italic", "italic")} title={t("italic")} label={<i>I</i>} active={!!run.italic} />
              <Btn onClick={() => toggleMark("underline", "underline")} title={t("underline")} label={<u>U</u>} active={!!run.underline} />
              <Btn onClick={() => toggleMark("strike", "strikeThrough")} title={t("strike")} label={<s>S</s>} active={!!run.strike} />
              <select
                value={String(run.size ?? "")}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = Number((e.target as HTMLSelectElement).value);
                  if (v) setSize(v);
                }}
                class="border rounded px-1 py-0.5 bg-white w-16 h-7"
                title={t("size")}
              >
                <option value="">{t("size")}</option>
                {SIZES.map((s) => <option key={s} value={String(s)}>{s}</option>)}
              </select>
              <input type="color" value={run.color ?? "#262626"} onInput={(e) => setColor((e.target as HTMLInputElement).value)} title={t("color")} class="w-7 h-7 rounded border bg-white cursor-pointer p-0.5" />
              <Btn onClick={() => setAlign("left")} title={t("alignLeft")} label={<span>≡</span>} />
              <Btn onClick={() => setAlign("center")} title={t("alignCenter")} label={<span>☰</span>} />
              <Btn onClick={() => setAlign("right")} title={t("alignRight")} label={<span>≣</span>} />
              <Btn onClick={() => toggleList("bullet")} title={t("bullets")} label={<span>•—</span>} />
              <Btn onClick={() => toggleList("numbered")} title={t("numbers")} label={<span>1.—</span>} />
            </>
          )}
          {sel && sel.kind !== "image" && (
            <>
              <Sep />
              <label class="flex items-center gap-1 text-xs text-slate-600" title={t("fill")}>
                {t("fill")}
                <input
                  type="color"
                  value={sel.fill ?? "#ffffff"}
                  onInput={(e) => updateElement(sel.id, (el) => ({ ...el, fill: (e.target as HTMLInputElement).value }))}
                  class="w-7 h-7 rounded border bg-white cursor-pointer p-0.5"
                />
                <button onClick={() => updateElement(sel.id, (el) => ({ ...el, fill: undefined }))} class="text-slate-400 hover:text-slate-700" title={t("noFill")}>∅</button>
              </label>
              <label class="flex items-center gap-1 text-xs text-slate-600" title={t("stroke")}>
                {t("stroke")}
                <input
                  type="color"
                  value={sel.stroke ?? "#000000"}
                  onInput={(e) => updateElement(sel.id, (el) => ({ ...el, stroke: (e.target as HTMLInputElement).value, strokeWidth: (el as { strokeWidth?: number }).strokeWidth ?? 2 }))}
                  class="w-7 h-7 rounded border bg-white cursor-pointer p-0.5"
                />
                <button onClick={() => updateElement(sel.id, (el) => ({ ...el, stroke: undefined }))} class="text-slate-400 hover:text-slate-700" title={t("noStroke")}>∅</button>
              </label>
            </>
          )}
          {sel && (
            <>
              <Sep />
              <Btn onClick={() => reorder("front")} title={t("front")} label={<span>⬆</span>} />
              <Btn onClick={() => reorder("back")} title={t("back")} label={<span>⬇</span>} />
              <Btn onClick={duplicateElement} title={t("duplicate")} label={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>} />
              <Btn onClick={deleteElement} title={t("deleteElement")} label={<span class="text-red-600">✕</span>} />
            </>
          )}
          <div class="flex-1" />
          <label class="flex items-center gap-1 text-xs text-slate-600" title={t("background")}>
            {t("background")}
            <input
              type="color"
              value={slide?.background ?? "#ffffff"}
              onInput={(e) => updateSlide((s) => ({ ...s, background: (e.target as HTMLInputElement).value }))}
              class="w-7 h-7 rounded border bg-white cursor-pointer p-0.5"
            />
          </label>
          <Btn onClick={() => setShowNotes((v) => !v)} title={t("notes")} label={<span>📝</span>} active={showNotes} />
          <span class="text-xs text-slate-500 px-1 hidden md:inline">
            {t("slideOf").replace("{n}", String(current + 1)).replace("{m}", String(deck.slides.length))}
          </span>
        </div>

        {/* --------------------------------------------- body: side + page */}
        <div class="flex-1 flex flex-col md:flex-row min-h-0 relative">
          {sidebarOpen && (
            <>
              <div class="md:hidden absolute inset-0 bg-black/30 z-20" onClick={() => setSidebarOpen(false)} />
              <aside class="absolute md:static z-30 left-0 top-0 bottom-0 w-72 md:w-72 shrink-0 border-r bg-white overflow-y-auto shadow-xl md:shadow-none">
                <div class="p-3 space-y-4">
                  <section>
                    <div class="flex items-center justify-between mb-1.5">
                      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("myDecks")}</h3>
                      <button onClick={create} title={t("newDeck")} class="px-2 py-0.5 rounded-md bg-green-100 text-green-800 hover:bg-green-200 text-sm font-bold leading-none">+</button>
                    </div>
                    <p class="text-xs text-slate-500 mb-2">{t("decksHint")}</p>
                    {decks.length === 0 ? <p class="text-sm text-slate-400">{t("noDecks")}</p> : (
                      <ul class="space-y-0.5">
                        {decks.map((d) => (
                          <li key={d.id} class="group flex items-center gap-1">
                            <button onClick={() => open(d.id)} class={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md text-sm ${d.id === id ? "bg-blue-50 text-blue-900 font-semibold" : "hover:bg-slate-100"}`}>
                              <span class="block truncate">{d.name}</span>
                              <span class="block text-xs text-slate-400">{d.slideCount} {t("slides")}</span>
                            </button>
                            <button onClick={() => remove(d.id)} title={t("delete")} class="md:opacity-0 group-hover:opacity-100 px-1.5 py-1 text-red-600 hover:bg-red-50 rounded text-xs shrink-0">✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section class="space-y-2">
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("fileSection")}</h3>
                    <button onClick={() => fileRef.current?.click()} class="w-full text-left px-2.5 py-2 border border-slate-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/60 text-sm">
                      {t("importFile")}
                      <span class="block text-xs text-slate-500">{t("importHint")}</span>
                    </button>
                    <button onClick={download} class="w-full text-left px-2.5 py-2 border border-slate-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/60 text-sm">
                      {t("exportPptx")}
                      <span class="block text-xs text-slate-500">{t("exportHint")}</span>
                    </button>
                  </section>
                  <section>
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{t("assistantSection")}</h3>
                    <label class="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={assistantAllowed}
                        onChange={(e) => {
                          const on = (e.target as HTMLInputElement).checked;
                          setSlidesAssistantAllowed(on);
                          setAllowed(on);
                        }}
                        class="mt-0.5"
                      />
                      <span>
                        {t("allowAssistant")}
                        <span class="block text-xs text-slate-500">{t("allowAssistantHint")}</span>
                      </span>
                    </label>
                  </section>
                </div>
              </aside>
            </>
          )}

          {/* Thumbnails: a strip along the side, or along the top on a phone. */}
          <div class="shrink-0 md:w-40 border-b md:border-b-0 md:border-r bg-slate-100 overflow-x-auto md:overflow-y-auto flex md:flex-col gap-2 p-2">
            {deck.slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  commitEdit();
                  setCurrent(i);
                  setSelected(null);
                }}
                class={`relative shrink-0 rounded-md p-1 ${i === current ? "ring-2 ring-blue-500 bg-white" : "hover:bg-slate-200"}`}
                title={`${i + 1}`}
              >
                <div class="pointer-events-none">
                  <SlideView slide={s} scale={0.125} />
                </div>
                <span class="absolute left-0.5 bottom-0.5 text-[10px] bg-black/50 text-white rounded px-1 leading-4">{i + 1}</span>
                {s.audio && <span class="absolute right-0.5 bottom-0.5 text-[10px] bg-black/50 text-white rounded px-1 leading-4" title={`${s.audio.seconds}s`}>🔊</span>}
              </button>
            ))}
            <div class="shrink-0 flex md:flex-row gap-1 justify-center">
              <button onClick={() => moveSlide(-1)} class="text-xs px-1.5 py-0.5 rounded bg-white border hover:bg-slate-50" title={t("moveUp")}>◀</button>
              <button onClick={() => addSlide()} class="text-xs px-1.5 py-0.5 rounded bg-white border hover:bg-slate-50" title={t("newSlide")}>+</button>
              <button onClick={() => moveSlide(1)} class="text-xs px-1.5 py-0.5 rounded bg-white border hover:bg-slate-50" title={t("moveDown")}>▶</button>
            </div>
          </div>

          {/* The stage. */}
          <div class="flex-1 min-h-0 flex flex-col relative">
            {picker && (
              <div class="absolute inset-0 z-20 bg-slate-900/40 flex items-start justify-center p-3 overflow-y-auto" onClick={() => setPicker(null)}>
                <div class="bg-white rounded-xl shadow-2xl p-3 md:p-4 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
                  <div class="flex items-center justify-between mb-2">
                    <h3 class="font-semibold text-slate-800">
                      {picker === "design" ? t("design") : picker === "layout" ? t("changeLayout") : t("newFromLayout")}
                    </h3>
                    <button onClick={() => setPicker(null)} class="px-2 text-slate-500 hover:text-slate-800">✕</button>
                  </div>
                  {picker === "design"
                    ? (
                      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {Object.values(THEMES).map((th) => {
                          const sample = buildSlide(
                            { layout: "title", title: th.label[lang === "en" ? "en" : "de"], subtitle: "Aa Bb Cc" },
                            th,
                            () => null,
                          ).slide;
                          return (
                            <button
                              key={th.key}
                              onClick={() => changeTheme(th.key)}
                              class={`rounded-lg border p-1.5 text-left hover:border-blue-400 hover:bg-blue-50/60 ${deck.theme === th.key ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200"}`}
                            >
                              <div class="pointer-events-none mx-auto" style="width:160px">
                                <SlideView slide={sample} scale={160 / SLIDE_W} />
                              </div>
                              <span class="block text-xs mt-1 text-slate-700 truncate">{th.label[lang === "en" ? "en" : "de"]}</span>
                            </button>
                          );
                        })}
                      </div>
                    )
                    : (
                      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                        {LAYOUTS.map((l) => {
                          const sample = buildSlide(newSlideSpec(l.key, lang), themeNow(), () => null, { first: l.key === "title" }).slide;
                          return (
                            <button
                              key={l.key}
                              onClick={() => picker === "new" ? addSlideFromLayout(l.key) : changeLayout(l.key)}
                              class={`rounded-lg border p-1.5 text-left hover:border-blue-400 hover:bg-blue-50/60 ${picker === "layout" && slide?.layout === l.key ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200"}`}
                              title={l.key}
                            >
                              <div class="pointer-events-none mx-auto" style="width:128px">
                                <SlideView slide={sample} scale={128 / SLIDE_W} />
                              </div>
                              <span class="block text-xs mt-1 text-slate-700 truncate">{lang === "en" ? l.en : l.de}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                </div>
              </div>
            )}
            {/* The desk around the slide: a click there ends editing and
                clears the selection, as it does in every slide program. */}
            <div
              ref={stageRef}
              class="flex-1 min-h-0 overflow-hidden bg-slate-200 flex items-center justify-center p-3"
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                commitEdit();
                setSelected(null);
              }}
            >
              {slide && (
                <SlideView
                  slide={slide}
                  scale={scale}
                  interactive
                  selected={selected}
                  editing={editing}
                  onPointerDown={onPointerDown}
                  onDoubleClick={(el) => startEdit(el.id)}
                  editRef={editRef}
                />
              )}
            </div>
            {showNotes && (
              <textarea
                value={slide?.notes ?? ""}
                onInput={(e) => updateSlide((s) => ({ ...s, notes: (e.target as HTMLTextAreaElement).value }))}
                placeholder={t("notesHint")}
                class="shrink-0 h-24 md:h-28 border-t px-3 py-2 text-sm outline-none resize-none bg-amber-50/60"
              />
            )}
            {/* The narration strip: record, listen, record again. */}
            <div class="shrink-0 border-t bg-slate-50 px-3 py-1.5 flex flex-wrap items-center gap-2 text-sm" data-narration>
              <span class="font-semibold text-slate-700">🎙 {t("narration")}</span>
              {recState === "recording"
                ? (
                  <button onClick={stopRec} class="px-3 py-1 rounded-lg bg-red-600 text-white font-semibold animate-pulse" title={t("recording")}>
                    ■ {t("stop")} · {recSeconds}s
                  </button>
                )
                : recState === "encoding"
                ? <span class="text-slate-500">{t("encoding")}</span>
                : (
                  <button onClick={startRec} class="px-3 py-1 rounded-lg bg-red-100 text-red-800 hover:bg-red-200 font-semibold" title={slide?.audio ? t("rerecord") : t("record")}>
                    ● {slide?.audio ? t("rerecord") : t("record")}
                  </button>
                )}
              {slide?.audio && recState === "idle" && (
                <>
                  <button onClick={togglePlay} class="px-3 py-1 rounded-lg bg-white border hover:bg-slate-100" title={playing ? t("pause") : t("play")}>
                    {playing ? "⏸" : "▶"} {playing ? t("pause") : t("play")}
                  </button>
                  <span class="text-xs text-slate-500">{slide.audio.seconds}s · {audioKb(slide.audio)} KB</span>
                  <button onClick={deleteAudio} class="px-2 py-1 rounded text-red-600 hover:bg-red-50 text-xs" title={t("deleteAudio")}>✕</button>
                  <audio key={slide.id} ref={audioRef} src={slide.audio.src} onEnded={() => setPlaying(false)} />
                </>
              )}
              {recError && <span class="text-xs text-red-700">{recError}</span>}
              {!recError && !slide?.audio && recState === "idle" && <span class="text-xs text-slate-500 hidden md:inline">{t("narrationHint")}</span>}
              <span class="flex-1" />
              <label class="text-xs text-slate-600 flex items-center gap-1" title={t("autoAdvance")}>
                <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance((e.target as HTMLInputElement).checked)} />
                {t("autoAdvance")}
              </label>
            </div>
            <p class="shrink-0 text-[11px] text-slate-500 px-3 py-1 border-t bg-white hidden md:block">{t("hint")}</p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".pptx,.ppt"
          class="hidden"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) importFile(f);
            (e.target as HTMLInputElement).value = "";
          }}
        />
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          class="hidden"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) insertImage(f);
            (e.target as HTMLInputElement).value = "";
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- small bits */

function Btn(
  { onClick, title, label, active }: { onClick: () => void; title: string; label: preact.ComponentChildren; active?: boolean },
) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()} // keep the selection
      onClick={onClick}
      title={title}
      class={`min-w-[30px] h-7 px-1.5 rounded border flex items-center justify-center ${
        active ? "bg-blue-100 border-blue-300 text-blue-900" : "border-slate-200 bg-white hover:bg-slate-100 hover:border-slate-300 text-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

function Sep() {
  return <span class="w-px h-5 bg-slate-300 mx-0.5" />;
}

export { imageSize };
