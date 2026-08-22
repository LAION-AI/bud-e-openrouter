/**
 * @file openrouter.ts
 * @description Everything the server needs to talk to OpenRouter directly.
 *
 *              When the universal key looks like an OpenRouter key, the four
 *              API routes (chat, stt, tts, imagegen) stop going through the
 *              middleware and speak to OpenRouter themselves. Three things
 *              turned out to need real work rather than a URL swap:
 *
 *              1. OpenRouter has no transcription endpoint for Gemini - its
 *                 /audio/transcriptions replies "model does not exist". So ASR
 *                 is a chat completion with an `input_audio` part and a strict
 *                 transcribe-only instruction, the same trick the middleware
 *                 uses against Vertex.
 *              2. Gemini TTS returns raw PCM and refuses every other format
 *                 ("only supports response_format=pcm"), which no <audio>
 *                 element can play. It gets a WAV header here. Grok's TTS in
 *                 contrast returns ready-made MP3.
 *              3. eu.openrouter.ai is an enterprise feature and answers 403 for
 *                 ordinary keys, so EU processing cannot be had by switching
 *                 host. It has to be pinned per request via provider.only with
 *                 a region tag like "azure/eu".
 */

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * OpenRouter's own EU host. Using it means OpenRouter processes the request in
 * the EU too, not just the model provider - but it is an enterprise feature and
 * answers 403 "Regional routing not enabled for this account" for ordinary
 * keys, so it can only ever be tried, never assumed.
 */
export const OPENROUTER_EU_BASE = "https://eu.openrouter.ai/api/v1";

/** The roles the frontend needs a model for. */
export type Role = "llm" | "vlm" | "asr" | "tts" | "image" | "music";

export const ROLES: Role[] = ["llm", "vlm", "asr", "tts", "image", "music"];

/**
 * Preferred model first, the user's chosen alternative second.
 *
 * Both entries are tried in order; only if both fail does the code fall back to
 * picking something comparable out of the live catalogue.
 */
export const OR_DEFAULTS: Record<Role, string[]> = {
  llm: ["openai/gpt-5.6-luna-pro", "google/gemini-2.5-pro"],
  vlm: ["openai/gpt-5.6-luna-pro", "google/gemini-2.5-pro"],
  asr: ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash"],
  // Grok zuerst: gemessen 0,80 $ je Stunde Sprache gegen 1,80-3,60 $ bei
  // Gemini. Grok rechnet nach Eingabe-Zeichen ab, ist also unabhaengig von der
  // Sprechdauer und wird durch das Zerlegen in Chunks nicht teurer - bei Gemini
  // verdoppelt genau das die Kosten.
  tts: ["x-ai/grok-voice-tts-1.0", "google/gemini-3.1-flash-tts-preview"],
  image: [
    "google/gemini-3.1-flash-lite-image",
    "google/gemini-3.1-flash-image",
  ],
  // Ganze Lieder mit Strophen und Refrain, 0,08 $ je Song. Der Clip macht nur
  // 30 Sekunden fuer 0,04 $ und lieferte im Test bei "Instrumental" gar kein
  // Audio, taugt also hoechstens als Rueckfallebene.
  music: ["google/lyria-3-pro-preview", "google/lyria-3-clip-preview"],
};

/** Region suffixes that mean "processed inside the EU". */
const EU_SUFFIXES = [
  "/eu",
  "/europe",
  "/eu-west-1",
  "/eu-central-1",
  "/swedencentral",
];

export function isEuTag(tag: string | null | undefined): boolean {
  if (!tag) return false;
  return EU_SUFFIXES.some((s) => tag.endsWith(s));
}

/** An OpenRouter key. Anything else keeps the old middleware path. */
export function isOpenRouterKey(key: string | null | undefined): boolean {
  return /^sk-or-v1-[A-Za-z0-9]/.test((key ?? "").trim());
}

export interface CatalogModel {
  id: string;
  name: string;
  /** Zero data retention available for this model. */
  zdr: boolean;
  /** Has at least one endpoint that runs inside the EU. */
  eu: boolean;
  /** The provider tag to pin for EU processing, e.g. "azure/eu". */
  euTag?: string;
  roles: Role[];
  /** Emits real speech, as opposed to music. Only meaningful for role "tts". */
  speaks?: boolean;
  promptPrice: number;
  completionPrice: number;
  context: number;
  /** True for models absent from /api/v1/models (previews are not listed). */
  unlisted?: boolean;
}

