// components/DocsModal.tsx
//
// A small word processor, in the same overlay style as the notebook.
//
// The editing surface is a contenteditable div driven by document.execCommand.
// That interface is marked deprecated and is nonetheless the only one every
// browser implements, needs no dependency, and gives undo, selection handling
// and IME support for free. A library would have to be loaded from a CDN,
// which the strict content policy here does not allow, and would still leave
// the .docx conversion to us.
//
// Documents live in IndexedDB (docStore.ts) and travel as .docx in and out
// (docxRich.ts). The assistant sees the names of the documents and can open
// and edit one when it is allowed to - never their contents unasked.

import { useEffect, useRef, useState } from "preact/hooks";
import { docsContent } from "../internalization/content.ts";
import {
  deleteDoc,
  type DocMeta,
  freeName,
  listDocs,
  loadDoc,
  newDocId,
  saveDoc,
} from "../utils/docStore.ts";
import { docxToHtml, htmlToDocx, htmlToPlainText } from "../utils/docxRich.ts";
import {
  DOCS_PERMISSION_KEY,
  isDocsAssistantAllowed,
  setDocsAssistantAllowed,
} from "../utils/docsTools.ts";

/** Font choices. Web-safe on purpose: a .docx names a font by string, and a
 * name the reader's Word does not have is silently replaced by something
 * else - so the list stays with faces that exist nearly everywhere. */
const FONTS = [
  "Calibri",
  "Arial",
  "Times New Roman",
  "Georgia",
  "Verdana",
  "Courier New",
];

const SIZES = [12, 14, 16, 18, 24, 32, 40];

/** How large a picture may be before it is scaled down on the way in. */
const MAX_IMAGE_PX = 1600;

interface Props {
  lang?: string;
  onClose: () => void;
  /** Tells the chat which document the assistant should act on. */
  onDocOpen?: (meta: DocMeta | null) => void;
  /** Bumped by the chat after a tool changed something, so we re-read. */
  revision?: number;
  /** Opened straight away: a .docx the assistant produced. */
  incoming?: { name: string; bytes: Uint8Array } | null;
  /** Opened straight away: a document already in the store. */
  openId?: string;
}

