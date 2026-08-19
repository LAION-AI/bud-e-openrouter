/**
 * @file notebookStore.ts
 * @description The notebook document: cells, their outputs, and how notebooks
 *              are kept in localStorage.
 *
 *              The shape stays close to the .ipynb format so an export to real
 *              Jupyter remains a small step later.
 */

export const NOTEBOOK_PREFIX = "bude-notebook-";
export const NOTEBOOK_FORMAT = 1;

export type CellKind = "code" | "markdown";

export interface CellOutput {
  type: "stdout" | "stderr" | "result" | "error" | "image";
  /** text for everything except images */
  text?: string;
  /** base64 PNG for images */
  data?: string;
}

export interface NotebookCell {
  id: string;
  type: CellKind;
  source: string;
  outputs: CellOutput[];
  /** execution counter, like the [1] in Jupyter; null when never run */
  count: number | null;
}

export interface Notebook {
  budeNotebook: number;
  id: string;
  name: string;
  created: string;
  updated: string;
  cells: NotebookCell[];
}

export function newCell(type: CellKind = "code", source = ""): NotebookCell {
  return {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 10),
    type,
    source,
    outputs: [],
    count: null,
  };
}

export function newNotebook(name = "Notebook"): Notebook {
  const now = new Date().toISOString();
  return {
    budeNotebook: NOTEBOOK_FORMAT,
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    name,
    created: now,
    updated: now,
    cells: [newCell("code", "print(\"Hallo Welt\")")],
  };
}

/** Guards against a mail or file that is not actually a notebook. */
export function isNotebook(value: unknown): value is Notebook {
  const n = value as Notebook;
  return !!n && typeof n === "object" && Array.isArray(n.cells) &&
    typeof n.id === "string";
}

// ------------------------------------------------------------- persistence

export function listNotebooks(): Notebook[] {
  const out: Notebook[] = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(NOTEBOOK_PREFIX)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
      if (isNotebook(parsed)) out.push(parsed);
    } catch {
      // A damaged entry must not hide the intact ones.
    }
  }
  out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  return out;
}

export function saveNotebook(notebook: Notebook) {
  notebook.updated = new Date().toISOString();
  localStorage.setItem(
    NOTEBOOK_PREFIX + notebook.id,
    JSON.stringify(notebook),
  );
}

export function deleteNotebook(id: string) {
  localStorage.removeItem(NOTEBOOK_PREFIX + id);
}

/** Every notebook in this browser, for inclusion in a mailbox snapshot. */
export function collectNotebooks(): Record<string, Notebook> {
  const out: Record<string, Notebook> = {};
  for (const notebook of listNotebooks()) {
    out[NOTEBOOK_PREFIX + notebook.id] = notebook;
  }
  return out;
}

/** Writes notebooks from a snapshot back into this browser. */
export function restoreNotebooks(
  notebooks: Record<string, unknown> | undefined,
): number {
  if (!notebooks || typeof notebooks !== "object") return 0;
  let count = 0;
  for (const [key, value] of Object.entries(notebooks)) {
    if (!key.startsWith(NOTEBOOK_PREFIX) || !isNotebook(value)) continue;
    localStorage.setItem(key, JSON.stringify(value));
    count++;
  }
  return count;
}

// ----------------------------------------------------------------- helpers

/** Rough size of a notebook, so the UI can warn before a huge backup. */
export function notebookSize(notebook: Notebook): number {
  return JSON.stringify(notebook).length;
}

/**
 * Exports to the Jupyter .ipynb format. Outputs are carried over as plain
 * text and images so the file opens in Jupyter and Colab.
 */
export function toIpynb(notebook: Notebook): string {
  return JSON.stringify(
    {
      cells: notebook.cells.map((cell) => {
        const base = {
          cell_type: cell.type,
          metadata: {},
          source: splitLines(cell.source),
        };
        if (cell.type === "markdown") return base;
        return {
          ...base,
          execution_count: cell.count,
          outputs: cell.outputs.map((out) => toIpynbOutput(out)),
        };
      }),
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
        language_info: { name: "python" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  );
}

// deno-lint-ignore no-explicit-any
function toIpynbOutput(out: CellOutput): any {
  if (out.type === "image") {
    return {
      output_type: "display_data",
      data: { "image/png": out.data ?? "" },
      metadata: {},
    };
  }
  if (out.type === "result") {
    return {
      output_type: "execute_result",
      data: { "text/plain": splitLines(out.text ?? "") },
      metadata: {},
      execution_count: null,
    };
  }
  if (out.type === "error") {
    return {
      output_type: "error",
      ename: "Error",
      evalue: "",
      traceback: splitLines(out.text ?? ""),
    };
  }
  return {
    output_type: "stream",
    name: out.type === "stderr" ? "stderr" : "stdout",
    text: splitLines(out.text ?? ""),
  };
}

/** ipynb stores source as a list of lines, each keeping its newline. */
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line))
    .filter((line, i) => !(i === lines.length - 1 && line === ""));
}