export interface Catalog {
  models: CatalogModel[];
  fetchedAt: number;
  /** Set when the data is stale because a refresh failed. */
  stale?: boolean;
}

/* ===================== capability classification ===================== */

interface RawArch {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
}

/**
 * Recognises a music generator.
 *
 * The modality alone cannot tell them apart: Lyria and OpenAI's speech models
 * both declare `audio` output. Only the identity does, so the check is by name
 * and description - deliberately narrow, because the cost of a false positive
 * is a music model in the read-aloud list, which is exactly the bug this
 * fixes: asked to read a sentence, it would compose a tune.
 */
function isMusicModel(id: string, name?: string, description?: string): boolean {
  const hay = `${id} ${name ?? ""} ${description ?? ""}`.toLowerCase();
  if (/\blyria\b/.test(hay)) return true;
  return /\bmusic (generation|model)\b|\bgenerate music\b|\btext-to-music\b/
    .test(hay);
}

/**
 * Works out which of the six roles a model can fill.
 *
 * Speech output is declared as "speech" by some models and "audio" by others,
 * so both count - which is why a music generator has to be told apart by name.
 */
function rolesOf(
  arch: RawArch,
  id = "",
  name?: string,
  description?: string,
): Role[] {
  const inp = arch.input_modalities ?? [];
  const out = arch.output_modalities ?? [];
  const roles: Role[] = [];
  const music = isMusicModel(id, name, description);

  if (out.includes("speech") || out.includes("audio")) {
    // A music generator belongs in the music list, never in read-aloud.
    roles.push(music ? "music" : "tts");
  }
  if (out.includes("image")) roles.push("image");
  if (out.includes("text")) {
    // Music models emit text too - the lyrics sheet - but they cannot chat.
    if (!music) {
      roles.push("llm");
      if (inp.includes("image")) roles.push("vlm");
      if (inp.includes("audio")) roles.push("asr");
    }
  }
  return roles;
}

/**
 * True for models that declare speech output.
 *
 * A plain "audio" output says nothing about what kind of audio, so only
 * "speech" is treated as a promise of spoken words when ordering the TTS list.
 */
function speaksOf(arch: RawArch): boolean {
  return (arch.output_modalities ?? []).includes("speech");
}

function priceOf(p: Record<string, string> | undefined, field: string): number {
  const v = Number(p?.[field]);
  return Number.isFinite(v) ? v * 1e6 : 0;
}

/* ============================ the catalogue ============================ */

const CATALOG_TTL_MS = 30 * 60 * 1000;
/** How long a failed refresh may keep serving the old list. */
const CATALOG_MAX_STALE_MS = 24 * 60 * 60 * 1000;

let cached: Catalog | null = null;
let inFlight: Promise<Catalog> | null = null;

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
 * Builds the catalogue from three list calls instead of one call per model.
 *
 * Asking /models/{id}/endpoints for all 419 models takes minutes; these three
 * requests give the same ZDR and EU answers in about a second:
 *   - /models              every model with its modalities and prices
 *   - /models?zdr=true     the subset that supports zero data retention
 *   - eu.../models         the subset that the EU host will serve
 *
 * The exact EU *tag* needed for provider pinning is not in any list, so it is
 * resolved lazily per model in euTagFor() and cached.
 */
