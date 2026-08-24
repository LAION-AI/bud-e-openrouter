/**
 * @file learning-paths.ts
 * @description Serves the learning paths, built-in ones and dropped-in files.
 *
 *              The modal already has the built-in paths compiled into it, so
 *              this route exists for the ones read from disk. It always returns
 *              the complete, merged set: the client can simply replace what it
 *              has rather than work out what changed.
 *
 *              Problems in a file are returned as well, not just logged. A
 *              teacher who has just written a path and sees nothing happen
 *              needs to be told why, and going through the server log is not a
 *              reasonable thing to ask of them.
 */

import { Handlers } from "$fresh/server.ts";
import { subjects } from "../../utils/learningPaths.ts";
import { allSubjects } from "../../utils/learningPathsDir.ts";

export const handler: Handlers = {
  async GET(req) {
    const url = new URL(req.url);
    // ?reload=1 skips the 30-second cache, for editing a file and looking.
    const force = url.searchParams.get("reload") === "1";

    try {
      const report = await allSubjects(subjects, force);
      return new Response(
        JSON.stringify({
          subjects: report.subjects,
          files: report.files,
          errors: report.errors,
          warnings: report.warnings,
          scannedAt: report.scannedAt,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            // The folder may change at any time; a cached answer would be the
            // one thing that makes "drop a file in and reload" not work.
            "Cache-Control": "no-store",
          },
        },
      );
    } catch (err) {
      console.error("[learning-paths] failed:", err);
      // Falling back to the built-in set keeps the tiles working even if the
      // folder is unreadable.
      return new Response(
        JSON.stringify({
          subjects,
          files: 0,
          errors: [String(err)],
          warnings: [],
          scannedAt: Date.now(),
        }),
        { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
      );
    }
  },
};
