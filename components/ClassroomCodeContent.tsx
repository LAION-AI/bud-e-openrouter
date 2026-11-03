import { useState } from "preact/hooks";
import MarkdownText from "./MarkdownText.tsx";

export type ContentPart =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string; language: string; incomplete?: boolean };

async function copyCode(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch { /* Try the local fallback in older or restrictive browsers. */ }
  const previous = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard denied");
  } finally {
    textarea.remove();
    if (previous instanceof HTMLElement) previous.focus();
  }
}

/** Split fenced Markdown code without interpreting any model output as HTML. */
export function splitClassroomContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const fence = /^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n/gm;
  let at = 0;
  while (at < content.length) {
    fence.lastIndex = at;
    const match = fence.exec(content);
    if (!match) break;
    const start = match.index;
    if (start > at) {
      parts.push({ kind: "text", value: content.slice(at, start) });
    }
    const marker = match[1][0];
    const closing = new RegExp(
      `^[ \\t]{0,3}${marker}{${match[1].length},}[ \\t]*(?:\\r?\\n|$)`,
      "gm",
    );
    closing.lastIndex = fence.lastIndex;
    const end = closing.exec(content);
    parts.push({
      kind: "code",
      language: match[2].trim().slice(0, 40) || "Code",
      value: content.slice(fence.lastIndex, end?.index ?? content.length)
        .replace(/\r?\n$/, ""),
      ...(!end ? { incomplete: true } : {}),
    });
    at = end ? closing.lastIndex : content.length;
  }
  if (at < content.length) {
    parts.push({ kind: "text", value: content.slice(at) });
  }
  if (parts.length === 1 && parts[0].kind === "text") {
    const html = /^(?:<!doctype\s+html|<html\b)/im.exec(content);
    if (
      html &&
      (html.index === 0 || /<(?:head|body)\b/i.test(content.slice(html.index)))
    ) {
      const prefix = content.slice(0, html.index);
      const htmlText = content.slice(html.index);
      const close = /<\/html\s*>/i.exec(htmlText);
      const end = close ? close.index + close[0].length : htmlText.length;
      const result: ContentPart[] = [];
      if (prefix) result.push({ kind: "text", value: prefix });
      result.push({
        kind: "code",
        value: htmlText.slice(0, end),
        language: "html",
        ...(!close ? { incomplete: true } : {}),
      });
      if (htmlText.slice(end)) {
        result.push({ kind: "text", value: htmlText.slice(end) });
      }
      return result;
    }
  }
  return parts.length ? parts : [{ kind: "text", value: content }];
}

export default function ClassroomCodeContent(
  { content }: { content: string },
) {
  const [copied, setCopied] = useState(-1);
  const parts = splitClassroomContent(content);
  return (
    <div class="space-y-2">
      {parts.map((part, index) =>
        part.kind === "text"
          ? <MarkdownText key={index} text={part.value} />
          : (
            <div
              key={index}
              class="overflow-hidden rounded-lg border border-gray-700 bg-gray-900 text-left text-white"
            >
              <div class="flex items-center justify-between bg-gray-800 px-3 py-1 text-xs text-gray-200">
                <span class="font-mono">{part.language}</span>
                <button
                  type="button"
                  class="rounded border border-gray-600 px-2 py-1 hover:bg-gray-700"
                  title="Code in die Zwischenablage kopieren"
                  onClick={async () => {
                    try {
                      await copyCode(part.value);
                      setCopied(index);
                      setTimeout(() => setCopied(-1), 1600);
                    } catch {
                      // The browser may deny clipboard access; show a clear fallback.
                      setCopied(-2);
                    }
                  }}
                >
                  {copied === index ? "Kopiert ✓" : "Kopieren"}
                </button>
              </div>
              <pre class="overflow-x-auto p-3 text-sm leading-relaxed"><code>{part.value}</code></pre>
              {part.incomplete && (
                <p class="px-3 pb-2 text-xs text-amber-200">
                  Der Codeblock hat keinen Abschluss. Die Antwort könnte
                  unvollständig sein.
                </p>
              )}
              {copied === -2 && (
                <p class="px-3 pb-2 text-xs text-amber-200">
                  Kopieren wurde vom Browser blockiert. Bitte den Code
                  markieren.
                </p>
              )}
            </div>
          )
      )}
    </div>
  );
}
