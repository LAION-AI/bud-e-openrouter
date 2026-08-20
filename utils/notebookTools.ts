/**
 * @file notebookTools.ts
 * @description Lets the assistant read and change the notebook.
 *
 *              Only active while the user has ticked the permission in the
 *              notebook window. Everything runs in the browser against the
 *              notebooks in localStorage; nothing here talks to a server.
 *
 *              The patch language is deliberately small. A model that has to
 *              emit an exact character-level diff gets it wrong; naming a cell
 *              and handing over its full new source is something it manages
 *              reliably.
 */

import {
  isNotebook,
  listNotebooks,
  newCell,
  newNotebook,
  type Notebook,
  type NotebookCell,
  saveNotebook,
} from "./notebookStore.ts";

export const NOTEBOOK_PERMISSION_KEY = "bude-notebook-allow-assistant";
export const NOTEBOOK_LIMITS_KEY = "bude-notebook-context-limits";

export interface NotebookLimits {
  /** characters of source per cell handed to the model */
  sourcePerCell: number;
  /** characters of output per cell (the debugging messages) */
  outputPerCell: number;
  /** how many cells at most */
  maxCells: number;
}

export const DEFAULT_LIMITS: NotebookLimits = {
  sourcePerCell: 1200,
  outputPerCell: 800,
  maxCells: 40,
};

export function loadLimits(): NotebookLimits {
  try {
    const raw = localStorage.getItem(NOTEBOOK_LIMITS_KEY);
    if (!raw) return { ...DEFAULT_LIMITS };
    return { ...DEFAULT_LIMITS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_LIMITS };
  }
}

export function saveLimits(limits: NotebookLimits) {
  localStorage.setItem(NOTEBOOK_LIMITS_KEY, JSON.stringify(limits));
}

export function isAssistantAllowed(): boolean {
  return localStorage.getItem(NOTEBOOK_PERMISSION_KEY) === "1";
}

export function setAssistantAllowed(allowed: boolean) {
  if (allowed) localStorage.setItem(NOTEBOOK_PERMISSION_KEY, "1");
  else localStorage.removeItem(NOTEBOOK_PERMISSION_KEY);
}

// -------------------------------------------------------------- the actions

export type NotebookAction =
  | { action: "read"; notebook?: string }
  | {
    action: "create";
    name: string;
    cells: { type?: "code" | "markdown"; source: string }[];
  }
  | { action: "insert"; after?: number; type?: "code" | "markdown"; source: string }
  | { action: "replace"; cell: number; source: string; type?: "code" | "markdown" }
  | { action: "delete"; cell: number }
  | { action: "rename"; name: string };

export interface ToolResult {
  ok: boolean;
  message: string;
  /** the notebook to switch to, when the action produced one */
  notebook?: Notebook;
  /** a fresh snapshot, so the model can see what it did */
  snapshot?: string;
}

/**
 * A compact view of a notebook for the model: numbered cells, source and
 * output truncated to the configured limits.
 *
 * Numbering starts at 1 because that is what a person reads off the screen,
 * and the model is told the same.
 */
export function describeNotebook(
  notebook: Notebook,
  limits: NotebookLimits = loadLimits(),
): string {
  const lines: string[] = [
    `Notebook "${notebook.name}" (${notebook.cells.length} Zellen)`,
  ];
  const cells = notebook.cells.slice(0, limits.maxCells);

  cells.forEach((cell, i) => {
    const n = i + 1;
    const kind = cell.type === "code" ? "Code" : "Text";
    lines.push("");
    lines.push(`--- Zelle ${n} (${kind}) ---`);
    lines.push(clip(cell.source, limits.sourcePerCell));

    const output = renderOutputs(cell);
    if (output) {
      lines.push(`--- Ausgabe von Zelle ${n} ---`);
      lines.push(clipEnd(output, limits.outputPerCell));
    }
  });

  if (notebook.cells.length > cells.length) {
    lines.push("");
    lines.push(`... ${notebook.cells.length - cells.length} weitere Zellen`);
  }
  return lines.join("\n");
}

/** Outputs as plain text; images are named, not embedded. */
function renderOutputs(cell: NotebookCell): string {
  return cell.outputs
    .map((o) => {
      if (o.type === "image") return "[Diagramm]";
      const prefix = o.type === "error"
        ? "FEHLER: "
        : o.type === "stderr"
        ? "stderr: "
        : "";
      return prefix + (o.text ?? "");
    })
    .join("")
    .trim();
}

/** Keeps the head - source is read from the top. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... [${text.length - max} Zeichen gekürzt]`;
}

/** Keeps the tail - a traceback ends with the interesting line. */
function clipEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  return `... [${text.length - max} Zeichen gekürzt]\n` + text.slice(-max);
}

/**
 * Applies one action.
 *
 * `current` is the notebook the user is looking at; actions without an
 * explicit target apply to it.
 */
