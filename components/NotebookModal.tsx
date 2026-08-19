// components/NotebookModal.tsx
//
// A small Colab-like notebook for teaching Python. The code runs entirely in
// the browser through Pyodide (CPython compiled to WebAssembly) inside a Web
// Worker, so a runaway loop costs the pupil their interpreter and nothing
// else - no code ever reaches the server.

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
  saveNotebook,
  toIpynb,
} from "../utils/notebookStore.ts";
import { EXAMPLES, notebookFromExample } from "../utils/notebookExamples.ts";

/** Pinned so a CDN release cannot change the behaviour underfoot. */
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/";

type KernelState = "off" | "loading" | "ready" | "running";
type Panel = "" | "notebooks" | "help";

interface PendingInput {
  cellId: string;
  inputId: number;
  prompt: string;
}

export default function NotebookModal({
  lang = "en",
  onClose,
}: {
  lang?: string;
  onClose: () => void;
}) {
  const t = (key: string) =>
    (notebookContent[lang]?.[key] ?? notebookContent.en[key] ?? key) as string;

  const [notebook, setNotebook] = useState<Notebook>(() => {
    const existing = listNotebooks();
    return existing[0] ?? newNotebook();
  });
  const [notebooks, setNotebooks] = useState<Notebook[]>(() => listNotebooks());
  const [kernel, setKernel] = useState<KernelState>("off");
  const [status, setStatus] = useState("");
  const [runningCell, setRunningCell] = useState<string | null>(null);
  const [canInterrupt, setCanInterrupt] = useState(false);
  const [panel, setPanel] = useState<Panel>(() =>
    listNotebooks().length === 0 ? "help" : ""
  );
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const counterRef = useRef(0);
  /** Resolves once the cell currently in flight is finished. */
  const pendingRef = useRef<{ id: string; resolve: () => void } | null>(null);
  const notebookRef = useRef(notebook);

  useEffect(() => {
    notebookRef.current = notebook;
  }, [notebook]);

  // Persist on every change; a pupil should never lose work to a stray reload.
  useEffect(() => {
    saveNotebook(notebook);
    setNotebooks(listNotebooks());
  }, [notebook]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // --------------------------------------------------------------- kernel

  const appendOutput = (cellId: string, output: CellOutput) => {
    setNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) =>
        c.id === cellId ? { ...c, outputs: [...c.outputs, output] } : c
      ),
    }));
  };

  const startKernel = (): Promise<Worker> => {
    if (workerRef.current && kernel !== "off") {
      return Promise.resolve(workerRef.current);
    }
    setKernel("loading");
    setStatus(t("kernelLoading"));

    const worker = new Worker("/pyodide-worker.js");
    workerRef.current = worker;

    return new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        const msg = event.data;
        switch (msg.type) {
          case "status":
            setStatus(translateStatus(msg.text, t));
            break;
          case "ready":
            setKernel("ready");
            setCanInterrupt(!!msg.canInterrupt);
            setStatus(`${t("kernelReady")} (Python ${msg.version})`);
            resolve(worker);
            break;
          case "stdout":
          case "stderr":
          case "result":
          case "error":
            appendOutput(msg.id, { type: msg.type, text: msg.text });
            break;
          case "image":
            appendOutput(msg.id, { type: "image", data: msg.data });
            break;
          case "input":
            setPendingInput({
              cellId: msg.id,
              inputId: msg.inputId,
              prompt: msg.prompt,
            });
            break;
          case "input-cancel":
            setPendingInput((p) => (p?.inputId === msg.inputId ? null : p));
            break;
          case "done": {
            const pending = pendingRef.current;
            if (pending && pending.id === msg.id) {
              pendingRef.current = null;
              pending.resolve();
            }
            setRunningCell(null);
            setKernel("ready");
            break;
          }
          case "fatal":
            setStatus(`${t("kernelError")}: ${msg.text}`);
            setKernel("off");
            reject(new Error(msg.text));
            break;
        }
      };
      worker.onerror = (event) => {
        setStatus(`${t("kernelError")}: ${event.message ?? "worker failed"}`);
        setKernel("off");
        reject(new Error(event.message ?? "worker failed"));
      };
      worker.postMessage({ type: "init", indexURL: PYODIDE_INDEX_URL });
    });
  };

  const answerInput = (value: string | null) => {
    const pending = pendingInput;
    if (!pending) return;
    setPendingInput(null);
    workerRef.current?.postMessage({
      type: "input-response",
      inputId: pending.inputId,
      value: value ?? "",
      cancelled: value === null,
    });
  };

  const restartKernel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    pendingRef.current = null;
    setKernel("off");
    setRunningCell(null);
    setPendingInput(null);
    setStatus(t("kernelStopped"));
    counterRef.current = 0;
  };

  const stopExecution = () => {
    // A cell waiting for input is not stuck in Python - cancelling the input
    // is enough and keeps every variable alive.
    if (pendingInput) {
      answerInput(null);
      return;
    }
    if (canInterrupt && workerRef.current) {
      workerRef.current.postMessage({ type: "interrupt" });
      return;
    }
    restartKernel();
  };

  const runCell = async (cell: NotebookCell) => {
    if (cell.type !== "code" || !cell.source.trim()) return;

    let worker: Worker;
    try {
      worker = await startKernel();
    } catch {
      return;
    }

    const count = ++counterRef.current;
    setNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) =>
        c.id === cell.id ? { ...c, outputs: [], count } : c
      ),
    }));
    setRunningCell(cell.id);
    setKernel("running");

    await new Promise<void>((resolve) => {
      pendingRef.current = { id: cell.id, resolve };
      worker.postMessage({ type: "run", id: cell.id, code: cell.source });
    });
  };

  const runAll = async () => {
    for (const cell of notebookRef.current.cells) {
      if (cell.type !== "code") continue;
      const fresh = notebookRef.current.cells.find((c) => c.id === cell.id);
      if (fresh) await runCell(fresh);
    }
  };

  // ---------------------------------------------------------------- cells

  const updateCell = (id: string, patch: Partial<NotebookCell>) => {
    setNotebook((nb) => ({
      ...nb,
      cells: nb.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const addCell = (type: "code" | "markdown", afterId?: string) => {
    setNotebook((nb) => {
      const cell = newCell(type);
      const index = afterId
        ? nb.cells.findIndex((c) => c.id === afterId) + 1
        : nb.cells.length;
      const cells = [...nb.cells];
      cells.splice(index, 0, cell);
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
    setPanel("");
    counterRef.current = 0;
  };

  const createNotebook = () => {
    const nb = newNotebook(t("untitled"));
    saveNotebook(nb);
    setNotebook(nb);
    setNotebooks(listNotebooks());
    setPanel("");
  };

  /** Examples are copied, so the original stays untouched for the next try. */
  const openExample = (key: string) => {
    const spec = EXAMPLES.find((e) => e.key === key);
    if (!spec) return;
    const nb = notebookFromExample(spec, lang);
    saveNotebook(nb);
    setNotebook(nb);
    setNotebooks(listNotebooks());
    setPanel("");
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

  const busy = kernel === "loading" || kernel === "running";

  return (
    <div class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2">
      <div class="bg-white rounded-lg shadow-xl w-[95vw] h-[92vh] flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div class="flex flex-wrap gap-2 items-center px-4 py-3 border-b bg-gray-50">
          <span class="font-bold text-slate-700 mr-1">{t("title")}</span>
          <input
            type="text"
            value={notebook.name}
            title={t("nameHint")}
            onInput={(e) =>
              setNotebook((nb) => ({
                ...nb,
                name: (e.target as HTMLInputElement).value,
              }))}
            class="font-medium px-2 py-1 border rounded min-w-[9rem] flex-1 max-w-xs"
          />
          <button
            onClick={() => setPanel(panel === "notebooks" ? "" : "notebooks")}
            class={`px-3 py-1.5 rounded text-sm font-medium ${
              panel === "notebooks"
                ? "bg-blue-100 text-blue-800"
                : "bg-slate-200 hover:bg-slate-300"
            }`}
          >
            {t("myNotebooks")} ({notebooks.length})
          </button>
          <button
            onClick={runAll}
            disabled={busy}
            class="px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm"
          >
            {t("runAll")}
          </button>
          <button
            onClick={stopExecution}
            disabled={kernel !== "running" && !pendingInput}
            class="px-3 py-1.5 bg-red-200 rounded hover:bg-red-300 disabled:opacity-50 text-sm"
          >
            {t("stop")}
          </button>
          <button
            onClick={restartKernel}
            title={t("restartHint")}
            class="px-3 py-1.5 bg-slate-200 rounded hover:bg-slate-300 text-sm"
          >
            {t("restart")}
          </button>
          <button
            onClick={clearOutputs}
            class="px-3 py-1.5 bg-slate-200 rounded hover:bg-slate-300 text-sm"
          >
            {t("clearOutputs")}
          </button>
          <button
            onClick={downloadIpynb}
            title={t("exportHint")}
            class="px-3 py-1.5 bg-slate-200 rounded hover:bg-slate-300 text-sm"
          >
            {t("exportIpynb")}
          </button>
          <button
            onClick={() => setPanel(panel === "help" ? "" : "help")}
            class={`px-3 py-1.5 rounded text-sm font-bold ${
              panel === "help"
                ? "bg-blue-100 text-blue-800"
                : "bg-slate-200 hover:bg-slate-300"
            }`}
          >
            ?
          </button>
          <div class="flex-1" />
          <span
            class={`text-xs px-2 py-1 rounded ${statusClass(kernel)}`}
            title={status}
          >
            {status || t("kernelOff")}
          </span>
          <button
            onClick={onClose}
            class="px-3 py-1.5 text-gray-600 hover:text-gray-900"
          >
            {t("close")}
          </button>
        </div>

        {panel === "help" && <HelpPanel t={t} onClose={() => setPanel("")} />}

        {panel === "notebooks" && (
          <NotebooksPanel
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

        {/* Cells */}
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50">
          {notebook.cells.map((cell, index) => (
            <CellView
              key={cell.id}
              cell={cell}
              index={index}
              t={t}
              busy={busy}
              running={runningCell === cell.id}
              pendingInput={pendingInput?.cellId === cell.id
                ? pendingInput
                : null}
              onAnswerInput={answerInput}
              onChange={(source) => updateCell(cell.id, { source })}
              onRun={() => runCell(cell)}
              onDelete={() => removeCell(cell.id)}
              onMove={(d) => moveCell(cell.id, d)}
              onToggleType={() =>
                updateCell(cell.id, {
                  type: cell.type === "code" ? "markdown" : "code",
                  outputs: [],
                })}
              onAddAfter={(type) => addCell(type, cell.id)}
            />
          ))}

          <div class="flex gap-2 pt-2">
            <button
              onClick={() => addCell("code")}
              class="px-3 py-1.5 bg-white border rounded hover:bg-slate-100 text-sm"
            >
              + {t("codeCell")}
            </button>
            <button
              onClick={() => addCell("markdown")}
              class="px-3 py-1.5 bg-white border rounded hover:bg-slate-100 text-sm"
            >
              + {t("textCell")}
            </button>
          </div>

          <p class="text-xs text-gray-500 pt-2">{t("hint")}</p>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ panels

function HelpPanel(
  { t, onClose }: { t: (k: string) => string; onClose: () => void },
) {
  return (
    <div class="px-5 py-4 border-b bg-blue-50 text-sm max-h-[45vh] overflow-y-auto">
      <div class="flex justify-between items-start gap-4">
        <h3 class="font-bold text-blue-900 mb-2">{t("helpTitle")}</h3>
        <button
          onClick={onClose}
          class="text-blue-700 hover:text-blue-900 text-xs"
        >
          {t("hide")}
        </button>
      </div>
      <p class="mb-3 text-slate-700">{t("helpIntro")}</p>

      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <h4 class="font-semibold text-slate-800 mb-1">{t("helpRunTitle")}</h4>
          <p class="text-slate-700">{t("helpRun")}</p>
        </div>
        <div>
          <h4 class="font-semibold text-slate-800 mb-1">
            {t("helpFirstRunTitle")}
          </h4>
          <p class="text-slate-700">{t("helpFirstRun")}</p>
        </div>
        <div>
          <h4 class="font-semibold text-slate-800 mb-1">
            {t("helpNotebooksTitle")}
          </h4>
          <p class="text-slate-700">{t("helpNotebooks")}</p>
        </div>
        <div>
          <h4 class="font-semibold text-slate-800 mb-1">
            {t("helpPackagesTitle")}
          </h4>
          <p class="text-slate-700">{t("helpPackages")}</p>
        </div>
      </div>

      <p class="mt-3 text-xs text-slate-600">{t("helpPrivacy")}</p>
    </div>
  );
}

function NotebooksPanel({
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
    <div class="px-5 py-4 border-b bg-white max-h-[45vh] overflow-y-auto">
      <div class="grid gap-6 md:grid-cols-2">
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-slate-800">{t("myNotebooks")}</h3>
            <button
              onClick={onCreate}
              class="px-3 py-1 bg-green-200 rounded hover:bg-green-300 text-sm font-medium"
            >
              + {t("newNotebook")}
            </button>
          </div>
          <p class="text-xs text-gray-500 mb-2">{t("notebooksHint")}</p>

          {notebooks.length === 0 && (
            <p class="text-sm text-gray-500">{t("noNotebooks")}</p>
          )}
          <ul class="space-y-1">
            {notebooks.map((nb) => (
              <li key={nb.id} class="flex items-center gap-2 text-sm">
                <button
                  onClick={() => onOpen(nb)}
                  class={`flex-1 text-left px-2 py-1 rounded hover:bg-slate-100 ${
                    nb.id === currentId ? "font-semibold bg-slate-100" : ""
                  }`}
                >
                  {nb.name}
                  <span class="text-gray-400 ml-2 text-xs">
                    {nb.cells.length} {t("cells")}
                  </span>
                </button>
                <button
                  onClick={() => onRemove(nb.id)}
                  class="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-xs"
                >
                  {t("delete")}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 class="font-semibold text-slate-800 mb-2">{t("examples")}</h3>
          <p class="text-xs text-gray-500 mb-2">{t("examplesHint")}</p>
          <ul class="space-y-2">
            {EXAMPLES.map((spec) => (
              <li key={spec.key}>
                <button
                  onClick={() => onOpenExample(spec.key)}
                  class="w-full text-left px-3 py-2 border rounded hover:bg-blue-50 hover:border-blue-300"
                >
                  <div class="font-medium text-sm">
                    {spec.name[lang] ?? spec.name.de}
                  </div>
                  <div class="text-xs text-gray-600">
                    {spec.about[lang] ?? spec.about.de}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- one cell

function CellView({
  cell,
  index,
  t,
  busy,
  running,
  pendingInput,
  onAnswerInput,
  onChange,
  onRun,
  onDelete,
  onMove,
  onToggleType,
  onAddAfter,
}: {
  cell: NotebookCell;
  index: number;
  t: (key: string) => string;
  busy: boolean;
  running: boolean;
  pendingInput: PendingInput | null;
  onAnswerInput: (value: string | null) => void;
  onChange: (source: string) => void;
  onRun: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onToggleType: () => void;
  onAddAfter: (type: "code" | "markdown") => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the content instead of showing an inner scrollbar.
  const resize = () => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.max(area.scrollHeight, 44)}px`;
  };
  useEffect(resize, [cell.source]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      onRun();
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

  return (
    <div class="bg-white border rounded shadow-sm">
      <div class="flex items-center gap-2 px-2 py-1 border-b bg-gray-50 text-xs">
        <span class="font-mono text-gray-400 w-12">
          {cell.type === "code" ? `[${cell.count ?? " "}]` : "Text"}
        </span>
        {cell.type === "code" && (
          <button
            onClick={onRun}
            disabled={busy}
            title={t("runCell")}
            class="px-2 py-0.5 rounded bg-green-200 hover:bg-green-300 disabled:opacity-50 font-medium"
          >
            {running ? "..." : "▶"}
          </button>
        )}
        <button
          onClick={onToggleType}
          class="px-2 py-0.5 rounded hover:bg-slate-200"
        >
          {cell.type === "code" ? t("toText") : t("toCode")}
        </button>
        <button
          onClick={() => onMove(-1)}
          class="px-2 py-0.5 rounded hover:bg-slate-200"
          title={t("moveUp")}
        >
          &uarr;
        </button>
        <button
          onClick={() => onMove(1)}
          class="px-2 py-0.5 rounded hover:bg-slate-200"
          title={t("moveDown")}
        >
          &darr;
        </button>
        <div class="flex-1" />
        <button
          onClick={() => onAddAfter("code")}
          class="px-2 py-0.5 rounded hover:bg-slate-200"
        >
          + {t("codeCell")}
        </button>
        <button
          onClick={onDelete}
          class="px-2 py-0.5 rounded text-red-600 hover:bg-red-50"
        >
          {t("delete")}
        </button>
      </div>

      <textarea
        ref={areaRef}
        value={cell.source}
        spellcheck={false}
        onInput={(e) => {
          onChange((e.target as HTMLTextAreaElement).value);
          resize();
        }}
        onKeyDown={onKeyDown}
        placeholder={cell.type === "code"
          ? t("codePlaceholder")
          : t("textPlaceholder")}
        class={`w-full px-3 py-2 resize-none outline-none ${
          cell.type === "code"
            ? "font-mono text-sm bg-slate-900 text-slate-100 placeholder-slate-500"
            : "text-sm bg-amber-50"
        }`}
        style={{ minHeight: "44px" }}
      />

      {(cell.outputs.length > 0 || pendingInput) && (
        <div class="border-t px-3 py-2 space-y-2 bg-white">
          {cell.outputs.map((out, i) => <OutputView key={i} output={out} />)}
          {pendingInput && (
            <InputPrompt
              prompt={pendingInput.prompt}
              t={t}
              onAnswer={onAnswerInput}
            />
          )}
        </div>
      )}
    </div>
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

  const submit = () => onAnswer(value);

  return (
    <div class="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-300 rounded px-2 py-2">
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
            submit();
          }
        }}
        class="flex-1 min-w-[8rem] font-mono text-sm px-2 py-1 border rounded focus:ring-2 focus:ring-amber-400 outline-none"
      />
      <button
        onClick={submit}
        class="px-3 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 text-sm font-medium"
      >
        {t("inputSend")}
      </button>
      <button
        onClick={() => onAnswer(null)}
        class="px-2 py-1 text-amber-800 hover:bg-amber-100 rounded text-xs"
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
        class="max-w-full border rounded"
      />
    );
  }
  const tone = output.type === "stderr" || output.type === "error"
    ? "text-red-700"
    : output.type === "result"
    ? "text-blue-800"
    : "text-gray-800";
  return (
    <pre
      class={`font-mono text-xs whitespace-pre-wrap break-words ${tone}`}
    >{output.text}</pre>
  );
}

// ----------------------------------------------------------------- helpers

function statusClass(kernel: KernelState): string {
  if (kernel === "ready") return "bg-green-100 text-green-800";
  if (kernel === "running") return "bg-amber-100 text-amber-800";
  if (kernel === "loading") return "bg-blue-100 text-blue-800";
  return "bg-slate-200 text-slate-600";
}

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
