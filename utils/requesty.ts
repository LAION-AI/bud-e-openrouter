/**
 * @file requesty.ts
 * @description Everything the server needs to talk to Requesty directly.
 *
 *              Shaped like utils/openrouter.ts on purpose - same roles, same
 *              attempt chain, same dropdown groups - but Requesty-correct where
 *              the two gateways differ:
 *
 *              1. Catalogue: one GET /v1/models carries everything (modalities
 *                 as supports_vision, prices, context). Zero retention is a
 *                 per-model flag (data_retention === false) and EU hosting a
 *                 geolocation ("eu") - no three-list dance, no per-model
 *                 endpoint crawl.
 *              2. Privacy: ZDR is an organisation/key setting at Requesty, not
 *                 a per-request parameter, so there is no provider policy to
 *                 send. What the request CAN choose is the road: the Frankfurt
 *                 gateway (router.eu.requesty.ai) keeps Requesty's own side -
 *                 routing, caching, logging - inside the EU. Which data centre
 *                 runs the inference follows the model, hence the EU group.
 *              3. PDFs ride as "input_file" parts (filename + file_data), not
 *                 OpenRouter's "file" parts. Images are plain OpenAI image_url
 *                 parts on both.
 *              4. Only chat roles exist here: Requesty lists no audio or image
 *                 models in /v1/models, so the catalogue serves llm and vlm.
 *                 Anything else keeps whatever path it had before.
 */

export const REQUESTY_BASE = "https://router.requesty.ai/v1";

/**
 * Requesty's own EU gateway in Frankfurt. Unlike OpenRouter's regional host
 * this is a standard feature, not an enterprise one - but it only governs
 * Requesty's side. End-to-end EU still needs a model whose inference runs in
 * the EU, which is what the "eu" flag in the catalogue means.
 */
export const REQUESTY_EU_BASE = "https://router.eu.requesty.ai/v1";

/** A Requesty key. Anything else keeps whatever path it had before. */
export function isRequestyKey(key: string | null | undefined): boolean {
  return /^rqsty-[A-Za-z0-9]/.test((key ?? "").trim());
}

/** The roles a Requesty key can serve: chat, and chat with pictures. */
export type RqRole = "llm" | "vlm";

export const RQ_ROLES: RqRole[] = ["llm", "vlm"];

/**
 * Preferred model first, the alternative second.
 *
 * Both are EU-hosted zero-retention models that exist in the catalogue today;
 * if one disappears the resolver falls through to the best-ranked substitute
 * rather than failing the request.
 */
export const RQ_DEFAULTS: Record<RqRole, string[]> = {
  llm: [
    "vertex/gemini-2.5-flash-lite@europe-west1",
    "openai/gpt-4.1-mini",
  ],
  vlm: [
    "vertex/gemini-2.5-flash-lite@europe-west1",
    "openai/gpt-4.1-mini",
  ],
};

export interface RqCatalogModel {
  id: string;
  name: string;
  /** The model keeps neither prompts nor completions (data_retention false). */
  zdr: boolean;
  /** Inference runs inside the EU (geolocation "eu"). */
  eu: boolean;
  /** Costs nothing per token - the only thing testable without credit. */
  free: boolean;
  roles: RqRole[];
  promptPrice: number;
  completionPrice: number;
  /** Available when Requesty's live catalogue reports an output cap. */
  maxOutputTokens?: number;
  context: number;
}

export interface RqCatalog {
  models: RqCatalogModel[];
  fetchedAt: number;
  /** Set when the data is stale because a refresh failed. */
  stale?: boolean;
}

/* ===================== capability classification ===================== */

function rolesOf(m: {
  supports_vision?: boolean;
}): RqRole[] {
  const roles: RqRole[] = ["llm"];
  if (m.supports_vision === true) roles.push("vlm");
  return roles;
}

function priceOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n * 1e6 : 0;
}

function nameOf(m: { id: string; model_canonical_name?: string }): string {
  return m.model_canonical_name ?? m.id;
}

/* ============================ the catalogue ============================ */

const CATALOG_TTL_MS = 30 * 60 * 1000;
/** How long a failed refresh may keep serving the old list. */
const CATALOG_MAX_STALE_MS = 24 * 60 * 60 * 1000;

