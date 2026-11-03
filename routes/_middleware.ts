/**
 * @file _middleware.ts
 * @description Cache headers for the Python runtime.
 *
 *              Fresh sends an ETag for static files but no Cache-Control, so
 *              the browser revalidates every one of them on every page load.
 *              For eleven megabytes across five files that is five round trips
 *              before Python can even start.
 *
 *              These files are safe to pin: they belong to one Pyodide release
 *              and never change under the same name. Upgrading means fetching a
 *              new version into the folder, and the version is part of what
 *              gets fetched.
 */

import { FreshContext } from "$fresh/server.ts";
import { releaseAsset } from "../utils/buildRelease.ts";
import { fromFileUrl } from "$std/path/mod.ts";

/** One year, the longest value the spec allows to be meaningful. */
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function handler(req: Request, ctx: FreshContext) {
  const asset = await releaseAsset(req, fromFileUrl(new URL("../", import.meta.url)));
  if (asset) return asset;
  const res = await ctx.next();
  const path = new URL(req.url).pathname;

  if (res.headers.get("content-type")?.includes("text/html")) {
    const headers = new Headers(res.headers);
    headers.set("cache-control", "no-store");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  if (path.startsWith("/pyodide/") && res.status === 200) {
    const headers = new Headers(res.headers);
    headers.set("cache-control", `public, max-age=${ONE_YEAR}, immutable`);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
  return res;
}
