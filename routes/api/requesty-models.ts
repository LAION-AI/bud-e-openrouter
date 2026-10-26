/**
 * @file requesty-models.ts
 * @description Serves the Requesty model catalogue to the settings dialog.
 *
 *              The list is grouped by role and already ordered the way it
 *              should appear: the two recommended models first, then EU
 *              zero-retention ahead of plain zero-retention, then the free
 *              models, then everything else. Refreshing is the module's job,
 *              not the browser's - a client that asks every time still only
 *              causes an upstream fetch every 30 minutes.
 */

import { Handlers } from "$fresh/server.ts";
import {
  type RqCatalogModel,
  getRequestyCatalog,
  isRequestyKey,
  RQ_DEFAULTS,
  type RqRole,
  RQ_ROLES,
  rqModelsForRole,
} from "../../utils/requesty.ts";

/** What the dropdown needs. Prices are per million tokens. */
interface Entry {
  id: string;
  name: string;
  zdr: boolean;
  eu: boolean;
  free: boolean;
  promptPrice: number;
  completionPrice: number;
  context: number;
  /** Marks the two models we recommend, so the UI can label them. */
  recommended?: "default" | "alternative";
}

function toEntry(m: RqCatalogModel, role: RqRole): Entry {
  const i = RQ_DEFAULTS[role].indexOf(m.id);
  return {
    id: m.id,
    name: m.name,
    zdr: m.zdr,
    eu: m.eu,
    free: m.free,
    promptPrice: m.promptPrice,
    completionPrice: m.completionPrice,
    context: m.context,
    ...(i === 0
      ? { recommended: "default" as const }
      : i === 1
      ? { recommended: "alternative" as const }
      : {}),
  };
}

export const handler: Handlers = {
  async POST(req) {
    let body: { universalApiKey?: string; force?: boolean };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Bad JSON" }, 400);
    }

    // The catalogue is public data, but there is no reason to fetch it for
    // someone who is not on Requesty in the first place.
    if (!isRequestyKey(body.universalApiKey)) {
      return json({ error: "not a Requesty key" }, 400);
    }

    try {
      const cat = await getRequestyCatalog(body.force === true);
      const roles: Record<string, Entry[]> = {};
      for (const role of RQ_ROLES) {
        roles[role] = rqModelsForRole(cat, role).map((m) => toEntry(m, role));
      }
      return json({
        roles,
        defaults: RQ_DEFAULTS,
        fetchedAt: cat.fetchedAt,
        stale: cat.stale === true,
      });
    } catch (err) {
      console.error("[RQ] catalog request failed:", err);
      return json({ error: "Could not load the model list" }, 502);
    }
  },
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // The module caches for 30 minutes; letting a browser cache on top of
      // that would only delay a manual refresh.
      "Cache-Control": "no-store",
    },
  });
}
