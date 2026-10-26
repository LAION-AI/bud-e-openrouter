/**
 * @file slideStore.ts
 * @description Where the slide editor keeps its presentations.
 *
 *              Its own database, next to the word processor's rather than
 *              inside it: a deck with pictures on every slide is tens of
 *              megabytes, and the two stores should be able to fill up and
 *              be cleared independently. The documents database is not
 *              touched - its name, version and record shape stay what they
 *              were, so everything written by earlier versions still opens.
 *
 *              A record is the deck as plain data plus a name. The .pptx is
 *              produced on the way out, never stored.
 */

import type { Deck } from "./pptx.ts";

const DB_NAME = "bude-slides";
const DB_VERSION = 1;
const STORE = "decks";

export interface DeckMeta {
  id: string;
  name: string;
  created: string;
  updated: string;
  slideCount: number;
}

export interface DeckRecord extends DeckMeta {
  deck: Deck;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("updated", "updated");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn("[slideStore] IndexedDB open failed:", req.error);
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then((db) =>
    new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

export function newDeckId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Newest first, without the decks themselves. */
export async function listDecks(): Promise<DeckMeta[]> {
  try {
    const all = await tx<DeckRecord[]>("readonly", (s) => s.getAll());
    return all
      .map(({ id, name, created, updated, slideCount }) => ({ id, name, created, updated, slideCount }))
      .sort((a, b) => (a.updated < b.updated ? 1 : -1));
  } catch {
    return [];
  }
}

export async function loadDeck(id: string): Promise<DeckRecord | null> {
  try {
    return (await tx<DeckRecord | undefined>("readonly", (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

/** False when it could not be stored - a full quota, usually. */
export async function saveDeck(
  rec: { id: string; name: string; deck: Deck; created?: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  const record: DeckRecord = {
    id: rec.id,
    name: rec.name.trim() || "Ohne Titel",
    deck: rec.deck,
    created: rec.created ?? now,
    updated: now,
    slideCount: rec.deck.slides.length,
  };
  try {
    await tx("readwrite", (s) => s.put(record));
    return true;
  } catch (err) {
    console.warn("[slideStore] save failed:", err);
    return false;
  }
}

export async function deleteDeck(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch (err) {
    console.warn("[slideStore] delete failed:", err);
  }
}

export async function renameDeck(id: string, name: string): Promise<boolean> {
  const rec = await loadDeck(id);
  if (!rec) return false;
  return await saveDeck({ ...rec, name });
}

/** A name not taken yet: importing the same file twice gives two decks. */
export async function freeDeckName(wanted: string): Promise<string> {
  const taken = new Set((await listDecks()).map((d) => d.name.toLowerCase()));
  const base = wanted.trim() || "Ohne Titel";
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 500; i++) {
    const tryName = `${base} (${i})`;
    if (!taken.has(tryName.toLowerCase())) return tryName;
  }
  return `${base} (${Date.now()})`;
}
