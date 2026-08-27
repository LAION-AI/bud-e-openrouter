import { useEffect, useState } from "preact/hooks";
import { chatTemplateContent } from "../internalization/content.ts";
import { joinAudio } from "../utils/audioJoin.ts";
import SongPlayer from "./SongPlayer.tsx";

/* ---------- helpers ---------- */
function downloadAudioFiles(
  items: { [key: string]: { audio: HTMLAudioElement } },
) {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "-");

  // Placeholder slots for chunks that produced no audio carry no src.
  const real = Object.fromEntries(
    Object.entries(items ?? {}).filter(([, i]) => !!i?.audio?.src),
  );
  if (Object.keys(real).length === 0) return;
  items = real;

  // The chunks must be joined in the order they are spoken. Numeric keys
  // usually enumerate in order, but sorting says so explicitly rather than
  // relying on it.
  const ordered = Object.keys(items)
    .map(Number)
    .sort((a, b) => a - b)
    .map((idx) => items[String(idx)].audio.src);

  Promise.all(
    ordered.map((src) =>
      fetch(src).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b))
    ),
  )
    .then((parts) => {
      // WAV parts cannot simply be laid end to end - see utils/audioJoin.ts.
      const joined = joinAudio(parts);
      if (!joined) return;
      const url = URL.createObjectURL(
        new Blob([joined.bytes], { type: joined.mime }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `audio-${ts}.${joined.ext}`;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch((err) => console.warn("Could not assemble the audio:", err));
}

function convertDoiToUrl(doi: string): string {
  const clean = doi.replace(/^DOI:\s*/, "");
  return clean === "null" ? "#" : `https://doi.org/${clean}`;
}

/* ---------- code blocks (``` fences) with one-click copy ---------- */
function CodeBlock(
  { code, language, streaming }: {
    code: string;
    language?: string;
    streaming?: boolean;
  },
) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(done).catch((e) =>
        console.warn("Clipboard write failed:", e)
      );
      return;
    }
    // Fallback for browsers/contexts without the async clipboard API
    const ta = document.createElement("textarea");
    ta.value = code;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      console.warn("Clipboard fallback failed:", e);
    }
    document.body.removeChild(ta);
  };

  return (
    <div class="my-2 rounded-lg overflow-hidden border border-gray-700 bg-gray-900 text-left">
      <div class="flex items-center justify-between px-3 py-1 bg-gray-800 text-gray-300 text-xs font-mono">
        <span>{language || "code"}{streaming ? " …" : ""}</span>
        <button
          type="button"
          onClick={copy}
          class="px-2 py-0.5 rounded border border-gray-600 hover:bg-gray-700 transition-colors"
          title="Copy code to clipboard"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre class="overflow-x-auto p-3 text-sm leading-relaxed text-gray-100 whitespace-pre"><code>{code}</code></pre>
    </div>
  );
}

/**
 * Splits text into ``` fenced code blocks and regular text.
 * An unterminated fence (while the answer is still streaming) is rendered
 * as a code block too, so the layout does not jump once it closes.
 */
function renderRichText(text: string) {
  if (typeof text !== "string") return null;
  if (!text.includes("```")) return renderTextWithLinksAndBold(text);

  const nodes: any[] = [];
  const re = /```([A-Za-z0-9_+#.-]*)[ \t]*\r?\n?([\s\S]*?)```/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) {
      nodes.push(
        <span key={`t${key++}`}>{renderTextWithLinksAndBold(before)}</span>,
      );
    }
    nodes.push(
      <CodeBlock
        key={`c${key++}`}
        language={m[1]}
        code={m[2].replace(/\r?\n$/, "")}
      />,
    );
    last = re.lastIndex;
  }

  const rest = text.slice(last);
  const openIdx = rest.indexOf("```");
  if (openIdx !== -1) {
    const before = rest.slice(0, openIdx);
    if (before) {
      nodes.push(
        <span key={`t${key++}`}>{renderTextWithLinksAndBold(before)}</span>,
      );
    }
    const tail = rest.slice(openIdx + 3);
    const nl = tail.indexOf("\n");
    nodes.push(
      <CodeBlock
        key={`c${key++}`}
        language={(nl === -1 ? tail : tail.slice(0, nl)).trim()}
        code={nl === -1 ? "" : tail.slice(nl + 1)}
        streaming
      />,
    );
  } else if (rest) {
    nodes.push(
      <span key={`t${key++}`}>{renderTextWithLinksAndBold(rest)}</span>,
    );
  }

  return nodes;
}

