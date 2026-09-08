/**
 * @file slidesTools.ts
 * @description What the assistant may do with the presentations.
 *
 *              The same rule as for the word processor: the assistant sees
 *              the names of the decks at all times, so it can offer to help
 *              with one; it sees a deck's contents only after being asked;
 *              and it may change one only when the writer has ticked the
 *              box. Without that permission every action here refuses, in
 *              words the assistant can pass on.
 *
 *              The assistant describes slides as content - a title, bullet
 *              points, a picture by its id - and the layouts do the placing.
 *              After every change it gets the deck back as text, so it can
 *              see what it made and what the writer changed since.
 */

import { type Deck, deckToText, type Slide } from "./pptx.ts";
import { buildDeck, buildSlide, DEFAULT_THEME, type SlideSpec, THEMES, themeOf } from "./slideLayouts.ts";
import {
  type DeckMeta,
  type DeckRecord,
  deleteDeck,
  freeDeckName,
  listDecks,
  loadDeck,
  newDeckId,
  renameDeck,
  saveDeck,
} from "./slideStore.ts";

export const SLIDES_PERMISSION_KEY = "bude-slides-allow-assistant";

/** How much of a deck goes into the context at once. */
export const MAX_DECK_CHARS = 14_000;

export function isSlidesAssistantAllowed(): boolean {
  try {
    return localStorage.getItem(SLIDES_PERMISSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSlidesAssistantAllowed(allowed: boolean) {
  try {
    if (allowed) localStorage.setItem(SLIDES_PERMISSION_KEY, "1");
    else localStorage.removeItem(SLIDES_PERMISSION_KEY);
  } catch {
    // Private mode: the permission simply does not stick.
  }
}

export type SlidesAction =
  | { action: "read"; deck?: string }
  | { action: "create"; name: string; theme?: string; slides: SlideSpec[] }
  | { action: "replace"; deck?: string; theme?: string; slides: SlideSpec[] }
  | ({ action: "add_slide"; deck?: string; after?: number } & SlideSpec)
  | ({ action: "replace_slide"; deck?: string; slide: number } & SlideSpec)
  | { action: "delete_slide"; deck?: string; slide: number }
  | { action: "rename"; deck?: string; name: string }
  | { action: "delete"; deck: string };

export interface SlidesToolResult {
  ok: boolean;
  message: string;
  /** Which deck to show afterwards, when the action produced one. */
  openId?: string;
  /** What the model should see of the result. */
  snapshot?: string;
  /** A chip for the chat: the deck, offered as .pptx. */
  attachment?: { deckId: string; name: string; slides: number };
}

/** Names only, for the system prompt. */
export function describeDecks(decks: DeckMeta[]): string {
  if (decks.length === 0) return "";
  const lines = decks.slice(0, 40).map((d) =>
    `- "${d.name}" (${d.slideCount} Folien, geändert ${d.updated.slice(0, 10)})`
  );
  if (decks.length > 40) lines.push(`- ... ${decks.length - 40} weitere`);
  return `Im Präsentationsfenster liegen ${decks.length} Präsentation(en):\n` + lines.join("\n");
}

/** One deck as text, clipped, for when the assistant was asked to look. */
export function describeDeck(rec: DeckRecord): string {
  const text = deckToText(rec.deck);
  const clipped = text.length > MAX_DECK_CHARS
    ? text.slice(0, MAX_DECK_CHARS) + `\n... [${text.length - MAX_DECK_CHARS} Zeichen gekürzt]`
    : text;
  const theme = rec.deck.theme ? `, Thema "${rec.deck.theme}"` : "";
  return `Präsentation "${rec.name}" (${rec.deck.slides.length} Folien${theme}):\n\n${clipped}`;
}

/**
 * Finds a deck by id, or by name, case-insensitively.
 *
 * Without a name: the one on screen, or else the one most recently touched.
 * "Read the presentation" right after building it means that one, and asking
 * "which?" when there is only one - or one obvious one - is a dead end for
 * the assistant, which cannot answer and simply stops.
 */
async function find(ref: string | undefined, currentId?: string): Promise<DeckRecord | null> {
  if (!ref) {
    if (currentId) {
      const cur = await loadDeck(currentId);
      if (cur) return cur;
    }
    const newest = (await listDecks())[0];
    return newest ? await loadDeck(newest.id) : null;
  }
  const direct = await loadDeck(ref);
  if (direct) return direct;
  const wanted = ref.trim().toLowerCase().replace(/\.pptx?$/, "");
  const metas = await listDecks();
  const hit = metas.find((d) => d.name.toLowerCase() === wanted) ??
    metas.find((d) => d.name.toLowerCase().includes(wanted));
  return hit ? await loadDeck(hit.id) : null;
}

/** Slide specs out of whatever the model sent - a lone object is one slide. */
function specsOf(raw: unknown): SlideSpec[] {
  if (Array.isArray(raw)) return raw.filter((s) => s && typeof s === "object") as SlideSpec[];
  if (raw && typeof raw === "object") return [raw as SlideSpec];
  return [];
}

/** The spec part of an add_slide / replace_slide action. */
function specFromAction(a: Record<string, unknown>): SlideSpec {
  const { action: _a, deck: _d, after: _af, slide: _s, ...spec } = a;
  return spec as SlideSpec;
}

function missingNote(missing: string[]): string {
  if (!missing.length) return "";
  const ids = [...new Set(missing)].map((m) => `"${m}"`).join(", ");
  return `\n\nHinweis: Bild ${ids} gibt es in diesem Gespräch nicht - die Folie steht ohne Bild da. ` +
    `Erzeuge eines mit {"imagegen": ...} und setze die Folie dann mit replace_slide neu.`;
}

/**
 * Applies one action.
 *
 * `currentId` is the deck on screen; actions without an explicit target
 * apply to it. `resolveImage` turns an image id from the conversation into
 * a data: URL, or null when there is no such image.
 */
export async function applySlidesAction(
  action: SlidesAction,
  currentId: string | undefined,
  resolveImage: (ref: string) => string | null,
): Promise<SlidesToolResult> {
  if (!isSlidesAssistantAllowed()) {
    return {
      ok: false,
      message:
        "Ich darf die Präsentationen im Folienfenster nicht öffnen oder ändern. " +
        "Setze im Fenster „Slides“ links unten das Häkchen bei „Bud-E darf meine " +
        "Präsentationen lesen und bearbeiten“, dann gerne.",
    };
  }

  const full = (rec: DeckRecord): SlidesToolResult => ({
    ok: true,
    message: "",
    openId: rec.id,
    snapshot: describeDeck(rec),
    attachment: { deckId: rec.id, name: rec.name, slides: rec.deck.slides.length },
  });
  const quotaFail = (name: string): SlidesToolResult => ({
    ok: false,
    message: `"${name}" ließ sich nicht speichern - der Speicher im Browser ist voll. ` +
      "Lösche eine Präsentation mit vielen Bildern.",
  });

  switch (action.action) {
    case "read": {
      const rec = await find(action.deck, currentId);
      if (!rec) return { ok: false, message: nameHelp(action.deck, await listDecks()) };
      return { ok: true, message: `Präsentation "${rec.name}" gelesen.`, openId: rec.id, snapshot: describeDeck(rec) };
    }

    case "create": {
      const specs = specsOf((action as { slides?: unknown }).slides);
      if (!specs.length) return { ok: false, message: 'Es fehlen die Folien: "slides" ist leer.' };
      const name = await freeDeckName(action.name || "Ohne Titel");
      const id = newDeckId();
      const { deck, missingImages } = buildDeck(specs, action.theme, resolveImage);
      if (!(await saveDeck({ id, name, deck }))) return quotaFail(name);
      const rec = (await loadDeck(id))!;
      return {
        ...full(rec),
        message: `Präsentation "${name}" mit ${deck.slides.length} Folien angelegt.` + missingNote(missingImages),
      };
    }

    case "replace": {
      const rec = await find(action.deck, currentId);
      if (!rec) return { ok: false, message: nameHelp(action.deck, await listDecks()) };
      const specs = specsOf((action as { slides?: unknown }).slides);
      if (!specs.length) return { ok: false, message: 'Es fehlen die Folien: "slides" ist leer.' };
      const { deck, missingImages } = buildDeck(specs, action.theme ?? rec.deck.theme, resolveImage);
      if (!(await saveDeck({ ...rec, deck }))) return quotaFail(rec.name);
      const fresh = (await loadDeck(rec.id))!;
      return { ...full(fresh), message: `"${rec.name}" neu aufgebaut, ${deck.slides.length} Folien.` + missingNote(missingImages) };
    }

    case "add_slide":
    case "replace_slide": {
      const rec = await find(action.deck, currentId);
      if (!rec) return { ok: false, message: nameHelp(action.deck, await listDecks()) };
      const theme = themeOf(rec.deck.theme ?? DEFAULT_THEME);
      const spec = specFromAction(action as unknown as Record<string, unknown>);
      const slides: Slide[] = [...rec.deck.slides];
      let msg: string;
      let missing: string[] = [];
      if (action.action === "add_slide") {
        const built = buildSlide(spec, theme, resolveImage, { first: slides.length === 0 });
        if (built.missingImage) missing = [built.missingImage];
        const after = typeof action.after === "number" ? Math.max(0, Math.min(slides.length, Math.floor(action.after))) : slides.length;
        slides.splice(after, 0, built.slide);
        msg = `Folie ${after + 1} in "${rec.name}" eingefügt.`;
      } else {
        const n = Math.floor(action.slide);
        if (!(n >= 1 && n <= slides.length)) {
          return { ok: false, message: `Folie ${action.slide} gibt es nicht - "${rec.name}" hat ${slides.length} Folien.` };
        }
        const built = buildSlide(spec, theme, resolveImage, { first: n === 1 });
        if (built.missingImage) missing = [built.missingImage];
        // Keep the identity, so an open editor stays on the same slide.
        slides[n - 1] = { ...built.slide, id: slides[n - 1].id };
        msg = `Folie ${n} in "${rec.name}" neu gesetzt.`;
      }
      const deck: Deck = { ...rec.deck, slides };
      if (!(await saveDeck({ ...rec, deck }))) return quotaFail(rec.name);
      const fresh = (await loadDeck(rec.id))!;
      return { ...full(fresh), message: msg + missingNote(missing) };
    }

    case "delete_slide": {
      const rec = await find(action.deck, currentId);
      if (!rec) return { ok: false, message: nameHelp(action.deck, await listDecks()) };
      const n = Math.floor(action.slide);
      if (!(n >= 1 && n <= rec.deck.slides.length)) {
        return { ok: false, message: `Folie ${action.slide} gibt es nicht - "${rec.name}" hat ${rec.deck.slides.length} Folien.` };
      }
      const slides = rec.deck.slides.filter((_, i) => i !== n - 1);
      if (!(await saveDeck({ ...rec, deck: { ...rec.deck, slides } }))) return quotaFail(rec.name);
      const fresh = (await loadDeck(rec.id))!;
      return { ...full(fresh), message: `Folie ${n} aus "${rec.name}" gelöscht.` };
    }

    case "rename": {
      const rec = await find(action.deck, currentId);
      if (!rec) return { ok: false, message: nameHelp(action.deck, await listDecks()) };
      const name = await freeDeckName(action.name);
      const ok = await renameDeck(rec.id, name);
      return ok
        ? { ok: true, message: `Umbenannt in "${name}".`, openId: rec.id }
        : { ok: false, message: "Das Umbenennen hat nicht funktioniert." };
    }

    case "delete": {
      const rec = await find(action.deck);
      if (!rec) return { ok: false, message: nameHelp(action.deck, await listDecks()) };
      await deleteDeck(rec.id);
      return { ok: true, message: `"${rec.name}" gelöscht.` };
    }
  }
  return { ok: false, message: "Unbekannte Aktion." };
}

/** A refusal that says what would have worked. */
function nameHelp(wanted: string | undefined, decks: DeckMeta[]): string {
  if (decks.length === 0) {
    return "Es gibt noch keine Präsentationen. Ich kann eine anlegen, wenn du magst.";
  }
  const names = decks.slice(0, 10).map((d) => `"${d.name}"`).join(", ");
  return wanted
    ? `Eine Präsentation namens "${wanted}" finde ich nicht. Vorhanden sind: ${names}.`
    : `Welche Präsentation meinst du? Vorhanden sind: ${names}.`;
}

export { THEMES };
