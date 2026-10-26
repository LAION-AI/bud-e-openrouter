/**
 * @file docStore.ts
 * @description Where the word processor keeps its documents.
 *
 *              IndexedDB rather than localStorage, because a document with
 *              two photographs in it is several megabytes and localStorage
 *              gives up at five for everything together. The same reason
 *              imageStore.ts exists.
 *
 *              A document is HTML plus a name. Nothing else is stored - no
 *              format of our own, no version history - so that opening one in
 *              the editor and exporting it as .docx are the only two things
 *              that can go wrong.
 */

const DB_NAME = "bude-docs";
const DB_VERSION = 1;
const STORE = "docs";

/** What the list shows and the assistant may see. */
export interface DocMeta {
  id: string;
  name: string;
  created: string;
  updated: string;
  /** Characters of text, for the list and for the assistant's overview. */
  chars: number;
}

export interface DocRecord extends DocMeta {
  /** The document itself, as the editor's HTML. */
  html: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by id; the update time is indexed so the list can show the
        // most recently touched document first without reading every record.
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("updated", "updated");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn("[docStore] IndexedDB open failed:", req.error);
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

export function newDocId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Rough character count, for the list. Cheap on purpose. */
function countChars(html: string): number {
  return html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").trim().length;
}

/** Everything in the store, newest first, without the documents themselves. */
export async function listDocs(): Promise<DocMeta[]> {
  try {
    const all = await tx<DocRecord[]>("readonly", (s) => s.getAll());
    return all
      .map(({ id, name, created, updated, chars }) => ({
        id,
        name,
        created,
        updated,
        chars,
      }))
      .sort((a, b) => (a.updated < b.updated ? 1 : -1));
  } catch {
    return [];
  }
}

export async function loadDoc(id: string): Promise<DocRecord | null> {
  try {
    return (await tx<DocRecord | undefined>("readonly", (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes a document.
 *
 * Returns false when it could not be stored - the caller then has to keep it
 * in the editor rather than telling the writer it is safe. A quota that is
 * full is the realistic case: a few large photographs get there quickly.
 */
export async function saveDoc(
  doc: { id: string; name: string; html: string; created?: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  const record: DocRecord = {
    id: doc.id,
    name: doc.name.trim() || "Ohne Titel",
    html: doc.html,
    created: doc.created ?? now,
    updated: now,
    chars: countChars(doc.html),
  };
  try {
    await tx("readwrite", (s) => s.put(record));
    return true;
  } catch (err) {
    console.warn("[docStore] save failed:", err);
    return false;
  }
}

export async function deleteDoc(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch (err) {
    console.warn("[docStore] delete failed:", err);
  }
}

/** Renames without touching the content. */
export async function renameDoc(id: string, name: string): Promise<boolean> {
  const doc = await loadDoc(id);
  if (!doc) return false;
  return await saveDoc({ ...doc, name });
}

/**
 * A name that is not taken yet.
 *
 * Importing the same file twice should give two documents, not one that
 * silently replaced the other.
 */
export async function freeName(wanted: string): Promise<string> {
  const taken = new Set((await listDocs()).map((d) => d.name.toLowerCase()));
  const base = wanted.trim() || "Ohne Titel";
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 500; i++) {
    const tryName = `${base} (${i})`;
    if (!taken.has(tryName.toLowerCase())) return tryName;
  }
  return `${base} (${Date.now()})`;
}
