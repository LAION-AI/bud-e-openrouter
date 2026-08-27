/**
 * @file docsTools.ts
 * @description What the assistant may do with the writer's documents.
 *
 *              The rule is the same as for the notebook: the assistant sees
 *              the names of the documents at all times, because otherwise it
 *              cannot offer to help with one. It sees a document's contents
 *              only after being asked, and it may only change one when the
 *              writer has ticked the box.
 *
 *              Without that permission every action here refuses. The refusal
 *              is worded so the assistant can pass it on rather than trying
 *              again.
 */

import {
  deleteDoc,
  type DocMeta,
  type DocRecord,
  freeName,
  listDocs,
  loadDoc,
  newDocId,
  renameDoc,
  saveDoc,
} from "./docStore.ts";
import { htmlToPlainText } from "./docxRich.ts";

export const DOCS_PERMISSION_KEY = "bude-docs-allow-assistant";

/** How much of a document goes into the context at once. */
export const MAX_DOC_CHARS = 12_000;

export function isDocsAssistantAllowed(): boolean {
  try {
    return localStorage.getItem(DOCS_PERMISSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDocsAssistantAllowed(allowed: boolean) {
  try {
    if (allowed) localStorage.setItem(DOCS_PERMISSION_KEY, "1");
    else localStorage.removeItem(DOCS_PERMISSION_KEY);
  } catch {
    // Private mode: the permission simply does not stick.
  }
}

export type DocsAction =
  /** Read one document - by name or id, or the one on screen. */
  | { action: "read"; doc?: string }
  /** Write a new document. Text is Markdown-ish; see markdownish() below. */
  | { action: "create"; name: string; text: string }
  /** Replace the whole text of a document. */
  | { action: "replace"; doc?: string; text: string }
  /** Add at the end. */
  | { action: "append"; doc?: string; text: string }
  | { action: "rename"; doc?: string; name: string }
  | { action: "delete"; doc: string };

export interface DocsToolResult {
  ok: boolean;
  message: string;
  /** Which document to show afterwards, when the action produced one. */
  openId?: string;
  /** What the model should see of the result. */
  snapshot?: string;
}

/**
 * The list of documents, for the system prompt.
 *
 * Names only. That is enough for the assistant to say "shall I look at your
 * essay?" and not enough for it to have read anything.
 */
export function describeDocs(docs: DocMeta[]): string {
  if (docs.length === 0) return "";
  const lines = docs.slice(0, 40).map((d) =>
    `- "${d.name}" (${d.chars} Zeichen, geändert ${d.updated.slice(0, 10)})`
  );
  if (docs.length > 40) lines.push(`- ... ${docs.length - 40} weitere`);
  return `Im Textverarbeitungsfenster liegen ${docs.length} Dokument(e):\n` +
    lines.join("\n");
}

/** One document as text, clipped, for when the assistant was asked to look. */
export function describeDoc(doc: DocRecord): string {
  const text = htmlToPlainText(doc.html);
  const clipped = text.length > MAX_DOC_CHARS
    ? text.slice(0, MAX_DOC_CHARS) +
      `\n... [${text.length - MAX_DOC_CHARS} Zeichen gekürzt]`
    : text;
  return `Dokument "${doc.name}" (${text.length} Zeichen):\n\n${clipped}`;
}

/**
 * Turns the assistant's text into the editor's HTML.
 *
 * The assistant writes Markdown because that is what it is fluent in, and
 * this is the small subset a document needs. Anything else stays as text
 * rather than being guessed at.
 */
export function markdownish(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+?)\*/g, "$1<em>$2</em>")
      .replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      .replace(/\^(\w+)\^/g, "<sup>$1</sup>")
      .replace(/~(\w+)~/g, "<sub>$1</sub>");

  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*([-*+])\s+/.test(line)) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList();
      out.push("<hr>");
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n") || "<p><br></p>";
}