async function buildCatalog(): Promise<Catalog> {
  const [all, zdr, eu] = await Promise.all([
    getJson(`${OPENROUTER_BASE}/models`),
    getJson(`${OPENROUTER_BASE}/models?zdr=true`).catch(() => ({ data: [] })),
    getJson("https://eu.openrouter.ai/api/v1/models").catch(() => ({
      data: [],
    })),
  ]);

  const zdrIds = new Set<string>((zdr.data ?? []).map((m: any) => m.id));
  const euIds = new Set<string>((eu.data ?? []).map((m: any) => m.id));

  const models: CatalogModel[] = [];
  const seen = new Set<string>();

  for (const m of all.data ?? []) {
    const roles = rolesOf(m.architecture ?? {}, m.id, m.name, m.description);
    if (roles.length === 0) continue;
    seen.add(m.id);
    models.push({
      id: m.id,
      name: m.name ?? m.id,
      zdr: zdrIds.has(m.id),
      eu: euIds.has(m.id),
      roles,
      speaks: speaksOf(m.architecture ?? {}),
      promptPrice: priceOf(m.pricing, "prompt"),
      completionPrice: priceOf(m.pricing, "completion"),
      context: Number(m.context_length) || 0,
    });
  }

  // Preview models - the TTS one among them - are missing from /models
  // entirely. Fetch the ones we care about by hand so they can be selected.
  const extras = new Set<string>();
  for (const list of Object.values(OR_DEFAULTS)) {
    for (const id of list) if (!seen.has(id)) extras.add(id);
  }
  await Promise.all(
    [...extras].map(async (id) => {
      try {
        const d = (await getJson(`${OPENROUTER_BASE}/models/${id}/endpoints`))
          ?.data;
        if (!d) return;
        const eps = d.endpoints ?? [];
        const euEp = eps.find((e: any) => isEuTag(e.tag));
        models.push({
          id: d.id ?? id,
          name: d.name ?? id,
          zdr: zdrIds.has(id),
          eu: Boolean(euEp),
          euTag: euEp?.tag,
          roles: rolesOf(d.architecture ?? {}, d.id ?? id, d.name, d.description),
          speaks: speaksOf(d.architecture ?? {}),
          promptPrice: priceOf(eps[0]?.pricing, "prompt"),
          completionPrice: priceOf(eps[0]?.pricing, "completion"),
          context: Number(d.context_length) || 0,
          unlisted: true,
        });
      } catch {
        // A model we cannot describe simply does not appear in the dropdown.
      }
    }),
  );

  return { models, fetchedAt: Date.now() };
}

/**
 * The catalogue, refreshed at most every 30 minutes.
 *
 * A failed refresh keeps the previous list for up to a day rather than leaving
 * the settings dialog empty - an outage at OpenRouter should not make the
 * model picker look broken.
 */