// **Bold** + `inline code` + Links + DOI minimal robust
function renderTextWithLinksAndBold(text: string) {
  const re =
    /(`[^`\n]+`|https?:\/\/[^\s]+|www\.[^\s]+|DOI:\s*(?:null|[\d.]+\/[^\s]+)|\*\*.*?\*\*)/g;

  const parts = text.split(re).filter((p) => p !== "");
  return parts.map((part, i) => {
    // bold
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }

    // inline code
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          class="px-1 py-0.5 rounded bg-gray-200 text-gray-800 font-mono text-[0.9em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // DOI
    if (/^DOI:\s*/.test(part)) {
      const href = convertDoiToUrl(part);
      return (
        <a key={i} href={href} class="text-blue-600 underline" target="_blank">
          {part}
        </a>
      );
    }

    // Links
    if (/^https?:\/\//.test(part) || /^www\./.test(part)) {
      const href = part.startsWith("http") ? part : `https://${part}`;
      return (
        <a key={i} href={href} class="text-blue-600 underline" target="_blank">
          {part}
        </a>
      );
    }

    return <span key={i}>{part}</span>;
  });
}

/**
 * The agent's steps, collapsed by default.
 *
 * Correcting a class set takes a minute or two, and a spinner that long looks
 * like a hang. This shows what is happening now, and expands into the full
 * list for anyone who wants to see how the answer came about.
 */