let cached: RqCatalog | null = null;
let inFlight: Promise<RqCatalog> | null = null;

// deno-lint-ignore no-explicit-any
async function getJson(url: string, timeoutMs = 20_000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "Accept": "application/json" },
    });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the catalogue from a single list call.
 *
 * Every model carries its own flags, so unlike OpenRouter no second or third
 * request is needed: data_retention false means zero retention, geolocation
 * "eu" means EU inference, zero prices mean a free model.
 */
async function buildCatalog(): Promise<RqCatalog> {
  const all = await getJson(`${REQUESTY_BASE}/models`);
  const models: RqCatalogModel[] = [];

  for (const m of all.data ?? []) {
    if (m?.api !== "chat" || typeof m?.id !== "string") continue;
    const promptPrice = priceOf(m.input_price);
    const completionPrice = priceOf(m.output_price);
    models.push({
      id: m.id,
      name: nameOf(m),
      zdr: m.data_retention === false,
      eu: m.geolocation === "eu",
      free: m.input_price != null && m.output_price != null &&
        String(m.input_price).trim() !== "" &&
        String(m.output_price).trim() !== "" &&
        Number.isFinite(Number(m.input_price)) &&
        Number.isFinite(Number(m.output_price)) &&
        promptPrice === 0 && completionPrice === 0,
      roles: rolesOf(m),
      promptPrice,
      completionPrice,
      maxOutputTokens: Number(
          m.max_output_tokens ?? m.max_completion_tokens ??
            m.output_token_limit,
        ) > 0
        ? Number(
          m.max_output_tokens ?? m.max_completion_tokens ??
            m.output_token_limit,
        )
        : undefined,
      context: Number(m.context_window) || 0,
    });
  }

  return { models, fetchedAt: Date.now() };
}

/**
 * The catalogue, refreshed at most every 30 minutes.
 *
 * A failed refresh keeps the previous list for up to a day rather than leaving
 * the settings dialog empty - an outage at Requesty should not make the model
 * picker look broken.
 */