export async function getCatalog(force = false): Promise<Catalog> {
  const fresh = cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS;
  if (fresh && !force) return cached!;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      cached = await buildCatalog();
      return cached;
    } catch (err) {
      console.error("[OR] catalog refresh failed:", err);
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

/* ======================== EU tag for pinning ======================== */

const euTagCache = new Map<string, string | null>();

/**
 * The provider tag that keeps this model inside the EU, or null.
 *
 * Only called for models actually in use, so this stays at a handful of
 * requests rather than one per catalogue entry.
 */
export async function euTagFor(modelId: string): Promise<string | null> {
  if (euTagCache.has(modelId)) return euTagCache.get(modelId)!;
  let tag: string | null = null;
  try {
    const d = (await getJson(`${OPENROUTER_BASE}/models/${modelId}/endpoints`))
      ?.data;
    for (const e of d?.endpoints ?? []) {
      if (isEuTag(e.tag)) {
        tag = e.tag;
        break;
      }
    }
  } catch {
    tag = null;
  }
  euTagCache.set(modelId, tag);
  return tag;
}

/* =========================== routing policy =========================== */

export interface ProviderPolicy {
  only?: string[];
  zdr?: boolean;
  allow_fallbacks: boolean;
}

/**
 * How hard to try for privacy on a given attempt.
 *
 * "strict" pins the EU region and demands ZDR; "zdr" drops the region but keeps
 * retention off; "plain" is whatever OpenRouter picks. Attempts walk down this
 * list so that a degraded EU endpoint costs a retry, not the whole request.
 */
export type Strictness = "strict" | "zdr" | "plain";

export async function policyFor(
  model: CatalogModel | undefined,
  level: Strictness,
): Promise<ProviderPolicy | undefined> {
  if (level === "plain" || !model) return undefined;

  const policy: ProviderPolicy = { allow_fallbacks: false };
  // Asking for ZDR on a model that has none is a 404, so only ever ask when
  // the catalogue says it exists.
  if (model.zdr) policy.zdr = true;

  if (level === "strict" && model.eu) {
    const tag = model.euTag ?? await euTagFor(model.id);
    if (tag) policy.only = [tag];
  }

  // An empty object would still switch off fallbacks for no benefit.
  if (!policy.zdr && !policy.only) return undefined;
  return policy;
}

/* ========================== model resolution ========================== */

export interface Resolved {
  model: CatalogModel;
  /** Why this one: the configured default, the alternative, or a substitute. */
  origin: "override" | "default" | "alternative" | "substitute";
}

/** Privacy rank: EU+ZDR highest, then EU, then ZDR, then neither. */
export function rank(m: CatalogModel): number {
  return (m.eu ? 2 : 0) + (m.zdr ? 1 : 0);
}

/**
 * Orders one role's models for the settings dropdown.
 *
 * Privacy is the headline sort the user asked for, but three things have to
 * override it or the list becomes useless:
 *   - the two configured models go first, since they are what we recommend;
 *   - ":batch" variants sink, because they are not for interactive use;
 *   - in the TTS list, models that actually speak beat music generators.
 */
export function sortForRole(
  models: CatalogModel[],
  role?: Role,
): CatalogModel[] {
  const preferred = role ? OR_DEFAULTS[role] : [];
  const pinned = (m: CatalogModel) => {
    const i = preferred.indexOf(m.id);
    return i === -1 ? preferred.length : i;
  };
  const batch = (m: CatalogModel) => m.id.includes(":batch") ? 1 : 0;

  return [...models].sort((a, b) => {
    const p = pinned(a) - pinned(b);
    if (p !== 0) return p;
    if (role === "tts") {
      const s = (b.speaks ? 1 : 0) - (a.speaks ? 1 : 0);
      if (s !== 0) return s;
    }
    const t = batch(a) - batch(b);
    if (t !== 0) return t;
    const r = rank(b) - rank(a);
    if (r !== 0) return r;
    const price = a.promptPrice - b.promptPrice;
    if (price !== 0) return price;
    return a.id.localeCompare(b.id);
  });
}

export function modelsForRole(cat: Catalog, role: Role): CatalogModel[] {
  return sortForRole(cat.models.filter((m) => m.roles.includes(role)), role);
}

/**
 * Picks the model for a role: the user's override if it can do the job, then
 * the two configured defaults, then the best-ranked comparable model.
 */
export function resolveModel(
  cat: Catalog,
  role: Role,
  override?: string,
): Resolved | null {
  const byId = (id: string) => cat.models.find((m) => m.id === id);

  const chosen = (override ?? "").trim();
  if (chosen) {
    const m = byId(chosen);
    if (m && m.roles.includes(role)) return { model: m, origin: "override" };
    // An override naming a model that vanished falls through to the defaults
    // rather than failing the request.
  }

  const [pref, alt] = OR_DEFAULTS[role];
  const p = byId(pref);
  if (p) return { model: p, origin: "default" };
  const a = alt ? byId(alt) : undefined;
  if (a) return { model: a, origin: "alternative" };

  const candidates = modelsForRole(cat, role);
  return candidates.length
    ? { model: candidates[0], origin: "substitute" }
    : null;
}

/**
 * The attempts to make for a role, in order.
 *
 * Model first, strictness second: swapping to the alternative model keeps EU
 * and ZDR, whereas relaxing the policy gives them up - so the model swap is
 * tried before the privacy downgrade.
 */
export function attemptsFor(
  cat: Catalog,
  role: Role,
  override?: string,
): Array<{ model: CatalogModel; level: Strictness }> {
  const out: Array<{ model: CatalogModel; level: Strictness }> = [];
  const push = (m: CatalogModel | undefined, level: Strictness) => {
    if (!m) return;
    if (out.some((o) => o.model.id === m.id && o.level === level)) return;
    out.push({ model: m, level });
  };
  const byId = (id: string) => cat.models.find((m) => m.id === id);

  const first = resolveModel(cat, role, override);
  if (!first) return out;

  push(first.model, "strict");
  for (const id of OR_DEFAULTS[role]) {
    const m = byId(id);
    if (m && m.id !== first.model.id) push(m, "strict");
  }
  push(first.model, "zdr");
  push(first.model, "plain");
  return out;
}

/* ========================= host selection ========================= */

/**
 * Whether a key may use the EU host, learned from experience.
 *
 * Keys are remembered by their last eight characters only - enough to tell two
 * keys apart, never enough to reconstruct one if this ever ends up in a log.
 * Unknown keys are treated as allowed so that an enterprise key starts routing
 * through the EU on its very first request, without any configuration.
 */
const regionalRouting = new Map<string, boolean>();

function keyFingerprint(key: string): string {
  return key.trim().slice(-8);
}

export function euHostAllowed(key: string): boolean {
  return regionalRouting.get(keyFingerprint(key)) !== false;
}

export function noteRegionalRouting(key: string, allowed: boolean): void {
  const fp = keyFingerprint(key);
  if (regionalRouting.get(fp) === allowed) return;
  regionalRouting.set(fp, allowed);
  console.log(
    `[OR] regional routing ${allowed ? "available" : "unavailable"} for key ...${fp}`,
  );
}

/** The 403 that means "this key is not an enterprise key". */
function isRegionalDenied(status: number, text: string): boolean {
  return status === 403 && /regional routing/i.test(text);
}

/**
 * Calls OpenRouter, preferring the EU host whenever it can help.
 *
 * The EU host is tried for EU-capable models on a strict attempt; if the
 * account turns out not to have regional routing, that is remembered and the
 * request is immediately repeated on the main host, where `provider.only` with
 * a region tag still keeps the computation inside the EU. So a standard key
 * works today and an enterprise key upgrades itself automatically.
 */
export async function orFetch(
  key: string,
  path: string,
  body: Record<string, unknown>,
  opts: {
    model?: CatalogModel;
    level?: Strictness;
    referer?: string;
    signal?: AbortSignal;
  } = {},
): Promise<{ resp: Response; base: string }> {
  const wantsEu = opts.level === "strict" && opts.model?.eu === true;
  const payload = JSON.stringify(body);
  const headers = orHeaders(key, opts.referer);

  if (wantsEu && euHostAllowed(key)) {
    const resp = await fetch(`${OPENROUTER_EU_BASE}${path}`, {
      method: "POST",
      headers,
      body: payload,
      signal: opts.signal,
    });
    if (resp.ok) {
      noteRegionalRouting(key, true);
      return { resp, base: OPENROUTER_EU_BASE };
    }
    // Read the body to find out why; it is consumed either way.
    const text = await resp.text().catch(() => "");
    if (isRegionalDenied(resp.status, text)) {
      noteRegionalRouting(key, false);
      // Fall through to the main host - region pinning still applies there.
    } else {
      // A real error from the EU host: hand it back rather than silently
      // retrying somewhere else and hiding the cause.
      return {
        resp: new Response(text, {
          status: resp.status,
          headers: resp.headers,
        }),
        base: OPENROUTER_EU_BASE,
      };
    }
  }

  const resp = await fetch(`${OPENROUTER_BASE}${path}`, {
    method: "POST",
    headers,
    body: payload,
    signal: opts.signal,
  });
  return { resp, base: OPENROUTER_BASE };
}

/* =========================== running attempts =========================== */

export interface AttemptOutcome<T> {
  value: T;
  model: string;
  level: Strictness;
  /** Every attempt that failed first, for the log and the response header. */
  tried: string[];
}

/**
 * Walks the attempt chain for a role and returns the first success.
 *
 * `run` should throw on failure; the next attempt then gets a different model
 * or a looser policy. If everything fails the last error is rethrown, so the
 * caller reports the real upstream problem rather than a generic one.
 */
export async function withAttempts<T>(
  cat: Catalog,
  role: Role,
  override: string | undefined,
  run: (
    model: CatalogModel,
    policy: ProviderPolicy | undefined,
    level: Strictness,
  ) => Promise<T>,
): Promise<AttemptOutcome<T>> {
  const attempts = attemptsFor(cat, role, override);
  if (attempts.length === 0) {
    throw new Error(`No OpenRouter model available for role "${role}"`);
  }

  const tried: string[] = [];
  let lastErr: unknown = null;

  for (const { model, level } of attempts) {
    const label = `${model.id}:${level}`;
    try {
      const policy = await policyFor(model, level);
      const value = await run(model, policy, level);
      if (tried.length) {
        console.log(`[OR] ${role} succeeded with ${label} after ${tried.join(", ")}`);
      }
      return { value, model: model.id, level, tried };
    } catch (err) {
      lastErr = err;
      tried.push(label);
      console.error(`[OR] ${role} attempt ${label} failed:`, err);
    }
  }
  throw lastErr ?? new Error(`All OpenRouter attempts failed for "${role}"`);
}

/** Describes the route taken, for the X-OpenRouter-Route response header. */
export function routeHeader<T>(o: AttemptOutcome<T>): string {
  const base = `${o.model};${o.level}`;
  return o.tried.length ? `${base};after=${o.tried.join("|")}` : base;
}

/* ============================== audio ============================== */

/**
 * Default voice per speech model.
 *
 * Not optional: OpenRouter answers "An explicit voice is required for this TTS
 * provider" when the field is missing, and it cannot be looked up either -
 * neither TTS model appears in /api/v1/models, and no model anywhere fills in
 * the `supported_voices` field. These two names were verified by calling the
 * models directly.
 */
const DEFAULT_VOICES: Record<string, string> = {
  "google/gemini-3.1-flash-tts-preview": "Kore",
  "x-ai/grok-voice-tts-1.0": "Eve",
};

export function defaultVoiceFor(modelId: string): string {
  const known = DEFAULT_VOICES[modelId];
  if (known) return known;
  // A model we have not seen before: guess by vendor, since voice names are
  // vendor-specific and a wrong one fails the whole request.
  if (modelId.startsWith("google/")) return "Kore";
  if (modelId.startsWith("x-ai/")) return "Eve";
  return "alloy"; // the OpenAI-compatible default
}

/**
 * The 30 prebuilt Gemini voices.
 *
 * Needed because a voice name belongs to one vendor: handing Google's "Zephyr"
 * to xAI answers 400 and, inside the attempt chain, silently costs the
 * fallback. So a Gemini voice is only ever sent to a Gemini model.
 */
const GEMINI_VOICES = new Set([
  "Charon", "Algieba", "Umbriel", "Iapetus", "Achird", "Rasalgethi",
  "Enceladus", "Sadaltager", "Alnilam", "Orus", "Puck", "Fenrir",
  "Zubenelgenubi", "Kore", "Aoede", "Leda", "Callirrhoe", "Autonoe",
  "Despina", "Erinome", "Laomedeia", "Achernar", "Gacrux", "Pulcherrima",
  "Vindemiatrix", "Sulafat", "Schedar", "Sadachbia", "Zephyr", "Algenib",
]);

/**
 * Voices that belong to models other than Gemini.
 *
 * Kept alongside GEMINI_VOICES so the check works in both directions. It has
 * to: handing Grok's "Eve" to Gemini answers 500 Internal Server Error, which
 * inside the attempt chain looks like an outage rather than a wrong parameter
 * and quietly costs the fallback.
 */
const OTHER_VOICES = new Set([
  // xAI
  "Eve", "Rex", "Leo", "Gork", "Ara",
  // OpenAI
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx",
  "sage", "shimmer", "verse",
]);

/**
 * The voice to send for a given model.
 *
 * A configured voice is honoured unless it plainly belongs to another vendor,
 * in which case the model's own default is used instead. Unknown names are
 * passed through: the caller may well know a voice this code has not heard of.
 */
export function voiceFor(modelId: string, requested?: string): string {
  const want = (requested ?? "").trim();
  if (!want) return defaultVoiceFor(modelId);

  const isGemini = modelId.startsWith("google/");
  // A Gemini voice on a non-Gemini model, or a foreign voice on Gemini.
  if (GEMINI_VOICES.has(want) && !isGemini) return defaultVoiceFor(modelId);
  if (isGemini && OTHER_VOICES.has(want)) return defaultVoiceFor(modelId);
  return want;
}

/**
 * The default narration instruction for Gemini speech.
 *
 * Written in prose because that is what the models understand: Grok takes it
 * in the `instructions` field, Gemini wants it in front of the text (see
 * styleChannelFor). English on purpose - both follow English stage directions
 * more reliably even when the text to read is German. The whole string is
 * editable in the settings, which is why the voice and the format ride along in
 * it rather than being separate fields.
 */
export const DEFAULT_TTS_PROMPT =
  "voice=Eve;format=mp3;style=Emotionally smooth, causal, light-hearted, " +
  "conversational, easy to listen to, with toned down emotions but a relatively " +
  "rapid pace. Not very fast, but like, relatively fast. Someone who talks in a " +
  "nice way that is emotionally genuine, authentic, with mild emotions blending " +
  "into each other. Cherrisisching the user as a wonderful human being, looking " +
  "up up to the user in a humble, genuine way. VERY SMOOTH GENTLE GENUINE STYLE";

export interface TtsDirectives {
  voice?: string;
  format?: string;
  style?: string;
  model?: string;
}

/** The keys understood in a TTS prompt string. */
const TTS_KEYS = ["voice", "format", "style", "model"] as const;

/**
 * Reads a "voice=...;format=...;style=..." string.
 *
 * Values run up to the next known key, so the style may contain semicolons and
 * line breaks as long as it does not start a new directive - which matters,
 * because the style is free prose a user is invited to rewrite. A string with
 * no directives at all is taken to be the style, so someone who simply types
 * how they want it spoken gets what they expect.
 */
export function parseTtsDirectives(raw: string): TtsDirectives {
  const s = (raw ?? "").trim();
  if (!s) return {};

  const re = new RegExp(`(?:^|[;\\n])\\s*(${TTS_KEYS.join("|")})\\s*=`, "gi");
  const hits: Array<{ key: string; from: number; valueAt: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    hits.push({
      key: m[1].toLowerCase(),
      from: m.index,
      valueAt: m.index + m[0].length,
    });
  }
  if (hits.length === 0) return { style: s };

  const out: TtsDirectives = {};
  hits.forEach((hit, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].from : s.length;
    const value = s.slice(hit.valueAt, end).trim().replace(/;+$/, "").trim();
    if (value) (out as Record<string, string>)[hit.key] = value;
  });
  // Anything before the first directive is style text too.
  const lead = s.slice(0, hits[0].from).trim();
  if (lead && !out.style) out.style = lead;
  return out;
}

