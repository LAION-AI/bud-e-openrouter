// components/NotebookModal.tsx
//
// A small Colab-like notebook for teaching Python. The code runs entirely in
// the browser through Pyodide (CPython compiled to WebAssembly) inside a Web
// Worker, so a runaway loop costs the pupil their interpreter and nothing
// else - no code ever reaches the server.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { notebookContent } from "../internalization/content.ts";
import {
  type CellOutput,
  deleteNotebook,
  listNotebooks,
  newCell,
  newNotebook,
  type Notebook,
  type NotebookCell,
  pruneUntouchedCopies,
  saveNotebook,
  toIpynb,
} from "../utils/notebookStore.ts";
import { EXAMPLES, notebookFromExample } from "../utils/notebookExamples.ts";
import { type KernelStatus, pythonKernel } from "../utils/pythonKernel.ts";
import {
  DEFAULT_LIMITS,
  isAssistantAllowed,
  loadLimits,
  type NotebookLimits,
  saveLimits,
  setAssistantAllowed,
} from "../utils/notebookTools.ts";

/** Remembers that the 10 MB download notice has been seen. */
const NOTICE_KEY = "bude-notebook-notice-seen";

interface PendingInput {
  cellId: string;
  inputId: number;
  prompt: string;
}

export default function NotebookModal({
  lang = "en",
  onClose,
  onNotebookOpen,
  revision = 0,
}: {
  lang?: string;
  onClose: () => void;
  /** Tells the chat which notebook the assistant should act on. */
  onNotebookOpen?: (notebook: Notebook) => void;
  /** Bumped by the chat after a tool changed something, so we re-read. */
  revision?: number;
}) {
  const t = (key: string) =>
    (notebookContent[lang]?.[key] ?? notebookContent.en[key] ?? key) as string;

  const [notebook, setNotebook] = useState<Notebook>(() => {
    // Copies of examples that nobody ever ran are cleared away first, so an
    // older version's duplicate "1 - Hallo Welt" entries do not stay forever.
    pruneUntouchedCopies();
    const existing = listNotebooks();
    return existing[0] ?? newNotebook();
  });
  const [notebooks, setNotebooks] = useState<Notebook[]>(() => listNotebooks());
  const [kernel, setKernel] = useState<KernelStatus>(pythonKernel.status);
  const [status, setStatus] = useState("");
  const [runningCell, setRunningCell] = useState<string | null>(null);
  const [canInterrupt, setCanInterrupt] = useState(false);
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  const [activeCell, setActiveCell] = useState<string | null>(null);

  // The sidebar is the way around the notebook, so it starts open when there
  // is nothing to show yet and the pupil needs to pick an example.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    listNotebooks().length <= 1
  );
  const [showHelp, setShowHelp] = useState(() => listNotebooks().length === 0);
  const [assistantAllowed, setAllowed] = useState(() => isAssistantAllowed());
  const [limits, setLimits] = useState<NotebookLimits>(() => loadLimits());
  const [showLimits, setShowLimits] = useState(false);

  const [showNotice, setShowNotice] = useState(() => {
    try {
      return localStorage.getItem(NOTICE_KEY) !== "1";
    } catch {
      return true;
    }
  });

  const counterRef = useRef(0);
  const notebookRef = useRef(notebook);

  useEffect(() => {
    notebookRef.current = notebook;
  }, [notebook]);

  // Persist on every change; a pupil should never lose work to a stray reload.
  useEffect(() => {
    saveNotebook(notebook);
    setNotebooks(listNotebooks());
    onNotebookOpen?.(notebook);
  }, [notebook]);

  // A tool call changed something behind our back - read it back in.
  useEffect(() => {
    if (revision === 0) return;
    const fresh = listNotebooks();
    setNotebooks(fresh);
    const mine = fresh.find((n) => n.id === notebook.id);
    if (mine) setNotebook(mine);
    else if (fresh[0]) setNotebook(fresh[0]);
  }, [revision]);

  const dismissNotice = () => {
    setShowNotice(false);
    try {
      localStorage.setItem(NOTICE_KEY, "1");
    } catch {
      // Private mode - the notice simply reappears next time.
    }
  };

  // --------------------------------------------------------------- kernel

  const appendOutput = (cellId: string, output: CellOutput) => {
    setNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) =>
        c.id === cellId ? { ...c, outputs: [...c.outputs, output] } : c
      ),
    }));
  };

  /**
   * The interpreter belongs to the page, not to this window - closing the
   * notebook must not throw away the variables a pupil just built up. So this
   * only listens; it never creates or terminates the worker.
   */
  useEffect(() => {
    const unsubscribe = pythonKernel.subscribe({
      status: (state, detail) => {
        setKernel(state);
        setCanInterrupt(pythonKernel.canInterrupt);
        if (state === "ready") {
          setRunningCell(null);
          setStatus(
            pythonKernel.version
              ? `${t("kernelReady")} - Python ${pythonKernel.version}`
              : t("kernelReady"),
          );
          dismissNotice();
        } else if (state === "off") {
          setStatus(
            detail ? `${t("kernelError")}: ${detail}` : t("kernelStopped"),
          );
        } else {
          setStatus(translateStatus(detail, t));
        }
      },
      output: (cellId, out) => appendOutput(cellId, out as CellOutput),
      input: (cellId, inputId, prompt) =>
        setPendingInput({ cellId, inputId, prompt }),
      inputCancel: (inputId) =>
        setPendingInput((p) => (p?.inputId === inputId ? null : p)),
      done: () => setRunningCell(null),
    });

    // Pick up whatever the kernel is already doing - it may well have booted
    // in the background long before this window was opened.
    setKernel(pythonKernel.status);
    setCanInterrupt(pythonKernel.canInterrupt);
    if (pythonKernel.status === "ready") {
      setStatus(
        pythonKernel.version
          ? `${t("kernelReady")} - Python ${pythonKernel.version}`
          : t("kernelReady"),
      );
    }
    // Opening the window is a strong hint that Python will be wanted.
    pythonKernel.start().catch(() => {});

    return unsubscribe;
  }, []);

  const answerInput = (value: string | null) => {
    const pending = pendingInput;
    if (!pending) return;
    setPendingInput(null);
    pythonKernel.answerInput(pending.inputId, value);
  };

  const restartKernel = () => {
    pythonKernel.restart();
    setRunningCell(null);
    setPendingInput(null);
    setStatus(t("kernelStopped"));
    counterRef.current = 0;
    // Boot straight away so the next cell does not have to wait for it.
    pythonKernel.start().catch(() => {});
  };

  const stopExecution = () => {
    // A cell waiting for input is not stuck in Python - cancelling the input
    // is enough and keeps every variable alive.
    if (pendingInput) {
      answerInput(null);
      return;
    }
    if (canInterrupt) {
      pythonKernel.interrupt();
      return;
    }
    // Without a way to interrupt politely, the only way out is a fresh
    // interpreter - which costs the variables, hence the last resort.
    restartKernel();
  };

  const runCell = async (cell: NotebookCell) => {
    if (cell.type !== "code" || !cell.source.trim()) return;

    const count = ++counterRef.current;
    setNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) =>
        c.id === cell.id ? { ...c, outputs: [], count } : c
      ),
    }));
    setRunningCell(cell.id);

    try {
      await pythonKernel.run(cell.id, cell.source);
    } catch {
      // The status listener has already put the error on screen.
      setRunningCell(null);
    }
  };

  const runAll = async () => {
    for (const cell of notebookRef.current.cells) {
      if (cell.type !== "code") continue;
      const fresh = notebookRef.current.cells.find((c) => c.id === cell.id);
      if (fresh) await runCell(fresh);
    }
  };

  /** Runs a cell and moves the caret to the next one, like Shift+Enter does. */
  const runAndAdvance = async (cell: NotebookCell) => {
    const cells = notebookRef.current.cells;
    const index = cells.findIndex((c) => c.id === cell.id);
    await runCell(cell);
    const next = cells[index + 1];
    if (next) setActiveCell(next.id);
  };

  // ---------------------------------------------------------------- cells

  const updateCell = (id: string, patch: Partial<NotebookCell>) => {
    setNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const addCell = (type: "code" | "markdown", afterId?: string) => {
    const cell = newCell(type);
    setNotebook((nb) => {
      const index = afterId
        ? nb.cells.findIndex((c) => c.id === afterId) + 1
        : nb.cells.length;
      const cells = [...nb.cells];
      cells.splice(index, 0, cell);
      return { ...nb, cells };
    });
    setActiveCell(cell.id);
  };

  const duplicateCell = (id: string) => {
    setNotebook((nb) => {
      const index = nb.cells.findIndex((c) => c.id === id);
      if (index < 0) return nb;
      const copy = newCell(nb.cells[index].type, nb.cells[index].source);
      const cells = [...nb.cells];
      cells.splice(index + 1, 0, copy);
      return { ...nb, cells };
    });
  };

  const removeCell = (id: string) => {
    setNotebook((nb) => ({
      ...nb,
      cells: nb.cells.length > 1
        ? nb.cells.filter((c) => c.id !== id)
        : [newCell("code")],
    }));
  };

  const moveCell = (id: string, direction: -1 | 1) => {
    setNotebook((nb) => {
      const index = nb.cells.findIndex((c) => c.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= nb.cells.length) return nb;
      const cells = [...nb.cells];
      [cells[index], cells[target]] = [cells[target], cells[index]];
      return { ...nb, cells };
    });
  };

  const clearOutputs = () => {
    setNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) => ({ ...c, outputs: [], count: null })),
    }));
    counterRef.current = 0;
  };

  // ------------------------------------------------------------ notebooks

  const openNotebook = (nb: Notebook) => {
    setNotebook(nb);
    counterRef.current = 0;
  };

  const createNotebook = () => {
    const nb = newNotebook(t("untitled"));
    saveNotebook(nb);
    setNotebook(nb);
    setNotebooks(listNotebooks());
  };

  /**
   * Opens an example - the copy you already have, if there is one.
   *
   * Examples are copied so the original stays untouched for the next try. But
   * a fresh copy on every click meant the list filled up with three notebooks
   * called "1 - Hallo Welt", and the work from the first one was buried under
   * the others. So an existing copy is reopened instead, and whatever was
   * typed into it is still there.
   */
  const openExample = (key: string) => {
    const spec = EXAMPLES.find((e) => e.key === key);
    if (!spec) return;
    const mine = listNotebooks().find((n) => n.fromExample === key);
    if (mine) {
      setNotebook(mine);
      setNotebooks(listNotebooks());
      counterRef.current = 0;
      return;
    }
    const nb = notebookFromExample(spec, lang);
    saveNotebook(nb);
    setNotebook(nb);
    setNotebooks(listNotebooks());
    counterRef.current = 0;
  };

  const removeNotebook = (id: string) => {
    if (!confirm(t("confirmDeleteNotebook"))) return;
    deleteNotebook(id);
    const rest = listNotebooks();
    setNotebooks(rest);
    if (id === notebook.id) setNotebook(rest[0] ?? newNotebook(t("untitled")));
  };

  const downloadIpynb = () => {
    const blob = new Blob([toIpynb(notebook)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${notebook.name.replace(/[^\w.-]+/g, "_")}.ipynb`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Escape closes - unless a cell is waiting for input, where it cancels that.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingInput) {
        answerInput(null);
        return;
      }
      onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [onClose, pendingInput]);

  const busy = kernel === "booting" || kernel === "running";
  const codeCells = notebook.cells.filter((c) => c.type === "code").length;

  return (
    <div class="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 md:p-4">
      <div class="bg-white rounded-xl shadow-2xl w-[96vw] h-[93vh] flex flex-col overflow-hidden">
        {/* ---------------------------------------------------- title bar */}
        <header class="flex items-center gap-3 px-4 py-2.5 bg-slate-800 text-white shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={t("myNotebooks")}
            class="p-1.5 rounded hover:bg-white/15 shrink-0"
          >
            <BurgerIcon />
          </button>

          <div class="min-w-0">
            <div class="flex items-baseline gap-2">
              <span class="text-2xl leading-none">🐍</span>
              <h2 class="font-semibold truncate">{t("title")}</h2>
            </div>
            <p class="text-xs text-slate-300 hidden md:block">
              {t("subtitle")}
            </p>
          </div>

          <div class="flex-1" />
          <KernelBadge kernel={kernel} status={status} t={t} />
          <button
            onClick={onClose}
            title={t("close")}
            class="p-1.5 rounded hover:bg-white/15 shrink-0"
          >
            <CloseIcon />
          </button>
        </header>

        {/* ------------------------------------------------------ toolbar */}
        <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-slate-50 shrink-0">
          <input
            type="text"
            value={notebook.name}
            title={t("nameHint")}
            onInput={(e) =>
              setNotebook((nb) => ({
                ...nb,
                name: (e.target as HTMLInputElement).value,
              }))}
            class="font-medium px-2.5 py-1.5 border border-slate-300 rounded-lg
                   min-w-[9rem] flex-1 max-w-xs bg-white
                   focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
          />

          <ToolButton onClick={runAll} disabled={busy} tone="primary">
            <PlayIcon /> {t("runAll")}
          </ToolButton>
          <ToolButton
            onClick={stopExecution}
            disabled={kernel !== "running" && !pendingInput}
            tone="danger"
          >
            <StopIcon /> {t("stop")}
          </ToolButton>
          <ToolButton onClick={restartKernel} title={t("restartHint")}>
            <RestartIcon /> {t("restart")}
          </ToolButton>
          <ToolButton onClick={clearOutputs}>{t("clearOutputs")}</ToolButton>
          <ToolButton onClick={downloadIpynb} title={t("exportHint")}>
            <DownloadIcon /> {t("exportIpynb")}
          </ToolButton>

          <div class="flex-1" />
          <ToolButton
            onClick={() => setShowHelp((v) => !v)}
            tone={showHelp ? "active" : "plain"}
          >
            ? {t("helpTitle")}
          </ToolButton>
        </div>

        {/* ------------------------------------------- assistant permission */}
        <div class="px-4 py-2 border-b bg-white shrink-0">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 max-w-4xl mx-auto">
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={assistantAllowed}
                onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked;
                  setAllowed(on);
                  setAssistantAllowed(on);
                }}
                class="w-4 h-4 accent-blue-600"
              />
              <span class="text-lg leading-none">🤖</span>
              <span class="font-medium text-slate-800">
                {t("allowAssistant")}
              </span>
            </label>

            {assistantAllowed && (
              <button
                onClick={() => setShowLimits((v) => !v)}
                class="text-xs text-blue-700 hover:underline"
              >
                {t("contextLimits")}
              </button>
            )}
            <p class="basis-full text-xs text-slate-500">
              {t("allowAssistantHint")}
            </p>
          </div>

          {assistantAllowed && showLimits && (
            <div class="max-w-4xl mx-auto mt-2 p-3 bg-slate-50 border rounded-lg">
              <div class="flex flex-wrap gap-4">
                <LimitField
                  label={t("limitSource")}
                  value={limits.sourcePerCell}
                  min={100}
                  max={20000}
                  onChange={(v) => {
                    const next = { ...limits, sourcePerCell: v };
                    setLimits(next);
                    saveLimits(next);
                  }}
                />
                <LimitField
                  label={t("limitOutput")}
                  value={limits.outputPerCell}
                  min={0}
                  max={20000}
                  onChange={(v) => {
                    const next = { ...limits, outputPerCell: v };
                    setLimits(next);
                    saveLimits(next);
                  }}
                />
                <LimitField
                  label={t("limitCells")}
                  value={limits.maxCells}
                  min={1}
                  max={200}
                  onChange={(v) => {
                    const next = { ...limits, maxCells: v };
                    setLimits(next);
                    saveLimits(next);
                  }}
                />
                <button
                  onClick={() => {
                    setLimits({ ...DEFAULT_LIMITS });
                    saveLimits({ ...DEFAULT_LIMITS });
                  }}
                  class="self-end px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded"
                >
                  {t("restart") === "Neu starten" ? "Standard" : "Default"}
                </button>
              </div>
              <p class="text-xs text-slate-500 mt-2">{t("limitsHint")}</p>
            </div>
          )}
        </div>

        {/* --------------------------------------------- body: side + cells */}
        <div class="flex-1 flex min-h-0">
          {sidebarOpen && (
            <Sidebar
              t={t}
              lang={lang}
              notebooks={notebooks}
              currentId={notebook.id}
              onOpen={openNotebook}
              onCreate={createNotebook}
              onOpenExample={openExample}
              onRemove={removeNotebook}
            />
          )}

          <main class="flex-1 overflow-y-auto bg-slate-100 min-w-0">
            <div class="max-w-4xl mx-auto px-4 py-4 space-y-3">
              {showHelp && (
                <HelpPanel
                  t={t}
                  onClose={() => setShowHelp(false)}
                />
              )}

              {showNotice && !showHelp && kernel === "off" && (
                <div class="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
                  <span class="text-lg leading-none">⏱️</span>
                  <p class="flex-1 text-amber-900">{t("firstRunNotice")}</p>
                  <button
                    onClick={dismissNotice}
                    class="text-amber-800 hover:underline text-xs shrink-0"
                  >
                    {t("gotIt")}
                  </button>
                </div>
              )}

              {codeCells === 0 && notebook.cells.length <= 1 &&
                !notebook.cells[0]?.source.trim() && (
                <div class="text-center py-6 text-slate-500">
                  <p class="font-medium text-slate-700">{t("emptyTitle")}</p>
                  <p class="text-sm">{t("emptyBody")}</p>
                </div>
              )}

              {notebook.cells.map((cell) => (
                <CellView
                  key={cell.id}
                  cell={cell}
                  t={t}
                  busy={busy}
                  running={runningCell === cell.id}
                  active={activeCell === cell.id}
                  pendingInput={pendingInput?.cellId === cell.id
                    ? pendingInput
                    : null}
                  onFocus={() => setActiveCell(cell.id)}
                  onAnswerInput={answerInput}
                  onChange={(source) => updateCell(cell.id, { source })}
                  onRun={() => runCell(cell)}
                  onRunAndAdvance={() => runAndAdvance(cell)}
                  onDelete={() => removeCell(cell.id)}
                  onDuplicate={() => duplicateCell(cell.id)}
                  onMove={(d) => moveCell(cell.id, d)}
                  onToggleType={() =>
                    updateCell(cell.id, {
                      type: cell.type === "code" ? "markdown" : "code",
                      outputs: [],
                    })}
                  onAddAfter={(type) => addCell(type, cell.id)}
                />
              ))}

              <div class="flex gap-2 justify-center pt-1 pb-6">
                <button
                  onClick={() => addCell("code")}
                  class="px-4 py-2 bg-white border border-slate-300 rounded-lg
                         hover:border-blue-400 hover:text-blue-700 text-sm font-medium shadow-sm"
                >
                  + {t("cellCode")}
                </button>
                <button
                  onClick={() => addCell("markdown")}
                  class="px-4 py-2 bg-white border border-slate-300 rounded-lg
                         hover:border-amber-400 hover:text-amber-700 text-sm font-medium shadow-sm"
                >
                  + {t("cellText")}
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function LimitField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label class="text-xs text-slate-600">
      <span class="block mb-0.5">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onInput={(e) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(n)) {
            onChange(Math.max(min, Math.min(max, Math.floor(n))));
          }
        }}
        class="w-28 px-2 py-1 border border-slate-300 rounded
               focus:ring-2 focus:ring-blue-400 outline-none"
      />
    </label>
  );
}

function KernelBadge(
  { kernel, status, t }: {
    kernel: KernelStatus;
    status: string;
    t: (k: string) => string;
  },
) {
  const dot = kernel === "ready"
    ? "bg-green-400"
    : kernel === "running"
    ? "bg-amber-400 animate-pulse"
    : kernel === "booting"
    ? "bg-blue-400 animate-pulse"
    : "bg-slate-500";

  return (
    <div
      class="flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/10 text-xs max-w-[18rem]"
      title={status || t("kernelOff")}
    >
      <span class={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span class="truncate">{status || t("kernelOff")}</span>
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  disabled,
  title,
  tone = "plain",
}: {
  children: ComponentChildren;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "plain" | "primary" | "danger" | "active";
}) {
  const styles = {
    plain: "bg-white border-slate-300 text-slate-700 hover:border-slate-400",
    primary: "bg-blue-600 border-blue-600 text-white hover:bg-blue-700",
    danger: "bg-white border-red-300 text-red-700 hover:bg-red-50",
    active: "bg-blue-100 border-blue-300 text-blue-800",
  }[tone];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      class={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg
              text-sm font-medium shadow-sm disabled:opacity-40
              disabled:cursor-not-allowed ${styles}`}
    >
      {children}
    </button>
  );
}

