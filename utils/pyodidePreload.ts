/**
 * @file pyodidePreload.ts
 * @description Where the Python runtime is fetched from.
 *
 *              Kept apart from the kernel itself because the answer differs
 *              per installation: served from here when someone ran
 *              "deno task pyodide", from the CDN otherwise.
 */

/** Where the runtime lives when it is served from this installation. */
export const LOCAL_PYODIDE_BASE = "/pyodide/";
export const CDN_PYODIDE_BASE =
  "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/";

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