export function getRequestyCatalog(force = false): Promise<RqCatalog> {
  const fresh = cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS;
  if (fresh && !force) return Promise.resolve(cached!);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      cached = await buildCatalog();
      return cached;
    } catch (err) {
      console.error("[RQ] catalog refresh failed:", err);
      if (cached && Date.now() - cached.fetchedAt < CATALOG_MAX_STALE_MS) {
        return { ...cached, stale: true };
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* ========================== model resolution ========================== */

export interface RqResolved {
  model: RqCatalogModel;
  /** Why this one: the configured default, the alternative, or a substitute. */
  origin: "override" | "default" | "alternative" | "substitute";
}

/**
 * Privacy rank: EU+ZDR highest, then ZDR outside the EU, then free models,
 * then everything else. Free models sit behind ZDR on purpose even though
 * most of them retain data - they are the only ones testable without credit,
 * not the most private ones.
 */
export function rqRank(m: RqCatalogModel): number {
  if (m.eu && m.zdr) return 3;
  if (m.zdr) return 2;
  if (m.free) return 1;
  return 0;
}

/**
 * Orders one role's models for the settings dropdown.
 *
 * The two configured models go first since they are what we recommend; inside
 * the privacy order the cheapest comparable model wins, exactly like the
 * OpenRouter list.
 */
export function rqSortForRole(
  models: RqCatalogModel[],
  role?: RqRole,
): RqCatalogModel[] {
  const preferred = role ? RQ_DEFAULTS[role] : [];
  const pinned = (m: RqCatalogModel) => {
    const i = preferred.indexOf(m.id);
    return i === -1 ? preferred.length : i;
  };

  return [...models].sort((a, b) => {
    const p = pinned(a) - pinned(b);
    if (p !== 0) return p;
    const r = rqRank(b) - rqRank(a);
    if (r !== 0) return r;
    const price = a.promptPrice - b.promptPrice;
    if (price !== 0) return price;
    return a.id.localeCompare(b.id);
  });
}

export function rqModelsForRole(
  cat: RqCatalog,
  role: RqRole,
): RqCatalogModel[] {
  return rqSortForRole(cat.models.filter((m) => m.roles.includes(role)), role);
}

/**
 * Picks the model for a role: the user's override if it can do the job, then
 * the two configured defaults, then the best-ranked comparable model.
 */
export function rqResolveModel(
  cat: RqCatalog,
  role: RqRole,
  override?: string,
): RqResolved | null {
  const byId = (id: string) => cat.models.find((m) => m.id === id);

  const chosen = (override ?? "").trim();
  if (chosen) {
    const m = byId(chosen);
    if (m && m.roles.includes(role)) return { model: m, origin: "override" };
    // An override naming a model that vanished falls through to the defaults
    // rather than failing the request.
  }

  const [pref, alt] = RQ_DEFAULTS[role];
  const p = byId(pref);
  if (p) return { model: p, origin: "default" };
  const a = alt ? byId(alt) : undefined;
  if (a) return { model: a, origin: "alternative" };

  const candidates = rqModelsForRole(cat, role);
  return candidates.length
    ? { model: candidates[0], origin: "substitute" }
    : null;
}

/**
 * How hard to try for privacy on a given attempt.
 *
 * "strict" takes the Frankfurt gateway and only makes sense for EU-hosted
 * models; "plain" is the global gateway. Attempts walk down this list so a
 * hiccup on one road costs a retry, not the whole request.
 */
export type RqStrictness = "strict" | "plain";

/**
 * The attempts to make for a role, in order.
 *
 * Model first, strictness second: swapping to the alternative model keeps EU
 * and ZDR, whereas relaxing to the global gateway gives up Requesty's side of
 * the EU promise - so the model swap is tried before the downgrade. Someone
 * who picked a model in the settings gets that model on both roads before
 * anything else is tried.
 */
export function rqAttemptsFor(
  cat: RqCatalog,
  role: RqRole,
  override?: string,
): Array<{ model: RqCatalogModel; level: RqStrictness }> {
  const out: Array<{ model: RqCatalogModel; level: RqStrictness }> = [];
  const push = (m: RqCatalogModel | undefined, level: RqStrictness) => {
    if (!m) return;
    if (level === "strict" && !m.eu) return;
    if (out.some((o) => o.model.id === m.id && o.level === level)) return;
    out.push({ model: m, level });
  };
  const byId = (id: string) => cat.models.find((m) => m.id === id);

  const first = rqResolveModel(cat, role, override);
  if (!first) return out;
  const chosen = first.origin === "override";

  push(first.model, "strict");
  if (!chosen) {
    for (const id of RQ_DEFAULTS[role]) {
      const m = byId(id);
      if (m && m.id !== first.model.id) push(m, "strict");
    }
  }
  push(first.model, "plain");
  if (chosen) {
    for (const id of RQ_DEFAULTS[role]) {
      const m = byId(id);
      if (m && m.id !== first.model.id) push(m, "plain");
    }
  }
  return out;
}

/* ============================== fetching ============================== */

/** Attribution headers Requesty asks integrations to send. */
export function rqHeaders(key: string, referer?: string): HeadersInit {
  const h: Record<string, string> = {
    "Authorization": `Bearer ${key.trim()}`,
    "Content-Type": "application/json",
    "X-Title": "BUD-E",
  };
  if (referer) h["HTTP-Referer"] = referer;
  return h;
}

/**
 * Calls Requesty, preferring the Frankfurt gateway whenever it can help.
 *
 * The EU road is tried for EU-hosted models on a strict attempt; anything
 * else goes global. A failed strict attempt is handed back, not silently
 * retried elsewhere - the attempt chain owns the retries and reports them.
 */
export async function rqFetch(
  key: string,
  path: string,
  body: Record<string, unknown>,
  opts: {
    model?: RqCatalogModel;
    level?: RqStrictness;
    referer?: string;
    signal?: AbortSignal;
  } = {},
): Promise<{ resp: Response; base: string }> {
  const base = opts.level === "strict" && opts.model?.eu === true
    ? REQUESTY_EU_BASE
    : REQUESTY_BASE;
  const resp = await fetch(`${base}${path}`, {
    method: "POST",
    headers: rqHeaders(key, opts.referer),
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  return { resp, base };
}

/** Describes the route taken, for the X-Requesty-Route response header. */
export function rqRouteHeader(
  o: { model: string; level: RqStrictness; tried: string[] },
): string {
  const base = `${o.model};${o.level}`;
  return o.tried.length ? `${base};after=${o.tried.join("|")}` : base;
}