/**
 * Puts the style in front of the text, the way Gemini expects it.
 *
 * Mirrors what the middleware does in gemini_speech.build_prompt, so a voice
 * sounds the same whichever route it took.
 */
export function buildSpeechPrompt(text: string, style?: string): string {
  const s = (style ?? "").trim();
  if (!s) return text;
  return `${s}\n\nNow read the following text aloud, exactly as written:\n\n${text}`;
}

/**
 * Where a model wants to be told how to speak.
 *
 * The two do not agree, and getting it wrong is loud rather than subtle:
 *   - Gemini ignores the `instructions` field entirely (measured: 1.64 s of
 *     audio with it, 1.60 s without) but follows a style written in front of
 *     the text.
 *   - Grok does the opposite. Given the style in front of the text it reads it
 *     out - "Kurzer Test." became 34 seconds of audio narrating the style,
 *     including the word "cherish". With `instructions` it behaves.
 */
export type StyleChannel = "prompt" | "instructions";

export function styleChannelFor(modelId: string): StyleChannel {
  return modelId.startsWith("google/") ? "prompt" : "instructions";
}

/**
 * Asks for MP3 where the model can deliver it.
 *
 * Uncompressed 24 kHz PCM runs at 48 KB per second, so a spoken paragraph is
 * megabytes - about six times an equivalent MP3. Worth avoiding on a school
 * connection. Gemini however rejects anything but PCM outright ("Gemini TTS
 * only supports response_format=pcm"), so the request must stay silent about
 * the format there rather than be refused.
 */