function Sidebar({
  t,
  lang,
  notebooks,
  currentId,
  onOpen,
  onCreate,
  onOpenExample,
  onRemove,
}: {
  t: (k: string) => string;
  lang: string;
  notebooks: Notebook[];
  currentId: string;
  onOpen: (nb: Notebook) => void;
  onCreate: () => void;
  onOpenExample: (key: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <aside class="w-64 md:w-72 shrink-0 border-r bg-white overflow-y-auto">
      <div class="p-3 space-y-5">
        <section>
          <div class="flex items-center justify-between mb-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("myNotebooks")}
            </h3>
            <button
              onClick={onCreate}
              title={t("newNotebook")}
              class="px-2 py-0.5 rounded-md bg-green-100 text-green-800
                     hover:bg-green-200 text-sm font-bold leading-none"
            >
              +
            </button>
          </div>
          <p class="text-xs text-slate-500 mb-2">{t("notebooksHint")}</p>

          {notebooks.length === 0
            ? <p class="text-sm text-slate-400">{t("noNotebooks")}</p>
            : (
              <ul class="space-y-0.5">
                {notebooks.map((nb) => (
                  <li key={nb.id} class="group flex items-center gap-1">
                    <button
                      onClick={() =>
                        onOpen(nb)}
                      class={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md text-sm ${
                        nb.id === currentId
                          ? "bg-blue-50 text-blue-900 font-semibold"
                          : "hover:bg-slate-100"
                      }`}
                    >
                      <span class="block truncate">{nb.name}</span>
                      <span class="block text-xs text-slate-400">
                        {nb.cells.length} {t("cells")}
                      </span>
                    </button>
                    <button
                      onClick={() =>
                        onRemove(nb.id)}
                      title={t("delete")}
                      class="opacity-0 group-hover:opacity-100 px-1.5 py-1
                             text-red-600 hover:bg-red-50 rounded text-xs shrink-0"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
            {t("examples")}
          </h3>
          <p class="text-xs text-slate-500 mb-2">{t("examplesHint")}</p>
          <ul class="space-y-1.5">
            {EXAMPLES.map((spec) => (
              <li key={spec.key}>
                <button
                  onClick={() => onOpenExample(spec.key)}
                  class="w-full text-left px-2.5 py-2 border border-slate-200 rounded-lg
                         hover:border-blue-400 hover:bg-blue-50/60"
                >
                  <div class="font-medium text-sm text-slate-800">
                    {spec.name[lang] ?? spec.name.de}
                  </div>
                  <div class="text-xs text-slate-500 leading-snug mt-0.5">
                    {spec.about[lang] ?? spec.about.de}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

function HelpPanel(
  { t, onClose }: { t: (k: string) => string; onClose: () => void },
) {
  const topics = [
    ["▶️", "helpRunTitle", "helpRun"],
    ["⏱️", "helpFirstRunTitle", "helpFirstRun"],
    ["📓", "helpNotebooksTitle", "helpNotebooks"],
    ["📦", "helpPackagesTitle", "helpPackages"],
  ] as const;

  return (
    <div class="bg-white border border-blue-200 rounded-xl shadow-sm overflow-hidden">
      <div class="flex justify-between items-center px-4 py-3 bg-blue-50 border-b border-blue-100">
        <h3 class="font-semibold text-blue-900">{t("helpTitle")}</h3>
        <button
          onClick={onClose}
          class="text-blue-700 hover:text-blue-900 text-xs"
        >
          {t("hide")}
        </button>
      </div>
      <div class="px-4 py-3 space-y-3 text-sm">
        <p class="text-slate-700">{t("helpIntro")}</p>
        <div class="grid gap-3 md:grid-cols-2">
          {topics.map(([icon, titleKey, bodyKey]) => (
            <div key={titleKey} class="flex gap-2.5">
              <span class="text-lg leading-none shrink-0">{icon}</span>
              <div>
                <h4 class="font-semibold text-slate-800">{t(titleKey)}</h4>
                <p class="text-slate-600 leading-snug">{t(bodyKey)}</p>
              </div>
            </div>
          ))}
        </div>
        <p class="text-xs text-slate-500 border-t pt-2">{t("helpPrivacy")}</p>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- one cell

function CellView({
  cell,
  t,
  busy,
  running,
  active,
  pendingInput,
  onFocus,
  onAnswerInput,
  onChange,
  onRun,
  onRunAndAdvance,
  onDelete,
  onDuplicate,
  onMove,
  onToggleType,
  onAddAfter,
}: {
  cell: NotebookCell;
  t: (key: string) => string;
  busy: boolean;
  running: boolean;
  active: boolean;
  pendingInput: PendingInput | null;
  onFocus: () => void;
  onAnswerInput: (value: string | null) => void;
  onChange: (source: string) => void;
  onRun: () => void;
  onRunAndAdvance: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onToggleType: () => void;
  onAddAfter: (type: "code" | "markdown") => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const isCode = cell.type === "code";

  // Grow with the content instead of showing an inner scrollbar.
  const resize = () => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.max(area.scrollHeight, 40)}px`;
  };
  useEffect(resize, [cell.source]);

  useEffect(() => {
    if (active) areaRef.current?.focus();
  }, [active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRun();
      return;
    }
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      onRunAndAdvance();
      return;
    }
    // Tab indents instead of leaving the field - this is a code editor.
    if (e.key === "Tab") {
      e.preventDefault();
      const area = areaRef.current;
      if (!area) return;
      const { selectionStart: s, selectionEnd: end, value } = area;
      area.value = value.slice(0, s) + "    " + value.slice(end);
      area.selectionStart = area.selectionEnd = s + 4;
      onChange(area.value);
    }
  };

  const hasOutput = cell.outputs.length > 0 || !!pendingInput;

  return (
    <div
      class={`rounded-xl border bg-white shadow-sm overflow-hidden transition
              ${
        active
          ? "border-blue-400 ring-2 ring-blue-100"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div class="flex items-center gap-1 px-2 py-1 bg-slate-50 border-b border-slate-100 text-xs">
        {isCode
          ? (
            <button
              onClick={onRun}
              disabled={busy}
              title={`${t("runCell")}`}
              class="w-7 h-7 flex items-center justify-center rounded-lg
                     bg-green-100 text-green-800 hover:bg-green-200
                     disabled:opacity-40 shrink-0"
            >
              {running ? <SpinnerIcon /> : <PlayIcon />}
            </button>
          )
          : (
            <span class="w-7 h-7 flex items-center justify-center shrink-0 text-base">
              📝
            </span>
          )}

        <span
          class={`font-mono px-1.5 py-0.5 rounded shrink-0 ${
            isCode ? "text-slate-500" : "text-amber-700 bg-amber-100"
          }`}
        >
          {isCode ? `[${cell.count ?? " "}]` : t("cellText")}
        </span>

        {pendingInput && (
          <span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium animate-pulse">
            {t("waitingForInput")}
          </span>
        )}

        <div class="flex-1" />

        <span class="hidden md:inline text-slate-400 mr-1 font-mono">
          {isCode ? t("runShortcut") : ""}
        </span>
        <IconButton
          onClick={onToggleType}
          title={isCode ? t("toText") : t("toCode")}
        >
          {isCode ? "📝" : "🐍"}
        </IconButton>
        <IconButton onClick={() => onMove(-1)} title={t("moveUp")}>
          ↑
        </IconButton>
        <IconButton onClick={() => onMove(1)} title={t("moveDown")}>
          ↓
        </IconButton>
        <IconButton onClick={onDuplicate} title={t("duplicate")}>⧉</IconButton>
        <IconButton onClick={() => onAddAfter("code")} title={t("addBelow")}>
          +
        </IconButton>
        <IconButton onClick={onDelete} title={t("delete")} danger>✕</IconButton>
      </div>

      <textarea
        ref={areaRef}
        value={cell.source}
        spellcheck={false}
        onFocus={onFocus}
        onInput={(e) => {
          onChange((e.target as HTMLTextAreaElement).value);
          resize();
        }}
        onKeyDown={onKeyDown}
        placeholder={isCode ? t("codePlaceholder") : t("textPlaceholder")}
        class={`w-full px-3 py-2.5 resize-none outline-none leading-relaxed ${
          isCode
            ? "font-mono text-sm bg-slate-900 text-slate-100 placeholder-slate-500"
            : "text-sm bg-amber-50/70 text-slate-800 placeholder-amber-700/40"
        }`}
        style={{ minHeight: "40px" }}
      />

      {hasOutput && (
        <div class="border-t border-slate-100 bg-white">
          <div class="px-3 pt-1.5 text-[10px] uppercase tracking-wide text-slate-400">
            {t("outputLabel")}
          </div>
          <div class="px-3 pb-2.5 pt-1 space-y-2">
            {cell.outputs.map((out, i) => <OutputView key={i} output={out} />)}
            {pendingInput && (
              <InputPrompt
                prompt={pendingInput.prompt}
                t={t}
                onAnswer={onAnswerInput}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  danger,
}: {
  children: ComponentChildren;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      class={`w-6 h-6 flex items-center justify-center rounded shrink-0 ${
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-slate-500 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

/** The line a cell shows while Python waits inside input(). */
function InputPrompt({
  prompt,
  t,
  onAnswer,
}: {
  prompt: string;
  t: (key: string) => string;
  onAnswer: (value: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div class="flex flex-wrap items-center gap-2 bg-amber-50 border-2 border-amber-300 rounded-lg px-3 py-2">
      <span class="text-base leading-none">✏️</span>
      <span class="font-mono text-sm text-amber-900">
        {prompt || t("inputPrompt")}
      </span>
      <input
        ref={ref}
        type="text"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAnswer(value);
          }
        }}
        class="flex-1 min-w-[8rem] font-mono text-sm px-2.5 py-1.5 border
               border-amber-300 rounded-md focus:ring-2 focus:ring-amber-400 outline-none"
      />
      <button
        onClick={() => onAnswer(value)}
        class="px-3 py-1.5 bg-amber-500 text-white rounded-md hover:bg-amber-600 text-sm font-medium"
      >
        {t("inputSend")}
      </button>
      <button
        onClick={() => onAnswer(null)}
        class="px-2 py-1.5 text-amber-800 hover:bg-amber-100 rounded-md text-xs"
      >
        {t("inputCancel")}
      </button>
    </div>
  );
}

function OutputView({ output }: { output: CellOutput }) {
  if (output.type === "image") {
    return (
      <img
        src={`data:image/png;base64,${output.data}`}
        alt="plot"
        class="max-w-full rounded-lg border border-slate-200"
      />
    );
  }
  if (output.type === "error") {
    return (
      <pre class="font-mono text-xs whitespace-pre-wrap break-words text-red-800
                  bg-red-50 border border-red-200 rounded-lg px-3 py-2">{output.text}</pre>
    );
  }
  const tone = output.type === "stderr"
    ? "text-red-700"
    : output.type === "result"
    ? "text-blue-800 font-medium"
    : "text-slate-800";
  return (
    <pre
      class={`font-mono text-xs whitespace-pre-wrap break-words ${tone}`}
    >{output.text}</pre>
  );
}

// ------------------------------------------------------------------ icons

const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <path d="M2 1.5v9l8-4.5-8-4.5Z" />
  </svg>
);

const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <rect x="2" y="2" width="8" height="8" rx="1" />
  </svg>
);

const RestartIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 16 6 10h4V3h4v7h4l-6 6Zm-8 3h16v2H4v-2Z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="m19 6.4-1.4-1.4-5.6 5.6-5.6-5.6L5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4Z" />
  </svg>
);

const BurgerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
  </svg>
);

const SpinnerIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    class="animate-spin"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      stroke-width="3"
      opacity="0.25"
    />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
  </svg>
);

// ----------------------------------------------------------------- helpers

/** The worker reports raw states; give them something a pupil can read. */
function translateStatus(raw: string, t: (key: string) => string): string {
  if (raw === "loading") return t("kernelLoading");
  if (raw === "running") return t("running");
  if (raw === "idle") return t("kernelReady");
  if (raw.startsWith("packages:")) {
    return `${t("loadingPackages")} ${raw.slice("packages:".length)}`;
  }
  if (raw === "packages") return t("loadingPackages");
  return raw;
}