export default function DocsModal(
  { lang = "en", onClose, onDocOpen, revision = 0, incoming, openId }: Props,
) {
  const t = (key: string) =>
    (docsContent[lang]?.[key] ?? docsContent.en[key] ?? key) as string;

  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [id, setId] = useState<string>(() => newDocId());
  const [name, setName] = useState(t("untitled"));
  const [created, setCreated] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assistantAllowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);

  const areaRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const savedHtml = useRef("");

  // ------------------------------------------------------------- loading

  const refresh = async () => setDocs(await listDocs());

  useEffect(() => {
    setAllowed(isDocsAssistantAllowed());
    refresh();
  }, []);

  // A tool call changed something behind our back.
  useEffect(() => {
    if (revision === 0) return;
    (async () => {
      await refresh();
      const mine = await loadDoc(id);
      if (mine && mine.html !== savedHtml.current) {
        setHtml(mine.html);
        setName(mine.name);
        savedHtml.current = mine.html;
        setDirty(false);
        setStatus(t("changedByAssistant"));
      }
    })();
  }, [revision]);

  useEffect(() => {
    if (!incoming) return;
    (async () => {
      setBusy(true);
      try {
        const html = await docxToHtml(incoming.bytes);
        const docName = await freeName(incoming.name.replace(/\.docx?$/i, ""));
        const fresh = newDocId();
        setId(fresh);
        setName(docName);
        setCreated(undefined);
        setHtml(html);
        savedHtml.current = html;
        await saveDoc({ id: fresh, name: docName, html });
        await refresh();
        setDirty(false);
        setStatus(t("opened"));
        setSidebarOpen(false);
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

  // Tell the chat which document is on screen, so a tool call knows.
  useEffect(() => {
    onDocOpen?.(
      docs.find((d) => d.id === id) ??
        { id, name, created: created ?? "", updated: "", chars: 0 },
    );
  }, [id, name, docs]);

  /** Writes into the editable area without going through Preact. */
  const setHtml = (html: string) => {
    if (areaRef.current) areaRef.current.innerHTML = html || "<p><br></p>";
  };

  const getHtml = () => areaRef.current?.innerHTML ?? "";

  // -------------------------------------------------------------- actions

  const exec = (command: string, value?: string) => {
    areaRef.current?.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      // A browser that refuses a command should not take the editor down.
    }
    setDirty(true);
  };

  const save = async () => {
    const html = getHtml();
    setBusy(true);
    const ok = await saveDoc({ id, name, html, created });
    setBusy(false);
    if (ok) {
      savedHtml.current = html;
      setDirty(false);
      setStatus(t("saved"));
      await refresh();
    } else {
      // Never claim it is safe when it is not - the writer would close it.
      setStatus(t("saveFailed"));
    }
  };

  const open = async (docId: string) => {
    if (dirty && !confirm(t("confirmDiscard"))) return;
    const doc = await loadDoc(docId);
    if (!doc) return;
    setId(doc.id);
    setName(doc.name);
    setCreated(doc.created);
    setHtml(doc.html);
    savedHtml.current = doc.html;
    setDirty(false);
    setStatus("");
  };

  const create = async () => {
    if (dirty && !confirm(t("confirmDiscard"))) return;
    const fresh = newDocId();
    setId(fresh);
    setName(await freeName(t("untitled")));
    setCreated(undefined);
    setHtml("<p><br></p>");
    savedHtml.current = "";
    setDirty(false);
    setStatus("");
    areaRef.current?.focus();
  };

  const remove = async (docId: string) => {
    if (!confirm(t("confirmDelete"))) return;
    await deleteDoc(docId);
    const rest = await listDocs();
    setDocs(rest);
    if (docId === id) {
      if (rest[0]) await open(rest[0].id);
      else await create();
    }
  };

  /** Hands the document to the browser as a .docx download. */
  const download = async () => {
    setBusy(true);
    try {
      const bytes = await htmlToDocx(getHtml());
      const blob = new Blob([bytes as BlobPart], {
        type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[\\/:*?"<>|]/g, "_")}.docx`;
      a.click();
      // Revoked late: Safari needs the URL to still exist when it starts.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus(t("downloaded"));
    } catch (err) {
      setStatus(`${t("exportFailed")}: ${String(err).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  };

  /** Reads a .docx or plain text from the reader's own computer. */
  const importFile = async (file: File) => {
    setBusy(true);
    try {
      let html: string;
      if (/\.docx$/i.test(file.name)) {
        html = await docxToHtml(new Uint8Array(await file.arrayBuffer()));
      } else if (/\.(txt|md|html?)$/i.test(file.name)) {
        const text = await file.text();
        html = /\.html?$/i.test(file.name)
          ? text
          : text.split(/\n{2,}/).map((p) =>
            `<p>${p.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))
              .replace(/\n/g, "<br>")}</p>`
          ).join("");
      } else {
        setStatus(t("unsupportedFile"));
        return;
      }
      const docName = await freeName(file.name.replace(/\.[^.]+$/, ""));
      const fresh = newDocId();
      setId(fresh);
      setName(docName);
      setCreated(undefined);
      setHtml(html);
      savedHtml.current = html;
      await saveDoc({ id: fresh, name: docName, html });
      await refresh();
      setDirty(false);
      setStatus(t("imported"));
    } catch (err) {
      setStatus(`${t("openFailed")}: ${String(err).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Puts a picture into the document.
   *
   * Scaled down on the way in: a photograph straight from a phone is four
   * thousand pixels wide, and three of those would fill the storage quota on
   * their own. The width and height are written out, so the .docx keeps the
   * proportions instead of guessing them.
   */
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
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX_IMAGE_PX || h > MAX_IMAGE_PX) {
        const scale = MAX_IMAGE_PX / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        src = canvas.toDataURL("image/jpeg", 0.85);
      }
      // A sensible width on the page, with the true ratio kept.
      const shown = Math.min(w, 520);
      const shownH = Math.round(h * (shown / w));
      exec(
        "insertHTML",
        `<p><img src="${src}" width="${shown}" height="${shownH}" ` +
          `style="max-width: 100%"></p>`,
      );
      setStatus(t("imageAdded"));
    } catch (err) {
      setStatus(`${t("imageFailed")}: ${String(err).slice(0, 90)}`);
    } finally {
      setBusy(false);
    }
  };

  const insertTable = () => {
    const rows = 3, cols = 3;
    const head = `<tr>${
      Array.from({ length: cols }, (_, i) => `<th>Spalte ${i + 1}</th>`).join("")
    }</tr>`;
    const body = Array.from({ length: rows - 1 }, () =>
      `<tr>${Array.from({ length: cols }, () => "<td>&nbsp;</td>").join("")}</tr>`).join("");
    exec("insertHTML", `<table>${head}${body}</table><p><br></p>`);
  };

  // Ctrl+S saves, which is what everyone tries first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
      if (e.key === "Escape" && !dirty) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dirty, id, name]);

  // Warn before the window closes with unsaved work in it.
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

  const words = () => {
    const text = htmlToPlainText(getHtml());
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  };

  // ----------------------------------------------------------------- view

  return (
    <div class="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 md:p-4">
      <div class="bg-white rounded-xl shadow-2xl w-[96vw] h-[93vh] flex flex-col overflow-hidden">
        {/* ---------------------------------------------------- title bar */}
        <header class="flex items-center gap-3 px-4 py-2.5 bg-slate-800 text-white shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={t("myDocs")}
            class="p-1.5 rounded hover:bg-white/15 shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
            </svg>
          </button>

          <div class="min-w-0 flex items-baseline gap-2">
            <span class="text-2xl leading-none">📄</span>
            <input
              value={name}
              onInput={(e) => {
                setName((e.target as HTMLInputElement).value);
                setDirty(true);
              }}
              title={t("nameHint")}
              class="bg-transparent font-semibold truncate outline-none
                     border-b border-transparent hover:border-white/30
                     focus:border-white/60 min-w-0 w-40 md:w-64"
            />
            {dirty && (
              <span class="text-xs text-amber-300 shrink-0">{t("unsaved")}</span>
            )}
          </div>

          <div class="flex-1" />
          {status && (
            <span class="text-xs text-slate-300 hidden md:block truncate max-w-xs">
              {status}
            </span>
          )}
          <button
            onClick={save}
            disabled={busy}
            class="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400
                   text-sm font-semibold disabled:opacity-50 shrink-0"
          >
            {t("save")}
          </button>
          <button
            onClick={download}
            disabled={busy}
            title={t("downloadHint")}
            class="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400
                   text-sm font-semibold disabled:opacity-50 shrink-0"
          >
            {t("download")}
          </button>
          <button
            onClick={() => {
              if (dirty && !confirm(t("confirmDiscard"))) return;
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
        <div class="flex flex-wrap items-center gap-1 px-3 py-2 border-b bg-slate-50 shrink-0 text-sm">
          <select
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              exec("formatBlock", v);
              (e.target as HTMLSelectElement).value = "";
            }}
            class="border rounded px-1.5 py-1 bg-white"
            title={t("paragraphStyle")}
          >
            <option value="">{t("paragraphStyle")}</option>
            <option value="<p>">{t("styleBody")}</option>
            <option value="<h1>">{t("styleH1")}</option>
            <option value="<h2>">{t("styleH2")}</option>
            <option value="<h3>">{t("styleH3")}</option>
            <option value="<blockquote>">{t("styleQuote")}</option>
          </select>

          <select
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v) exec("fontName", v);
            }}
            class="border rounded px-1.5 py-1 bg-white"
            title={t("font")}
          >
            <option value="">{t("font")}</option>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>

          <select
            onChange={(e) => {
              const px = (e.target as HTMLSelectElement).value;
              if (!px) return;
              // execCommand's fontSize only knows 1-7, so the size is set as
              // a style on the selection instead - which is also what the
              // .docx writer reads back out.
              document.execCommand("fontSize", false, "7");
              const area = areaRef.current;
              area?.querySelectorAll('font[size="7"]').forEach((el) => {
                const span = document.createElement("span");
                span.style.fontSize = `${px}px`;
                span.innerHTML = (el as HTMLElement).innerHTML;
                el.replaceWith(span);
              });
              setDirty(true);
            }}
            class="border rounded px-1.5 py-1 bg-white w-16"
            title={t("size")}
          >
            <option value="">{t("size")}</option>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <Sep />
          <Btn onClick={() => exec("bold")} title={t("bold")} label={<b>B</b>} />
          <Btn onClick={() => exec("italic")} title={t("italic")} label={<i>I</i>} />
          <Btn
            onClick={() => exec("underline")}
            title={t("underline")}
            label={<u>U</u>}
          />
          <Btn
            onClick={() => exec("strikeThrough")}
            title={t("strike")}
            label={<s>S</s>}
          />
          <Btn
            onClick={() => exec("superscript")}
            title={t("superscript")}
            label={<span>x²</span>}
          />
          <Btn
            onClick={() => exec("subscript")}
            title={t("subscript")}
            label={<span>x₂</span>}
          />
          <input
            type="color"
            onChange={(e) => exec("foreColor", (e.target as HTMLInputElement).value)}
            title={t("color")}
            class="w-7 h-7 rounded border bg-white cursor-pointer p-0.5"
          />

          <Sep />
          <Btn
            onClick={() => exec("insertUnorderedList")}
            title={t("bullets")}
            label={<span>• —</span>}
          />
          <Btn
            onClick={() => exec("insertOrderedList")}
            title={t("numbers")}
            label={<span>1. —</span>}
          />
          <Btn onClick={() => exec("outdent")} title={t("outdent")} label={<span>⇤</span>} />
          <Btn onClick={() => exec("indent")} title={t("indent")} label={<span>⇥</span>} />

          <Sep />
          <Btn
            onClick={() => exec("justifyLeft")}
            title={t("alignLeft")}
            label={<AlignIcon kind="left" />}
          />
          <Btn
            onClick={() => exec("justifyCenter")}
            title={t("alignCenter")}
            label={<AlignIcon kind="center" />}
          />
          <Btn
            onClick={() => exec("justifyRight")}
            title={t("alignRight")}
            label={<AlignIcon kind="right" />}
          />
          <Btn
            onClick={() => exec("justifyFull")}
            title={t("alignJustify")}
            label={<AlignIcon kind="justify" />}
          />

          <Sep />
          <Btn
            onClick={() => imageRef.current?.click()}
            title={t("image")}
            label={<span>🖼️</span>}
          />
          <Btn onClick={insertTable} title={t("table")} label={<span>▦</span>} />
          <Btn
            onClick={() => exec("insertHorizontalRule")}
            title={t("pageBreak")}
            label={<span>⎯</span>}
          />
          <Btn
            onClick={() => exec("removeFormat")}
            title={t("clearFormat")}
            label={<span>⌫ᴬ</span>}
          />

          <div class="flex-1" />
          <span class="text-xs text-slate-500 px-1">
            {words()} {t("words")}
          </span>
        </div>

        {/* --------------------------------------------- body: side + page */}
        <div class="flex-1 flex min-h-0">
          {sidebarOpen && (
            <aside class="w-60 md:w-72 shrink-0 border-r bg-white overflow-y-auto">
              <div class="p-3 space-y-4">
                <section>
                  <div class="flex items-center justify-between mb-1.5">
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("myDocs")}
                    </h3>
                    <button
                      onClick={create}
                      title={t("newDoc")}
                      class="px-2 py-0.5 rounded-md bg-green-100 text-green-800
                             hover:bg-green-200 text-sm font-bold leading-none"
                    >
                      +
                    </button>
                  </div>
                  <p class="text-xs text-slate-500 mb-2">{t("docsHint")}</p>
                  {docs.length === 0
                    ? <p class="text-sm text-slate-400">{t("noDocs")}</p>
                    : (
                      <ul class="space-y-0.5">
                        {docs.map((d) => (
                          <li key={d.id} class="group flex items-center gap-1">
                            <button
                              onClick={() => open(d.id)}
                              class={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md text-sm ${
                                d.id === id
                                  ? "bg-blue-50 text-blue-900 font-semibold"
                                  : "hover:bg-slate-100"
                              }`}
                            >
                              <span class="block truncate">{d.name}</span>
                              <span class="block text-xs text-slate-400">
                                {d.chars} {t("chars")}
                              </span>
                            </button>
                            <button
                              onClick={() => remove(d.id)}
                              title={t("delete")}
                              class="opacity-0 group-hover:opacity-100 px-1.5 py-1
                                     text-red-600 hover:bg-red-50 rounded text-xs shrink-0"
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                </section>

                <section class="space-y-2">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("fileSection")}
                  </h3>
                  <button
                    onClick={() => fileRef.current?.click()}
                    class="w-full text-left px-2.5 py-2 border border-slate-200 rounded-lg
                           hover:border-blue-400 hover:bg-blue-50/60 text-sm"
                  >
                    {t("importFile")}
                    <span class="block text-xs text-slate-500">
                      {t("importHint")}
                    </span>
                  </button>
                  <button
                    onClick={download}
                    class="w-full text-left px-2.5 py-2 border border-slate-200 rounded-lg
                           hover:border-blue-400 hover:bg-blue-50/60 text-sm"
                  >
                    {t("exportDocx")}
                    <span class="block text-xs text-slate-500">
                      {t("exportHint")}
                    </span>
                  </button>
                </section>

                <section>
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                    {t("assistantSection")}
                  </h3>
                  <label class="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={assistantAllowed}
                      onChange={(e) => {
                        const on = (e.target as HTMLInputElement).checked;
                        setDocsAssistantAllowed(on);
                        setAllowed(on);
                      }}
                      class="mt-0.5"
                    />
                    <span>
                      {t("allowAssistant")}
                      <span class="block text-xs text-slate-500">
                        {t("allowAssistantHint")}
                      </span>
                    </span>
                  </label>
                </section>
              </div>
            </aside>
          )}

          {/* The page itself, on a grey desk like a word processor. */}
          <div class="flex-1 overflow-y-auto bg-slate-100 p-3 md:p-6">
            <div
              ref={areaRef}
              contentEditable
              spellcheck
              onInput={() => setDirty(true)}
              onPaste={(e) => {
                // Paste as text unless it is HTML we can keep - a paste from
                // Word otherwise brings hundreds of style attributes along.
                const html = e.clipboardData?.getData("text/html");
                if (!html) return;
                e.preventDefault();
                const clean = html
                  .replace(/<!--[\s\S]*?-->/g, "")
                  .replace(/<\/?(o:p|xml|meta|link|style|script)[^>]*>/gi, "")
                  .replace(/\sclass="[^"]*"/g, "")
                  .replace(/\slang="[^"]*"/g, "");
                document.execCommand("insertHTML", false, clean);
                setDirty(true);
              }}
              class="docs-page mx-auto bg-white shadow-sm rounded-sm
                     px-8 py-10 md:px-14 md:py-16 outline-none
                     max-w-[820px] min-h-[60vh] leading-relaxed text-slate-900"
            />
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".docx,.txt,.md,.html,.htm"
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
  { onClick, title, label }: {
    onClick: () => void;
    title: string;
    label: preact.ComponentChildren;
  },
) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()} // keep the selection
      onClick={onClick}
      title={title}
      class="min-w-[30px] h-7 px-1.5 rounded border border-slate-200 bg-white
             hover:bg-slate-100 hover:border-slate-300 flex items-center
             justify-center text-slate-700"
    >
      {label}
    </button>
  );
}

function Sep() {
  return <span class="w-px h-5 bg-slate-300 mx-1" />;
}

function AlignIcon({ kind }: { kind: "left" | "center" | "right" | "justify" }) {
  const widths = {
    left: [14, 9, 12, 7],
    center: [14, 10, 12, 8],
    right: [14, 9, 12, 7],
    justify: [14, 14, 14, 14],
  }[kind];
  const x = (w: number) =>
    kind === "center" ? (14 - w) / 2 + 3 : kind === "right" ? 17 - w : 3;
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
      {widths.map((w, i) => (
        <rect key={i} x={x(w)} y={4 + i * 3.4} width={w} height="1.8" rx="0.9" />
      ))}
    </svg>
  );
}

export { DOCS_PERMISSION_KEY };
