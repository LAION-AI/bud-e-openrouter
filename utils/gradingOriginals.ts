/// <reference lib="dom" />
/** PDF pages are rendered locally and lazily, without third-party requests.
 * PDF.js is self-hosted (see scripts/fetch-grading-pdfjs.ts). */
import type { SourceDoc } from "./grading.ts";
import { gradingUnbase64 } from "./gradingUploads.ts";

export type GradingPageImage = { src: string; width: number; height: number };
type Viewport = { width: number; height: number };
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getViewport(options: { scale: number }): Viewport;
        render(options: Record<string, unknown>): { promise: Promise<void> };
      }>;
    }>;
    destroy(): Promise<void>;
  };
};
const BASE = "/pdfjs/5.4.624/";
let renderer: Promise<PdfJs> | undefined;
let loadAttempt = 0;
function pdfRenderer(): Promise<PdfJs> {
  // A failed dynamic import is cached by browsers. A fresh URL allows the
  // teacher's retry to recover after a temporary offline/network failure.
  const path = BASE + "build/pdf.min.mjs" +
    (loadAttempt ? `?retry=${loadAttempt}` : "");
  return renderer ??= import(path).then((lib: PdfJs) => {
    lib.GlobalWorkerOptions.workerSrc = BASE + "build/pdf.worker.min.mjs";
    return lib;
  }).catch(() => {
    renderer = undefined;
    loadAttempt++;
    throw new Error(
      "Die lokale PDF-Anzeige konnte nicht geladen werden. Prüfe die Verbindung und versuche den Download erneut; die Korrektur bleibt erhalten.",
    );
  });
}
export async function gradingOriginalImage(
  source: SourceDoc,
): Promise<GradingPageImage> {
  if (source.kind === "text") {
    throw new Error("Ein Textabschnitt hat kein Originalseitenbild.");
  }
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Dein Browser kann das Originalbild nicht anzeigen.");
  }
  try {
    if (source.kind === "pdf") {
      const lib = await pdfRenderer();
      const task = lib.getDocument({
        data: gradingUnbase64(source.content.split(",")[1]),
        isEvalSupported: false,
        enableXfa: false,
        cMapUrl: BASE + "cmaps/",
        cMapPacked: true,
        standardFontDataUrl: BASE + "standard_fonts/",
        wasmUrl: BASE + "wasm/",
      });
      const timeout = setTimeout(() => {
        void task.destroy();
      }, 90_000);
      try {
        const pdf = await task.promise;
        if (pdf.numPages !== 1) {
          throw new Error(
            "Das Original enthält noch mehrere Seiten. Bitte zuerst die Seitenaufteilung abschließen.",
          );
        }
        const page = await pdf.getPage(1),
          natural = page.getViewport({ scale: 1 });
        const view = page.getViewport({
          scale: Math.min(3, 2200 / Math.max(natural.width, natural.height)),
        });
        canvas.width = Math.ceil(view.width);
        canvas.height = Math.ceil(view.height);
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport: view,
          background: "white",
        }).promise;
      } finally {
        clearTimeout(timeout);
        await task.destroy();
      }
    } else {
      if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(source.content)) {
        throw new Error("Ungültiges Originalbild.");
      }
      const image = await createImageBitmap(
        await (await fetch(source.content)).blob(),
      );
      try {
        if (image.width * image.height > 40_000_000) {
          throw new Error("Das Originalbild ist zu groß.");
        }
        const scale = Math.min(1, 2200 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        image.close();
      }
    }
    return {
      src: canvas.toDataURL("image/jpeg", .94),
      width: canvas.width,
      height: canvas.height,
    };
  } catch (error) {
    throw new Error(
      `Originalseite ${source.index} (${source.name}): ${
        error instanceof Error ? error.message : "Anzeige fehlgeschlagen"
      }`,
    );
  } finally {
    canvas.width = canvas.height = 0;
  }
}
