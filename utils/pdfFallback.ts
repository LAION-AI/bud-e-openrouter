/**
 * @file pdfFallback.ts
 * @description Server-side fallback when a PDF cannot ride along natively.
 *
 *              Most models take a PDF as an "input_file" part and read it
 *              themselves - scanned pages included, via their own vision. That
 *              stays the first try. This module is the second: when the
 *              gateway refuses the file (wrong model, wrong prefix, too big),
 *              the pages are opened here instead and handed over as labelled
 *              text and pictures, page by page, in the original order:
 *
 *                [Bild Seite 3 von 12 aus "hausaufgaben.pdf"]
 *                --- Seite 3 von 12 aus "hausaufgaben.pdf" ---
 *                ... extracted text ...
 *                --- Ende Seite 3 ---
 *
 *              Text comes from poppler's pdftotext where available, with unpdf
 *              as the fallback for machines without it. Page pictures are
 *              rendered with pdftoppm - the browser cannot do that (no PDF
 *              rasteriser, no canvas to draw on), so a scanned page without a
 *              renderer means an honest error rather than a silent gap.
 */

export interface PdfPage {
  n: number;
  of: number;
  text: string;
  /** Rendered page as JPEG bytes, if a renderer was available. */
  jpeg?: Uint8Array;
}

/** Never send more pages than this - beyond it the request drowns anyway. */
export const MAX_PDF_PAGES = 12;
/** Characters of extracted text per PDF, mirroring documentText.ts. */
export const MAX_PDF_TEXT = 120_000;
/** A page picture bigger than this is re-rendered at lower resolution. */
const MAX_JPEG_BYTES = 1_200_000;

async function run(
  cmd: string,
  args: string[],
  stdin?: Uint8Array,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; stdout: Uint8Array; stderr: string }> {
  try {
    const child = new Deno.Command(cmd, {
      args,
      stdin: stdin ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    if (stdin) {
      const w = child.stdin.getWriter();
      await w.write(stdin);
      await w.close();
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone - the output below says what happened.
      }
    }, timeoutMs);
    const out = await child.output();
    clearTimeout(timer);
    return {
      ok: out.success,
      stdout: out.stdout,
      stderr: new TextDecoder().decode(out.stderr).slice(0, 500),
    };
  } catch {
    return { ok: false, stdout: new Uint8Array(), stderr: `${cmd} missing` };
  }
}

let poppler: boolean | null = null;

/** True when pdftotext/pdftoppm answer - checked once, then remembered. */
export async function hasPoppler(): Promise<boolean> {
  if (poppler !== null) return poppler;
  const r = await run("pdftotext", ["-v"]);
  // -v writes the version to stderr and exits 0 when the binary exists.
  poppler = r.ok || /poppler/i.test(r.stderr);
  return poppler;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** Page count via pdfinfo, falling back to unpdf. Never throws. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  if (await hasPoppler()) {
    const tmp = await Deno.makeTempFile({ suffix: ".pdf" });
    try {
      await Deno.writeFile(tmp, bytes);
      const r = await run("pdfinfo", [tmp]);
      const m = /Pages:\s*(\d+)/.exec(new TextDecoder().decode(r.stdout));
      if (m) return Math.max(1, Number(m[1]));
    } catch {
      // Fall through to unpdf.
    } finally {
      await Deno.remove(tmp).catch(() => {});
    }
  }
  try {
    const { getDocumentProxy } = await import("npm:unpdf");
    const pdf = await getDocumentProxy(bytes);
    // No destroy call: unpdf's proxy type does not expose one, and this path
    // only runs when poppler is absent anyway.
    return Math.max(1, Number(pdf.numPages) || 1);
  } catch {
    return 1;
  }
}