/** Finds a document by id, or by name, case-insensitively. */
async function find(ref: string | undefined, currentId?: string): Promise<DocRecord | null> {
  if (!ref) return currentId ? await loadDoc(currentId) : null;
  const direct = await loadDoc(ref);
  if (direct) return direct;
  const wanted = ref.trim().toLowerCase().replace(/\.docx?$/, "");
  const metas = await listDocs();
  const hit = metas.find((d) => d.name.toLowerCase() === wanted) ??
    metas.find((d) => d.name.toLowerCase().includes(wanted));
  return hit ? await loadDoc(hit.id) : null;
}

/**
 * Applies one action.
 *
 * `currentId` is the document on screen; actions without an explicit target
 * apply to it, which is what someone means by "add a sentence at the end".
 */
export async function applyDocsAction(
  action: DocsAction,
  currentId?: string,
): Promise<DocsToolResult> {
  if (!isDocsAssistantAllowed()) {
    return {
      ok: false,
      message:
        "Ich darf die Dokumente im Textverarbeitungsfenster nicht öffnen oder " +
        "ändern. Setze im Fenster „Docs“ links unten das Häkchen bei „Bud-E " +
        "darf meine Dokumente lesen und bearbeiten“, dann gerne.",
    };
  }

  switch (action.action) {
    case "read": {
      const doc = await find(action.doc, currentId);
      if (!doc) {
        return { ok: false, message: nameHelp(action.doc, await listDocs()) };
      }
      return {
        ok: true,
        message: `Dokument "${doc.name}" gelesen.`,
        openId: doc.id,
        snapshot: describeDoc(doc),
      };
    }

    case "create": {
      const name = await freeName(action.name || "Ohne Titel");
      const id = newDocId();
      const html = markdownish(action.text ?? "");
      const ok = await saveDoc({ id, name, html });
      if (!ok) {
        return {
          ok: false,
          message: "Das Dokument ließ sich nicht speichern - der Speicher im " +
            "Browser ist voll. Lösche ein Dokument mit vielen Bildern.",
        };
      }
      return {
        ok: true,
        message: `Dokument "${name}" angelegt.`,
        openId: id,
        snapshot: `Angelegt: "${name}" (${htmlToPlainText(html).length} Zeichen)`,
      };
    }

    case "replace":
    case "append": {
      const doc = await find(action.doc, currentId);
      if (!doc) {
        return { ok: false, message: nameHelp(action.doc, await listDocs()) };
      }
      const added = markdownish(action.text ?? "");
      const html = action.action === "append" ? `${doc.html}\n${added}` : added;
      const ok = await saveDoc({ ...doc, html });
      if (!ok) {
        return {
          ok: false,
          message: `"${doc.name}" ließ sich nicht speichern - der Speicher im ` +
            "Browser ist voll.",
        };
      }
      const verb = action.action === "append" ? "ergänzt" : "neu geschrieben";
      return {
        ok: true,
        message: `"${doc.name}" ${verb}.`,
        openId: doc.id,
        snapshot: describeDoc({ ...doc, html }),
      };
    }

    case "rename": {
      const doc = await find(action.doc, currentId);
      if (!doc) {
        return { ok: false, message: nameHelp(action.doc, await listDocs()) };
      }
      const name = await freeName(action.name);
      const ok = await renameDoc(doc.id, name);
      return ok
        ? { ok: true, message: `Umbenannt in "${name}".`, openId: doc.id }
        : { ok: false, message: "Das Umbenennen hat nicht funktioniert." };
    }

    case "delete": {
      const doc = await find(action.doc);
      if (!doc) {
        return { ok: false, message: nameHelp(action.doc, await listDocs()) };
      }
      await deleteDoc(doc.id);
      return { ok: true, message: `"${doc.name}" gelöscht.` };
    }
  }
  return { ok: false, message: "Unbekannte Aktion." };
}

/** A refusal that says what would have worked. */
function nameHelp(wanted: string | undefined, docs: DocMeta[]): string {
  if (docs.length === 0) {
    return "Es gibt noch keine Dokumente. Ich kann eines anlegen, wenn du magst.";
  }
  const names = docs.slice(0, 10).map((d) => `"${d.name}"`).join(", ");
  return wanted
    ? `Ein Dokument namens "${wanted}" finde ich nicht. Vorhanden sind: ${names}.`
    : `Welches Dokument meinst du? Vorhanden sind: ${names}.`;
}
