/**
 * @file pyodidePreload.ts
 * @description Warms the browser cache with the Python runtime while the user
 *              is doing something else.
 *
 *              Opening the notebook otherwise means waiting for roughly 12 MB
 *              to arrive. Fetching it quietly in the background turns that
 *              wait into a one-off cost nobody notices, and the notebook opens
 *              from cache.
 *
 *              Only the files land in the HTTP cache - no interpreter is
 *              started and no WebAssembly is compiled, so the page keeps its
 *              memory. Booting still takes a second or two, just without the
 *              download.
 */

/** Where the runtime lives when it is served from this installation. */
export const LOCAL_PYODIDE_BASE = "/pyodide/";
export const CDN_PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/";

/** The core files. Packages are only fetched when a program imports them. */
const CORE_FILES = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

let started = false;
let resolvedBase: string | null = null;

/**
 * Prefers a locally served runtime and falls back to the CDN.
 *
 * Self-hosting matters more than it looks: the browser then pulls the runtime
 * from the same server it already has a connection to, which on a slow link to
 * a CDN is the difference between seconds and minutes - and it keeps working
 * when a school has no internet.
 */
export async function resolvePyodideBase(): Promise<string> {
  if (resolvedBase) return resolvedBase;
  try {
    const res = await fetch(LOCAL_PYODIDE_BASE + "pyodide.js", {
      method: "HEAD",
      cache: "no-store",
    });
    resolvedBase = res.ok ? LOCAL_PYODIDE_BASE : CDN_PYODIDE_BASE;
  } catch {
    resolvedBase = CDN_PYODIDE_BASE;
  }
  return resolvedBase;
}

/** Packages always come from the CDN - self-hosting all 358 would be absurd. */
export function packageBaseUrl(): string {
  return CDN_PYODIDE_BASE;
}

interface PreloadState {
  done: number;
  total: number;
  bytes: number;
  running: boolean;
}

const state: PreloadState = { done: 0, total: 0, bytes: 0, running: false };

export function preloadState(): PreloadState {
  return { ...state };
}

/**
 * Starts the background download once the page has settled.
 *
 * Skipped when the browser says the connection is metered or slow - a pupil on
 * a phone should not lose their data allowance to a feature they may never
 * open.
 */
export function schedulePyodidePreload(delayMs = 4000) {
  if (started) return;
  started = true;

  // deno-lint-ignore no-explicit-any
  const connection = (navigator as any)?.connection;
  if (connection?.saveData) return;
  if (/(^|-)(2g|slow-2g)$/.test(String(connection?.effectiveType ?? ""))) return;

  const begin = () => void runPreload();
  // deno-lint-ignore no-explicit-any
  const idle = (globalThis as any).requestIdleCallback;
  if (typeof idle === "function") {
    idle(begin, { timeout: delayMs * 2 });
  } else {
    setTimeout(begin, delayMs);
  }
}

async function runPreload() {
  if (state.running) return;
  state.running = true;
  try {
    const base = await resolvePyodideBase();
    state.total = CORE_FILES.length;
    for (const file of CORE_FILES) {
      try {
        await warm(base + file);
      } catch {
        // A failed prefetch costs nothing - the real load will try again.
      }
      state.done++;
    }
  } finally {
    state.running = false;
  }
}

/**
 * Pulls a file through so it lands in the HTTP cache.
 *
 * The body is read and thrown away chunk by chunk rather than buffered: an
 * 8 MB arrayBuffer would sit in memory for no reason, and cancelling the
 * stream instead would abort the transfer before the cache gets it.
 */
async function warm(url: string): Promise<void> {
  const res = await fetch(url, {
    // Low priority keeps this behind anything the user actually triggered.
    // Unknown properties are ignored by browsers that do not support them.
    ...( { priority: "low" } as RequestInit),
    cache: "force-cache",
  });
  if (!res.ok || !res.body) return;

  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    state.bytes += value?.byteLength ?? 0;
  }
}
