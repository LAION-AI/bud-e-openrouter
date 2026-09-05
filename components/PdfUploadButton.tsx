// components/PdfUploadButton.tsx
//
// The paperclip: PDFs and text documents on their way into the conversation.
//
// The two kinds travel differently, and they have to:
//
//   PDF   goes upstream whole. OpenRouter extracts it itself and can fall
//         back to reading the pixels of a scanned page - better than anything
//         we could do in the browser.
//
//   the rest  is unpacked here into plain text. No chat API accepts a .docx,
//         so a document that is not turned into text arrives as nothing at
//         all - which is exactly what used to happen.
//
// A file that cannot be read says so, with the next step in the sentence. It
// is not silently dropped: someone who attached a document and gets an answer
// that ignores it has no way of telling what went wrong.

import { useRef, useState } from "preact/hooks";
import { IS_BROWSER } from "$fresh/runtime.ts";
import {
  documentAsMessage,
  extractDocumentText,
  UPLOAD_ACCEPT,
} from "../utils/documentText.ts";

export interface PdfFile {
  type: "pdf";
  name: string;
  mime_type: string;
  data: string; // base64
}

/** A document that was turned into text here. */
export interface TextFile {
  type: "text";
  /** Ready for the conversation: name, markers and the text itself. */
  text: string;
  /** For the chip above the input line. */
  name: string;
  kind: string;
  chars: number;
}

export type UploadedFile = PdfFile | TextFile;

type Variant = "floating" | "inline";

export function PdfUploadButton({
  onPdfsUploaded,
  onTextsUploaded,
  onError,
  variant = "floating",
  title,
}: {
  onPdfsUploaded: (pdfs: PdfFile[]) => void;
  /** Documents that were read into text. Absent means only PDFs are taken. */
  onTextsUploaded?: (texts: TextFile[]) => void;
  /** Told about every file that could not be read, one sentence each. */
  onError?: (messages: string[]) => void;
  variant?: Variant;
  title?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const clearInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const onButtonClick = () => {
    clearInput();
    fileInputRef.current?.click();
  };

  const fileToBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const commaIdx = dataUrl.indexOf(",");
        if (commaIdx === -1) return reject(new Error("Invalid DataURL"));
        resolve(dataUrl.slice(commaIdx + 1));
      };
      reader.onerror = () => reject(reader.error || new Error("FileReader error"));
      reader.onabort = () => reject(new Error("File read aborted"));
      reader.readAsDataURL(file);
    });

  const handleUpload = async (event: Event) => {
    try {
      if (busy) return;
      setBusy(true);
      const target = event.target as HTMLInputElement;
      const list = target?.files;
      if (!list || list.length === 0) {
        clearInput();
        setBusy(false);
        return;
      }

      const seen = new Set<string>();
      const files = Array.from(list).filter((f) => {
        const key = `${f.name}|${f.size}|${f.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const pdfs: PdfFile[] = [];
      const texts: TextFile[] = [];
      const problems: string[] = [];

      for (const f of files) {
        const isPdf = f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf");
        try {
          if (isPdf) {
            pdfs.push({
              type: "pdf",
              name: f.name,
              mime_type: f.type || "application/pdf",
              data: await fileToBase64(f),
            });
            continue;
          }
          if (!onTextsUploaded) {
            problems.push(`"${f.name}" wurde nicht übernommen - hier gehen nur PDFs.`);
            continue;
          }
          const bytes = new Uint8Array(await f.arrayBuffer());
          const doc = await extractDocumentText(f.name, bytes);
          texts.push({
            type: "text",
            text: documentAsMessage(doc),
            name: doc.name,
            kind: doc.kind,
            chars: doc.chars,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // The module's own messages already read as sentences; anything
          // else gets the file name in front of it so it can be placed.
          problems.push(msg.includes(f.name) ? msg : `"${f.name}": ${msg}`);
        }
      }

      if (pdfs.length) onPdfsUploaded(pdfs);
      if (texts.length && onTextsUploaded) onTextsUploaded(texts);
      if (problems.length) {
        if (onError) onError(problems);
        else console.warn("[upload]", problems.join(" | "));
      }
    } catch (e) {
      console.error("upload failed:", e);
      onError?.([`Die Datei ließ sich nicht lesen: ${String(e).slice(0, 120)}`]);
    } finally {
      clearInput();
      setBusy(false);
    }
  };

  const pos = variant === "floating"
    ? "md:absolute md:right-3 md:bottom-[9.7rem]"
    : "relative";

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUpload}
        accept={onTextsUploaded ? UPLOAD_ACCEPT : "application/pdf"}
        multiple
        class="hidden"
      />
      <button
        onClick={onButtonClick}
        disabled={!IS_BROWSER || busy}
        class={`${pos} disabled:opacity-50 disabled:cursor-not-allowed rounded-md p-2 bg-gray-100 text-blue-600/50`}
        title={busy
          ? "Datei wird gelesen."
          : (title ?? "Dokument anhängen (PDF, Word, Text)")}
      >
        {/* paperclip - it is not only PDFs any more */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <path d="M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5" />
        </svg>
      </button>
    </>
  );
}

export default PdfUploadButton;