function AgentSteps(
  { title, steps, running, failed, lang }: {
    title: string;
    steps: { step: string; detail?: string }[];
    running?: boolean;
    failed?: boolean;
    lang: string;
  },
) {
  const [open, setOpen] = useState(false);
  const last = steps[steps.length - 1];
  const t = (k: string) =>
    (chatTemplateContent[lang]?.[k] ?? chatTemplateContent.en[k]) as string;

  return (
    <div class="my-2 rounded-lg border border-slate-200 bg-slate-50 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-100 rounded-lg"
      >
        <span class="shrink-0">
          {failed
            ? <span class="text-red-600">✕</span>
            : running
            ? <span class="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
            : <span class="text-green-700">✓</span>}
        </span>
        <span class="font-medium text-slate-700 truncate">{title}</span>
        <span class="text-slate-500 text-xs truncate flex-1">
          {!open && last ? last.step : ""}
        </span>
        <span class="text-slate-400 text-xs shrink-0">
          {steps.length} {t("agentSteps")} {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <ol class="px-3 pb-2 space-y-1">
          {steps.map((s, i) => (
            <li key={i} class="flex gap-2 text-xs text-slate-600">
              <span class="text-slate-400 tabular-nums shrink-0">{i + 1}.</span>
              <span>
                {s.step}
                {s.detail && <span class="block text-slate-400">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A file the assistant produced, offered for download. */
function FileDownload(
  { name, mime, data, lang, onOpenInEditor }: {
    name: string;
    mime: string;
    data: string;
    lang: string;
    /** Opens a .docx in the word processor instead of downloading it. */
    onOpenInEditor?: (name: string, base64: string) => void;
  },
) {
  const t = (k: string) =>
    (chatTemplateContent[lang]?.[k] ?? chatTemplateContent.en[k]) as string;

  const save = () => {
    // Rebuilt into a Blob rather than linked as a data: URL - browsers refuse
    // to download very large data: URLs, and a class set easily gets there.
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const kb = Math.max(1, Math.round((data.length * 3 / 4) / 1024));
  // A .docx can be opened in the editor; anything else can only be saved.
  const editable = /wordprocessingml/.test(mime) || /\.docx?$/i.test(name);
  return (
    <span class="my-2 inline-flex flex-wrap items-stretch gap-1.5">
      <button
        type="button"
        onClick={save}
        class="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-sm text-blue-900"
      >
        <span class="text-lg leading-none">📄</span>
        <span class="font-medium">{name}</span>
        <span class="text-blue-700/70 text-xs">{kb} KB · {t("download")}</span>
      </button>
      {editable && onOpenInEditor && (
        <button
          type="button"
          onClick={() => onOpenInEditor(name, data)}
          title={t("openInEditorHint")}
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-sm text-emerald-900"
        >
          <span class="text-lg leading-none">✏️</span>
          <span class="font-medium">{t("openInEditor")}</span>
        </button>
      )}
    </span>
  );
}

/* ---------- message toolbar (Edit/Refresh/Speak/Download) ---------- */
function MessageToolbar(props: {
  index: number;
  role: string;
  hasAudio: boolean;
  onEdit: (i: number) => void;
  onRefresh: (i: number) => void;
  onSpeak: (i: number) => void;
  onDownload: (i: number) => void;
}) {
  const { index, role, hasAudio, onEdit, onRefresh, onSpeak, onDownload } =
    props;
  const isAssistant = role !== "user";

  return (
    <div class="flex items-center gap-2 text-gray-600">
      {/* Edit user message */}
      {!isAssistant && (
        <button
          class="hover:text-gray-800"
          title="Edit message"
          onClick={() => onEdit(index)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}

      {isAssistant && (
        <>
          {/* Edit assistant message */}
          <button
            class="hover:text-gray-800"
            title="Edit message"
            onClick={() => onEdit(index)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>

          {/* Re-run */}
          <button
            class="hover:text-gray-800"
            title="Re-run from this turn"
            onClick={() => onRefresh(index)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>

          {/* Speak */}
          <button
            class="hover:text-gray-800"
            title="Speak this turn"
            onClick={() => onSpeak(index)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path d="M11 5 6 9H2v6h4l5 4z" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </button>

          {/* Download audio */}
          {hasAudio && (
            <button
              class="hover:text-gray-800"
              title="Download audio"
              onClick={() => onDownload(index)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- component ---------- */
type AnyMsg = any;
type AnyImg = any;
type AnyPdf = any;
type AnyAudio = any;

export default function ChatTemplate(props: {
  lang: string;
  parentImages: AnyImg[];
  parentPdfs: AnyPdf[];
  messages: AnyMsg[];
  isComplete: boolean;
  onCancelAction: () => void;
  readAlways: boolean;
  autoScroll: boolean;
  skipCurlyBraces: boolean;
  currentEditIndex: number;
  audioFileDict: AnyAudio;

  onToggleAutoScrollAction: () => void;
  onToggleReadAlwaysAction: () => void;
  onToggleSkipCurlyBracesAction: () => void;

  onSpeakAtGroupIndexAction: (groupIndex: number) => void;
  onRefreshAction: (groupIndex: number) => void;
  onEditAction: (groupIndex: number) => void;

  onUploadActionToMessages: (uploadedMessages: AnyMsg[]) => void;
  onImageChange: (images: AnyImg[]) => void;
  onPdfChange?: (pdfs: AnyPdf[]) => void;
  onTrashAction: () => void;
  /** Whether a finished song starts by itself. Off means the user presses play. */
  songAutoplay?: boolean;
  /** Opens a .docx from the chat in the word processor. */
  onOpenInEditor?: (name: string, base64: string) => void;
}) {
  const {
    lang,
    songAutoplay = false,
    onOpenInEditor,
    parentImages,
    parentPdfs,
    messages,
    isComplete,
    onCancelAction,
    readAlways,
    autoScroll,
    skipCurlyBraces,
    audioFileDict,
    currentEditIndex,
    onToggleAutoScrollAction,
    onToggleReadAlwaysAction,
    onToggleSkipCurlyBracesAction,
    onImageChange,
    onPdfChange,
    onSpeakAtGroupIndexAction,
    onRefreshAction,
    onEditAction,
  } = props;

  const deleteImage = (iDel: number) => {
    const next = parentImages.filter((_: AnyImg, i: number) => i !== iDel);
    onImageChange(next);
  };

  const deletePdf = (iDel: number) => {
    const next = parentPdfs.filter((_: AnyPdf, i: number) => i !== iDel);
    if (onPdfChange) onPdfChange(next);
  };

  const renderContentPart = (content: any, idx: number) => {
    if (content?.type === "text") {
      return <div key={idx}>{renderRichText(content.text)}</div>;
    }
    if (content?.type === "agent_steps") {
      return (
        <AgentSteps
          key={idx}
          lang={lang}
          title={content.title ?? ""}
          steps={content.steps ?? []}
          running={content.running === true}
          failed={content.failed === true}
        />
      );
    }
    if (content?.type === "file_download") {
      return (
        <FileDownload
          key={idx}
          lang={lang}
          name={content.name ?? "datei"}
          mime={content.mime ?? "application/octet-stream"}
          data={content.data ?? ""}
          onOpenInEditor={onOpenInEditor}
        />
      );
    }
    if (content?.type === "audio_url") {
      return (
        <SongPlayer
          key={idx}
          lang={lang}
          autoplay={songAutoplay}
          song={{
            url: content.audio_url?.url ?? "",
            lyrics: content.lyrics,
            title: content.title,
            model: content.model,
            pending: content.pending === true,
          }}
        />
      );
    }
    if (content?.type === "image_url") {
      const imageId = content.id || null;

      // Determine source from content.source, or infer from ID prefix
      let imageSource = content.source;
      if (!imageSource && imageId) {
        if (imageId.startsWith("gen_") || imageId.startsWith("img_")) {
          imageSource = "generated";
        } else if (imageId.startsWith("upl_")) {
          imageSource = "uploaded";
        }
      }
      if (!imageSource) {
        imageSource = content.image_url?.url?.startsWith("data:image")
          ? "generated"
          : "uploaded";
      }

      const displayLabel = imageSource === "generated"
        ? "Generated"
        : "Uploaded";
      const badgeColor = imageSource === "generated"
        ? "bg-purple-500/70"
        : "bg-blue-500/70";

      return (
        <div key={idx} class="relative inline-block">
          <img
            src={content.image_url.url}
            alt={`${displayLabel} image${imageId ? ` (${imageId})` : ""}`}
            class="max-w-[400px] w-full h-auto rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => {
              // Open image in a new tab for full view
              const win = globalThis.open();
              if (win) {
                win.document.write(
                  `<img src="${content.image_url.url}" style="max-width:100%;height:auto;" />`,
                );
                win.document.title = imageId || `${displayLabel} Image`;
              }
            }}
          />

          {/* Image ID badge – click to copy the ID for imageedit references */}
          {imageId && (
            <div
              class="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded font-mono cursor-pointer hover:bg-black/80"
              title={`Image ID: ${imageId} (click to copy)`}
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(imageId);
                const el = e.currentTarget as HTMLElement;
                const original = el.textContent;
                el.textContent = "Copied!";
                setTimeout(() => {
                  el.textContent = original;
                }, 1000);
              }}
            >
              {imageId}
            </div>
          )}

          {/* Source indicator */}
          <div
            class={`absolute top-2 right-2 text-xs px-2 py-0.5 rounded ${badgeColor} text-white`}
          >
            {displayLabel}
          </div>
        </div>
      );
    }
    if (content?.type === "pdf") {
      return (
        <div
          key={idx}
          class="flex items-center gap-2 p-2 bg-gray-200 rounded-md"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="text-red-700"
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
            <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
            <path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6" />
            <path d="M17 18h2" />
            <path d="M20 15h-3v6" />
            <path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1z" />
          </svg>
          <span class="font-mono text-sm">{content.name}</span>
        </div>
      );
    }
    if (typeof content === "string") {
      return <div key={idx}>{renderRichText(content)}</div>;
    }
    return null;
  };

  useEffect(() => {}, []);

  // Language-aware defaults for the {}-button
  const defaultSkipOn =
    lang === "de" ? "In {} stehenden Text überspringen" : "Skip contents in {}";
  const defaultSkipOff =
    lang === "de" ? "Text in {} mit vorlesen" : "Read contents in {}";

  return (
    <div class="relative w-full">
      {/* CENTERED toolbar row: sits directly above the chat history */}
      <div class="w-full flex flex-wrap items-center justify-center gap-2 mb-2">
        {!isComplete && (
          <button
            type="button"
            onClick={onCancelAction}
            class="px-3 py-1 rounded text-sm border bg-red-600 text-white border-red-600 hover:bg-red-700"
            title="Cancel generation"
          >
            Cancel
          </button>
        )}

        <button
          type="button"
          onClick={onToggleReadAlwaysAction}
          class={`px-3 py-1 rounded text-sm border transition
            ${
              readAlways
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          title={chatTemplateContent[lang]?.readOutText ?? "Vorlesen"}
        >
          {readAlways
            ? (chatTemplateContent[lang]?.silent ?? (
              lang === "de" ? "Stumm" : "Silent"
            ))
            : (chatTemplateContent[lang]?.readOutText ?? (
              lang === "de" ? "Vorlesen" : "Read out text"
            ))}
        </button>

        {/* Skip JSON / { ... } blocks button */}
        <button
          type="button"
          onClick={onToggleSkipCurlyBracesAction}
          class={`px-3 py-1 rounded text-sm border transition
            ${
              skipCurlyBraces
                ? "bg-purple-600 text-white border-purple-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          title={
            chatTemplateContent[lang]?.skipJsonTooltip ??
            (lang === "de"
              ? "Text in geschweiften Klammern { ... } beim Vorlesen überspringen."
              : "Skip JSON / text inside { ... } when reading aloud.")
          }
        >
          {skipCurlyBraces
            ? (chatTemplateContent[lang]?.skipJsonOn ?? defaultSkipOn)
            : (chatTemplateContent[lang]?.skipJsonOff ?? defaultSkipOff)}
        </button>

        <button
          type="button"
          onClick={onToggleAutoScrollAction}
          class={`px-3 py-1 rounded text-sm border transition
            ${
              autoScroll
                ? "bg-green-600 text-white border-green-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          title={
            autoScroll
              ? (chatTemplateContent[lang]?.autoScrollOn ??
                (lang === "de" ? "Automatisch scrollen: AN" : "Auto-scroll: ON"))
              : (chatTemplateContent[lang]?.autoScrollOff ??
                (lang === "de" ? "Automatisch scrollen: AUS" : "Auto-scroll: OFF"))
          }
        >
          {autoScroll
            ? (chatTemplateContent[lang]?.autoScrollOn ??
              (lang === "de" ? "Automatisch scrollen" : "Auto-scroll"))
            : (chatTemplateContent[lang]?.autoScrollOff ??
              (lang === "de" ? "Manuell scrollen" : "Manual scroll"))}
        </button>
      </div>

      {/* Chat history window */}
      <div
        class={
          messages?.length === 0
            ? `bg-transparent`
            : `chat-history w-full flex flex-col space-y-4 p-4 mx-auto rounded-lg shadow bg-white/75 max-h-[55vh] sm:max-h-[60vh] overflow-y-auto`
        }
      >
        {messages?.map((item: AnyMsg, groupIndex: number) => {
          const isUser = item.role === "user";
          const hasAudio =
            !!(audioFileDict?.[groupIndex]) &&
            Object.keys(audioFileDict[groupIndex]).length > 0;

          return (
            <div
              key={groupIndex}
              class={`message-group relative flex flex-col ${
                isUser ? "items-end" : "items-start"
              }`}
            >
              {/* Per-message toolbar */}
              <div
                class={`
                  z-20 flex flex-wrap gap-2 justify-end mb-1
                  ${isUser ? "md:self-end" : "md:self-start"}
                `}
              >
                <MessageToolbar
                  index={groupIndex}
                  role={item.role}
                  hasAudio={!isUser && hasAudio}
                  onEdit={onEditAction}
                  onRefresh={onRefreshAction}
                  onSpeak={onSpeakAtGroupIndexAction}
                  onDownload={(i) => downloadAudioFiles(audioFileDict[i])}
                />
              </div>

              {/* Message bubble */}
              <div
                class={`message mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] ${
                  isUser
                    ? "bg-blue-100 sm:ml-20 md:ml-40"
                    : "bg-gray-100 sm:mr-20 md:mr-40"
                } p-3 rounded-lg ${
                  isUser ? "rounded-tr-none" : "rounded-tl-none"
                } shadow ${
                  isUser && currentEditIndex === groupIndex
                    ? "ring-2 ring-orange-300"
                    : ""
                }`}
              >
                {typeof item.content === "string"
                  ? <div>{renderRichText(item.content)}</div>
                  : (
                    <div class="flex flex-col gap-2">
                      {(item.content as any[]).map((content, idx) =>
                        renderContentPart(content, idx)
                      )}
                    </div>
                  )}
              </div>
            </div>
          );
        })}

        {(parentImages?.length > 0 || parentPdfs?.length > 0) && (
          <div class="w-full flex justify-center">
            <div class="p-2 flex flex-wrap max-w-xs gap-4">
              {parentImages.map((image: AnyImg, index: number) => (
                <div class="relative group" key={`img-${index}`}>
                  <img
                    src={image.image_url.url}
                    alt={`Thumbnail ${index + 1}`}
                    class="w-32 h-32 object-cover rounded-lg shadow-xl bg-white/50"
                  />
                  <button
                    onClick={() => deleteImage(index)}
                    class="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Entfernen"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M18 6l-12 12" />
                      <path d="M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              {parentPdfs.map((pdf: AnyPdf, index: number) => (
                <div
                  key={`pdf-${index}`}
                  class="relative group w-32 h-32 flex flex-col items-center justify-center bg-gray-200 rounded-lg shadow-xl p-2 text-center"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    class="text-red-700 mb-2"
                  >
                    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                    <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                    <path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6" />
                    <path d="M17 18h2" />
                    <path d="M20 15h-3v6" />
                    <path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1z" />
                  </svg>
                  <span class="text-xs font-mono break-all overflow-hidden">
                    {pdf.name}
                  </span>
                  <button
                    onClick={() => deletePdf(index)}
                    class="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Entfernen"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M18 6l-12 12" />
                      <path d="M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
