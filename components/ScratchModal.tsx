import { useEffect, useRef, useState } from "preact/hooks";
import {
  allowScratch,
  applyScratchProposal,
  attachScratch,
  dismissScratchProposal,
  scratchRequest,
  scratchState,
  subscribeScratch,
} from "../utils/scratchSession.ts";

/** Kept mounted after its first opening: hiding must not destroy a pupil's work. */
export default function ScratchModal(
  { open, lang = "de", brand = "Buddy", canAsk = true, onClose, onAsk }: {
    open: boolean;
    lang?: string;
    brand?: string;
    canAsk?: boolean;
    onClose: () => void;
    onAsk: (question: string) => void;
  },
) {
  const [state, setState] = useState(scratchState);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [editorLang] = useState(lang);
  const input = useRef<HTMLInputElement>(null);
  const de = lang === "de";
  const working = busy || state.working;
  useEffect(() => subscribeScratch(() => setState(scratchState())), []);
  useEffect(() => {
    if (state.ready) {
      void scratchRequest(open ? "resume" : "pause").catch(() => {});
    }
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    globalThis.addEventListener("bude-scratch-close", onClose);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
      globalThis.removeEventListener("bude-scratch-close", onClose);
    };
  }, [open, state.ready]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!scratchState().dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, []);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Scratch: Bitte erneut versuchen.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      class={`fixed inset-0 z-50 bg-slate-900/50 p-1 md:p-3 ${
        open ? "" : "hidden"
      }`}
      aria-hidden={!open}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Scratch"
        class="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header class="flex flex-wrap items-center gap-2 border-b bg-orange-50 px-3 py-2">
          <h2 class="mr-2 text-lg font-bold text-orange-900">🧩 Scratch</h2>
          <button
            type="button"
            disabled={!state.ready || working}
            class="rounded-full bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
            onClick={() => input.current?.click()}
          >
            {de
              ? "↑ Vom Computer öffnen (.sb3)"
              : "↑ Open from computer (.sb3)"}
          </button>
          <input
            ref={input}
            type="file"
            accept=".sb3"
            class="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              if (file.size > 30_000_000) {
                setError("Bitte eine .sb3-Datei bis 30 MB wählen.");
                return;
              }
              if (
                state.dirty && !confirm(
                  de
                    ? "Aktuelles Projekt ersetzen? Speichere es vorher auf deinem Computer."
                    : "Replace the current project? Download it first.",
                )
              ) return;
              dismissScratchProposal();
              void run(async () =>
                scratchRequest("import", {
                  name: file.name,
                  bytes: await file.arrayBuffer(),
                })
              );
            }}
          />
          <button
            type="button"
            disabled={!state.ready || working}
            class="rounded-full bg-orange-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void run(() => scratchRequest("export"))}
          >
            {de ? "↓ Auf Computer speichern" : "↓ Save to computer"}
          </button>
          <button
            type="button"
            disabled={!state.ready || working}
            class="rounded-full bg-white px-3 py-2 text-sm disabled:opacity-50"
            onClick={() => {
              if (
                !confirm(
                  de
                    ? "Neues Projekt beginnen? Lade dein jetziges Projekt vorher herunter."
                    : "Start a new project? Download your current project first.",
                )
              ) return;
              dismissScratchProposal();
              void run(() => scratchRequest("new"));
            }}
          >
            {de ? "Neues Projekt" : "New project"}
          </button>
          <button
            type="button"
            class="ml-auto rounded-full px-3 py-2 hover:bg-orange-100"
            aria-label={de ? "Scratch schließen" : "Close Scratch"}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-sm">
          <label class="flex cursor-pointer items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={state.allowed}
              onChange={(e) => allowScratch(e.currentTarget.checked)}
            />
            {de
              ? `${brand} darf mein Projekt lesen und auf meine Bitte bearbeiten`
              : `Allow ${brand} to read my project and edit it when I ask`}
          </label>
          <span class="text-slate-600">
            {de
              ? "Standardmäßig an · abschaltbar · Code nur bei Scratch-Fragen an die KI · keine dauerhafte Server-Speicherung"
              : "On by default · can be turned off · code sent to AI only for Scratch questions · no persistent server storage"}
          </span>
          <span class="ml-auto text-slate-600">
            {state.dirty
              ? (de ? "Noch nicht heruntergeladen" : "Not downloaded yet")
              : (de ? "Lokal im Browser" : "Local in browser")}
          </span>
        </div>
        {state.pending && (
          <div class="flex max-h-40 flex-wrap items-center gap-2 overflow-auto border-b bg-indigo-50 p-3 text-sm">
            <p class="min-w-0 flex-1">
              <strong>
                {de
                  ? "Vorschlag – noch nicht angewendet: "
                  : "Proposal – not applied: "}
              </strong>
              {state.pending.summary}
            </p>
            <details class="w-full">
              <summary class="cursor-pointer">
                {de
                  ? "Geplante Block-Änderungen ansehen"
                  : "Inspect planned block changes"}
              </summary>
              <pre class="overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs">{JSON.stringify(state.pending, null, 2)}</pre>
            </details>
            <button
              type="button"
              disabled={working || !state.allowed}
              class="rounded-full bg-indigo-600 px-3 py-2 text-white disabled:opacity-50"
              onClick={() => void run(applyScratchProposal)}
            >
              {de ? "Änderung übernehmen" : "Apply change"}
            </button>
            <button
              type="button"
              class="rounded-full bg-white px-3 py-2"
              onClick={dismissScratchProposal}
            >
              {de ? "Verwerfen" : "Discard"}
            </button>
          </div>
        )}
        {(error || state.error) && (
          <p role="alert" class="bg-red-50 p-2 text-sm text-red-800">
            {error || state.error}
          </p>
        )}
        <div class="relative min-h-0 flex-1 overflow-auto">
          {state.working && (
            <p
              role="status"
              class="absolute inset-x-0 top-5 z-10 rounded bg-orange-50 p-4 text-center"
            >
              {de
                ? "Dein Scratch-Projekt wird gebaut …"
                : "Building your Scratch project …"}
            </p>
          )}
          {!state.ready && (
            <p
              role="status"
              class="absolute inset-x-0 top-5 z-10 rounded bg-white/90 p-4 text-center"
            >
              {de
                ? "Scratch wird geladen … beim ersten Öffnen kann das etwas dauern."
                : "Loading Scratch … the first opening may take a moment."}
            </p>
          )}
          <iframe
            src={`/scratch-editor?lang=${editorLang === "de" ? "de" : "en"}`}
            title="Scratch Block-Editor"
            class="h-full min-h-[460px] w-full min-w-[760px] border-0"
            sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
            referrerpolicy="no-referrer"
            onLoad={(e) => attachScratch(e.currentTarget)}
          />
        </div>
        <form
          class="flex flex-wrap items-center gap-2 border-t bg-slate-50 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !question.trim() || !state.allowed || !state.ready || working ||
              !canAsk
            ) return;
            const text = question.trim();
            setQuestion("");
            onClose();
            onAsk(`Scratch: ${text}`);
          }}
        >
          <input
            aria-label={de
              ? "Frage zu deinem Scratch-Projekt"
              : "Question about your Scratch project"}
            class="min-w-40 flex-1 rounded-xl border bg-white px-3 py-2 text-sm"
            value={question}
            onInput={(e) => setQuestion(e.currentTarget.value)}
            maxLength={2000}
            placeholder={de
              ? "Warum bewegt sich meine Figur nicht?"
              : "Why does my sprite not move?"}
          />
          <button
            type="submit"
            disabled={!state.allowed || !state.ready || working || !canAsk ||
              !question.trim()}
            class="rounded-full bg-indigo-100 px-3 py-2 text-sm font-semibold text-indigo-900 disabled:opacity-50"
          >
            {de ? `${brand} fragen` : `Ask ${brand}`}
          </button>
          {state.undo && (
            <button
              type="button"
              disabled={working}
              class="rounded-full bg-white px-3 py-2 text-sm"
              onClick={() => void run(() => scratchRequest("undo"))}
            >
              {de ? "KI-Änderung rückgängig" : "Undo AI change"}
            </button>
          )}
          <a
            class="text-xs text-slate-500 underline"
            href="/scratch/NOTICE.txt"
            target="_blank"
            rel="noopener noreferrer"
          >
            {de ? "Quellcode & Lizenz" : "Source & license"}
          </a>
          <p class="w-full text-xs text-slate-600">
            {de
              ? "Für Scratch-Fragen und passende Nachfragen wird nach Freigabe ein begrenzter Code-Ausschnitt an deinen KI-Anbieter gesendet. Auf eine ausdrückliche Änderungsbitte wird direkt bearbeitet; Fragen allein ändern nichts. Rückgängig möglich. Vor dem Verlassen herunterladen!"
              : "After permission, Scratch questions and follow-ups send a limited snapshot to your AI provider. Explicit edit requests are applied directly; questions alone do not change anything. Undo is available. Download before leaving!"}
          </p>
        </form>
      </section>
    </div>
  );
}