export function preferredAudioFormat(
  modelId: string,
  requested?: string,
): string | undefined {
  // Gemini rejects every format but PCM, so a "format=mp3" in the prompt is
  // deliberately ignored there rather than turned into a failed request.
  if (modelId.startsWith("google/")) return undefined;
  const want = (requested ?? "").trim().toLowerCase();
  if (want === "pcm") return undefined; // let it come back raw and get wrapped
  return want || "mp3";
}

/**
 * Wraps raw PCM in a WAV container.
 *
 * Gemini TTS only emits `response_format=pcm` (24 kHz, mono, signed 16-bit
 * little-endian) and rejects mp3 outright. Browsers will not play a headerless
 * stream, so the 44 header bytes are added here.
 */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate = 24_000,
  channels = 1,
  bitsPerSample = 16,
): Uint8Array {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Reads sample rate and channel count out of a PCM content type such as
 * `audio/pcm;rate=24000;channels=1`, falling back to Gemini's defaults.
 */
export function parsePcmContentType(
  contentType: string | null,
): { rate: number; channels: number } {
  const ct = (contentType ?? "").toLowerCase();
  const rate = Number(/rate=(\d+)/.exec(ct)?.[1]) || 24_000;
  const channels = Number(/channels=(\d+)/.exec(ct)?.[1]) || 1;
  return { rate, channels };
}

/* ============================== headers ============================== */

/** Attribution headers OpenRouter asks integrations to send. */
export function orHeaders(key: string, referer?: string): HeadersInit {
  const h: Record<string, string> = {
    "Authorization": `Bearer ${key.trim()}`,
    "Content-Type": "application/json",
    "X-Title": "BUD-E",
  };
  if (referer) h["HTTP-Referer"] = referer;
  return h;
}