export function applyNotebookAction(
  raw: unknown,
  current: Notebook | null,
): ToolResult {
  const act = raw as NotebookAction;
  if (!act || typeof act !== "object" || !("action" in act)) {
    return { ok: false, message: "Kein gültiger Notebook-Befehl." };
  }
  const limits = loadLimits();

  switch (act.action) {
    case "read": {
      const target = act.notebook
        ? findNotebook(act.notebook) ?? current
        : current;
      if (!target) return { ok: false, message: "Kein Notebook geöffnet." };
      return {
        ok: true,
        message: `Notebook "${target.name}" gelesen.`,
        snapshot: describeNotebook(target, limits),
      };
    }

    case "create": {
      const cells = (act.cells ?? [])
        .filter((c) => c && typeof c.source === "string")
        .map((c) => newCell(c.type === "markdown" ? "markdown" : "code", c.source));
      if (cells.length === 0) {
        return { ok: false, message: "Ein neues Notebook braucht Zellen." };
      }
      const nb = newNotebook(act.name?.trim() || "Neues Notebook");
      nb.cells = cells;
      saveNotebook(nb);
      return {
        ok: true,
        message: `Notebook "${nb.name}" mit ${cells.length} Zellen angelegt.`,
        notebook: nb,
        snapshot: describeNotebook(nb, limits),
      };
    }

    case "insert": {
      if (!current) return { ok: false, message: "Kein Notebook geöffnet." };
      if (typeof act.source !== "string") {
        return { ok: false, message: "Der Zellinhalt fehlt." };
      }
      const nb = clone(current);
      const cell = newCell(
        act.type === "markdown" ? "markdown" : "code",
        act.source,
      );
      // "after: 0" means before the first cell; absent means at the end.
      const position = act.after === undefined
        ? nb.cells.length
        : clamp(act.after, 0, nb.cells.length);
      nb.cells.splice(position, 0, cell);
      saveNotebook(nb);
      return {
        ok: true,
        message: `Zelle an Position ${position + 1} eingefügt.`,
        notebook: nb,
        snapshot: describeNotebook(nb, limits),
      };
    }

    case "replace": {
      if (!current) return { ok: false, message: "Kein Notebook geöffnet." };
      const index = toIndex(act.cell, current.cells.length);
      if (index === null) {
        return {
          ok: false,
          message:
            `Zelle ${act.cell} gibt es nicht - das Notebook hat ${current.cells.length}.`,
        };
      }
      if (typeof act.source !== "string") {
        return { ok: false, message: "Der neue Zellinhalt fehlt." };
      }
      const nb = clone(current);
      nb.cells[index] = {
        ...nb.cells[index],
        source: act.source,
        // The old output belongs to the old code.
        outputs: [],
        count: null,
        ...(act.type ? { type: act.type } : {}),
      };
      saveNotebook(nb);
      return {
        ok: true,
        message: `Zelle ${index + 1} ersetzt.`,
        notebook: nb,
        snapshot: describeNotebook(nb, limits),
      };
    }

    case "delete": {
      if (!current) return { ok: false, message: "Kein Notebook geöffnet." };
      const index = toIndex(act.cell, current.cells.length);
      if (index === null) {
        return { ok: false, message: `Zelle ${act.cell} gibt es nicht.` };
      }
      if (current.cells.length <= 1) {
        return { ok: false, message: "Die letzte Zelle bleibt stehen." };
      }
      const nb = clone(current);
      nb.cells.splice(index, 1);
      saveNotebook(nb);
      return {
        ok: true,
        message: `Zelle ${index + 1} gelöscht.`,
        notebook: nb,
        snapshot: describeNotebook(nb, limits),
      };
    }

    case "rename": {
      if (!current) return { ok: false, message: "Kein Notebook geöffnet." };
      const name = act.name?.trim();
      if (!name) return { ok: false, message: "Der neue Name fehlt." };
      const nb = clone(current);
      nb.name = name;
      saveNotebook(nb);
      return { ok: true, message: `Notebook heißt jetzt "${name}".`, notebook: nb };
    }

    default:
      return {
        ok: false,
        // deno-lint-ignore no-explicit-any
        message: `Unbekannter Befehl "${(act as any).action}".`,
      };
  }
}

// ----------------------------------------------------------------- helpers

function findNotebook(nameOrId: string): Notebook | null {
  const all = listNotebooks();
  const needle = nameOrId.trim().toLowerCase();
  return all.find((n) => n.id === nameOrId) ??
    all.find((n) => n.name.trim().toLowerCase() === needle) ??
    null;
}

function clone(nb: Notebook): Notebook {
  if (!isNotebook(nb)) throw new Error("invalid notebook");
  return { ...nb, cells: nb.cells.map((c) => ({ ...c, outputs: [...c.outputs] })) };
}

/** The model counts from 1; arrays count from 0. */
function toIndex(oneBased: unknown, length: number): number | null {
  const n = Number(oneBased);
  if (!Number.isInteger(n) || n < 1 || n > length) return null;
  return n - 1;
}

function clamp(value: number, low: number, high: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return high;
  return Math.max(low, Math.min(high, Math.floor(n)));
}