/** Raw text of one page (1-based). Empty string when the page holds none. */
async function pageTextPoppler(
  bytes: Uint8Array,
  page: number,
): Promise<string> {
  const tmp = await Deno.makeTempFile({ suffix: ".pdf" });
  try {
    await Deno.writeFile(tmp, bytes);
    const r = await run("pdftotext", [
      "-layout",
      "-f",
      String(page),
      "-l",
      String(page),
      tmp,
      "-",
    ]);
    if (!r.ok) return "";
    return new TextDecoder().decode(r.stdout).replace(/\r\n?/g, "\n").trim();
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
}

async function allTextUnpdf(bytes: Uint8Array): Promise<string[]> {
  const { extractText } = await import("npm:unpdf");
  const { text } = await extractText(bytes, { mergePages: false }) as {
    text: string | string[];
  };
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((t) => (t ?? "").replace(/\r\n?/g, "\n").trim());
}

/** One page as JPEG. Null when no renderer is available or it fails. */
async function pageJpeg(
  bytes: Uint8Array,
  page: number,
  dpi: number,
): Promise<Uint8Array | null> {
  if (!(await hasPoppler())) return null;
  const dir = await Deno.makeTempDir();
  try {
    const src = `${dir}/in.pdf`;
    await Deno.writeFile(src, bytes);
    const r = await run("pdftoppm", [
      "-jpeg",
      "-r",
      String(dpi),
      "-f",
      String(page),
      "-l",
      String(page),
      src,
      `${dir}/p`,
    ]);
    if (!r.ok) return null;
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".jpg")) {
        return await Deno.readFile(`${dir}/${e.name}`);
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/**
 * Opens a PDF into labelled pages: extracted text plus, where possible, a
 * picture of the page. Order and page numbers survive - a scanned page keeps
 * its picture and says so in place of text.
 */
export async function pdfToPages(
  name: string,
  bytes: Uint8Array,
): Promise<{ pages: PdfPage[]; rendered: boolean; short: string }> {
  const total = await pdfPageCount(bytes);
  const count = Math.min(total, MAX_PDF_PAGES);
  const short = total > count ? ` (nur die ersten ${count} von ${total})` : "";

  let texts: string[] = [];
  if (await hasPoppler()) {
    for (let n = 1; n <= count; n++) texts.push(await pageTextPoppler(bytes, n));
  } else {
    try {
      texts = (await allTextUnpdf(bytes)).slice(0, count);
    } catch {
      texts = [];
    }
    while (texts.length < count) texts.push("");
  }

  // Share the text budget across pages so one huge page cannot eat the rest.
  const perPage = Math.max(2_000, Math.floor(MAX_PDF_TEXT / Math.max(1, count)));
  const pages: PdfPage[] = [];
  let rendered = false;
  for (let n = 1; n <= count; n++) {
    let jpeg: Uint8Array | undefined;
    let pic = await pageJpeg(bytes, n, 150);
    if (pic && pic.length > MAX_JPEG_BYTES) pic = await pageJpeg(bytes, n, 100);
    if (pic) {
      jpeg = pic;
      rendered = true;
    }
    pages.push({ n, of: total, text: (texts[n - 1] ?? "").slice(0, perPage), ...(jpeg ? { jpeg } : {}) });
  }

  const usable = pages.some((p) => p.text.trim() || p.jpeg);
  if (!usable) {
    throw new Error(
      `Aus "${name}" ließ sich nichts lesen - weder Text noch Seitenbilder. ` +
        (await hasPoppler()
          ? "Wenn es eingescannte Seiten sind, fotografiere sie und lade die Bilder hoch."
          : "Auf diesem Server fehlt das Werkzeug für Seitenbilder - lade Text-PDFs hoch oder die Seiten als Bilder."),
    );
  }
  return { pages, rendered, short };
}

/**
 * Turns opened pages into chat content parts in reading order: the picture
 * first where there is one, then the labelled text. A page without text keeps
 * its number and says why, so the model never silently skips a page.
 */
export function pagesToParts(
  name: string,
  pages: PdfPage[],
  short: string,
  // deno-lint-ignore no-explicit-any
): any[] {
  // deno-lint-ignore no-explicit-any
  const parts: any[] = [];
  for (const p of pages) {
    const head = `Seite ${p.n} von ${p.of} aus "${name}"${short}`;
    if (p.jpeg) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${base64(p.jpeg)}` },
      });
    }
    const body = p.text.trim()
      ? p.text.trim()
      : "[kein lesbarer Text auf dieser Seite - vermutlich eingescannt]";
    parts.push({ type: "text", text: `--- ${head} ---\n${body}\n--- Ende ${head} ---` });
  }
  return parts;
}
