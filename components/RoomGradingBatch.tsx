import { useEffect, useRef, useState } from "preact/hooks";
import ClassroomCodeContent from "./ClassroomCodeContent.tsx";
import GradingBudgetPanel from "./GradingBudgetPanel.tsx";
import {
  type GradingBudgetLoader,
  gradingErrorHelp,
} from "../utils/gradingFeedback.ts";
import type { SourceDoc } from "../utils/grading.ts";
import {
  filesForGrading,
  MAX_GRADING_PAGES,
  MAX_GRADING_UPLOADS,
} from "../utils/gradingUploads.ts";
import {
  type GradingAsk,
  type GradingSession,
  type GradingStatus,
  markRoomWork,
  transcribeRoomWork,
  transcriptMarkdown,
  validateGradingGroups,
} from "../utils/roomGrading.ts";
import { buildGradingPdf, buildGradingWord } from "../utils/gradingExports.ts";
import { GRADING_PARALLEL, GradingFailure } from "../utils/gradingProtocol.ts";
import {
  DERIVE_SOLUTIONS_POLICY,
  gradingCriteriaQuestions,
} from "../utils/gradingCriteria.ts";
import {
  type GradingCheckpoint,
  MAX_CHECKPOINT_BYTES,
  parseGradingCheckpoint,
  serializeGradingCheckpoint,
} from "../utils/gradingCheckpoint.ts";

const control =
  "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40";
const primary =
  "rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
const input =
  "mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-900";
export function GradingReportDownload(
  { text, transcript = false }: { text: string; transcript?: boolean },
) {
  const [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  async function download(pdf: boolean) {
    setWorking(true);
    setError("");
    try {
      const data = pdf
        ? await buildGradingPdf(text, undefined, {
          audience: transcript ? "transcript" : "student",
        })
        : await buildGradingWord(text, {
          audience: transcript ? "transcript" : "student",
        });
      const url = URL.createObjectURL(
        new Blob([data], {
          type: pdf
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = (transcript
        ? "Abschrift-alle-Arbeiten"
        : "Korrekturvorschlaege-alle-Arbeiten") + (pdf ? ".pdf" : ".docx");
      link.click();
      setTimeout(() =>
        URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Download fehlgeschlagen.",
      );
    } finally {
      setWorking(false);
    }
  }
  return (
    <span class="inline-flex flex-wrap gap-2">
      <button
        type="button"
        class={control}
        disabled={working}
        onClick={() => void download(false)}
      >
        {transcript
          ? "Abschrift als Word herunterladen"
          : "Korrekturvorschlag als Word herunterladen"}
      </button>
      <button
        type="button"
        class={control}
        disabled={working}
        onClick={() => void download(true)}
      >
        {transcript
          ? "Abschrift als PDF herunterladen"
          : "Korrekturvorschlag als PDF herunterladen"}
      </button>
      {working && (
        <span role="status" class="text-xs text-indigo-700">
          Datei wird erstellt …
        </span>
      )}
      {error && (
        <span role="alert" class="block text-sm text-red-700">{error}</span>
      )}
    </span>
  );
}
async function compact(source: SourceDoc): Promise<SourceDoc> {
  if (source.kind !== "image") return source;
  const blob = await (await fetch(source.content)).blob(),
    bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) {
      throw new Error("Ein Foto hat zu viele Pixel. Bitte vorher verkleinern.");
    }
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Bildverarbeitung nicht verfügbar.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.9, .8, .65, .5, .35]) {
      const content = canvas.toDataURL("image/jpeg", quality);
      if (content.length <= 700000) return { ...source, content };
    }
    throw new Error(
      "Ein Foto ist zu groß. Bitte einen kleineren Ausschnitt verwenden.",
    );
  } finally {
    bitmap.close();
  }
}
type GroupEdit = {
  student: string;
  pages: string;
  note: string;
  ignored?: boolean;
};
export default function RoomGradingBatch(
  {
    initialSources,
    ask,
    privateRoom = false,
    loadBudget,
    onComplete,
    onClose,
    onBusyChange,
  }: {
    initialSources: SourceDoc[];
    ask: GradingAsk;
    privateRoom?: boolean;
    loadBudget?: GradingBudgetLoader;
    onComplete: (
      text: string,
      sources: SourceDoc[],
      criteria: string,
    ) => Promise<void>;
    onClose: () => void;
    onBusyChange: (busy: boolean) => void;
  },
) {
  const [sources, setSources] = useState(initialSources),
    [session, setSession] = useState<GradingSession | null>(null);
  const [criteria, setCriteria] = useState(""),
    [feedback, setFeedback] = useState(""),
    [automatic, setAutomatic] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [groups, setGroups] = useState<GroupEdit[]>([]),
    [steps, setSteps] = useState<string[]>([]),
    [status, setStatus] = useState<GradingStatus | null>(null);
  const [report, setReport] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    disposed = useRef(false);
  const workRef = useRef<GradingSession | null>(null);
  const [lastAction, setLastAction] = useState<"transcribe" | "mark">(
    "transcribe",
  );
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointMessage, setCheckpointMessage] = useState("");
  const [criteriaClarification, setCriteriaClarification] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [startedAt, setStartedAt] = useState(0);
  const [lastMessageAt, setLastMessageAt] = useState(Date.now());
  const [pendingCalls, setPendingCalls] = useState(0);
  const jobStarts = useRef(new Map<number, number>()), jobId = useRef(0);
  const [downloadedAt, setDownloadedAt] = useState("");
  const [showResumeHelp, setShowResumeHelp] = useState(false);
  const issueRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (error) {
      issueRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [error]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const trackedAsk: GradingAsk = async (...args) => {
    const id = ++jobId.current;
    jobStarts.current.set(id, Date.now());
    if (!disposed.current) setPendingCalls((n) => n + 1);
    try {
      return await ask(...args);
    } finally {
      jobStarts.current.delete(id);
      if (!disposed.current) setPendingCalls((n) => Math.max(0, n - 1));
    }
  };
  const criteriaInput = useRef<HTMLTextAreaElement | null>(null);
  const ready = !!session?.papers.length &&
    session.pages.length === session.sources.length &&
    !session.pendingPages?.length;
  const criteriaQuestions = gradingCriteriaQuestions(criteria);
  useEffect(() => {
    if (!session?.pages.length || saved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [session?.pages.length, saved]);
  const updateWork = (work: GradingSession) => {
    workRef.current = work;
    if (!disposed.current) setSession({ ...work });
  };
  function snapshot(): GradingCheckpoint {
    return {
      format: "bude-grading",
      version: 1,
      createdAt: new Date().toISOString(),
      work: workRef.current ??
        { sources, pages: [], papers: [], prepared: false },
      criteria,
      feedback,
      automatic,
      groups,
      status,
      steps,
      report,
      lastAction,
    };
  }
  function exportCheckpoint() {
    setCheckpointBusy(true);
    try {
      const data = serializeGradingCheckpoint(snapshot());
      const blob = new Blob([data], { type: "application/json" });
      if (blob.size > MAX_CHECKPOINT_BYTES) {
        throw new Error("Zwischenstand ist größer als 180 MB.");
      }
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = `Bud-E-Korrektur-Zwischenstand-${Date.now()}.json`;
      link.click();
      setDownloadedAt(new Date().toLocaleTimeString("de-DE"));
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setCheckpointMessage(
        "Zwischenstand heruntergeladen. Die Datei enthält Arbeiten und Rückmeldungen im Klartext – bitte geschützt aufbewahren.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Download fehlgeschlagen.",
      );
    } finally {
      setCheckpointBusy(false);
    }
  }
  async function importCheckpoint(file?: File) {
    if (!file || busy) return;
    setCheckpointBusy(true);
    setErrorCode("");
    try {
      if (file.size > MAX_CHECKPOINT_BYTES) {
        throw new Error("Zwischenstand ist größer als 180 MB.");
      }
      const saved = parseGradingCheckpoint(await file.text());
      if (
        (workRef.current?.pages.length || report) &&
        !confirm(
          "Aktuellen Zwischenstand ersetzen? Lade ihn vorher bei Bedarf herunter.",
        )
      ) return;
      updateWork(saved.work);
      setSources(saved.work.sources);
      setCriteria(saved.criteria);
      setCriteriaClarification("");
      setFeedback(saved.feedback);
      setAutomatic(false);
      setReviewed(false);
      setGroups(
        saved.groups.length ? saved.groups : saved.work.papers.map((p) => ({
          student: p.student,
          pages: p.pages.join(", "),
          note: p.note ?? "",
          ignored: p.ignored,
        })),
      );
      setSteps(saved.steps);
      setStatus(saved.status);
      const independentlyChecked = !saved.work.pendingPages?.length &&
        (saved.work.cache?.checked?.length ?? 0) >=
          saved.work.papers.filter((p) => !p.ignored).length;
      setReport(independentlyChecked ? saved.report : "");
      setSaved(false);
      setLastAction(
        !independentlyChecked && saved.work.cache ? "mark" : saved.lastAction,
      );
      setError("");
      setShowResumeHelp(false);
      setDownloadedAt("");
      setCheckpointMessage(
        `Zwischenstand geladen: ${saved.work.pages.length} Abschriften und ${
          Object.keys(saved.work.cache?.reports ?? {}).length
        } Bewertungsentwürfe, ${
          saved.work.cache?.checked?.length ?? 0
        } davon unabhängig zweitgeprüft. Noch keine API-Anfrage gestartet. Vor der Bewertung bitte Zuordnung/Kriterien prüfen.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Diese Zwischenstandsdatei ist beschädigt.",
      );
    } finally {
      setCheckpointBusy(false);
    }
  }
  useEffect(() => () => {
    disposed.current = true;
    controller.current?.abort();
    onBusyChange(false);
  }, []);
  const progress = (step: string, next?: GradingStatus) => {
    if (!disposed.current) {
      setLastMessageAt(Date.now());
      setSteps((old) => [...old, step].slice(-500));
      if (next) setStatus(next);
    }
  };
  const joinedCriteria = () =>
    criteria.trim() +
    (feedback.trim()
      ? "\n\nKorrekturen und Feedback der Lehrkraft zur Abschrift/Zuordnung (diese berichtigen die ursprüngliche Lesung):\n" +
        feedback.trim()
      : "");
  async function save(
    result: string,
    next: GradingSession,
    usedCriteria: string,
  ) {
    if (disposed.current) return;
    setReport(result);
    await onComplete(result, next.sources, usedCriteria);
    if (!disposed.current) setSaved(true);
  }
  async function run(mark: boolean, reviewOnly = false) {
    if (busy) return;
    setErrorCode("");
    if ((mark || automatic) && criteriaQuestions.length) {
      setError(
        "Vor der Bewertung bitte klären: " + criteriaQuestions.join(" "),
      );
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setErrorCode("");
    setStartedAt(Date.now());
    setLastMessageAt(Date.now());
    setCriteriaClarification("");
    setLastAction(mark ? "mark" : "transcribe");
    try {
      let next = workRef.current;
      if (!mark) {
        if (!next) setSteps([]);
        else {progress(
            "Fortsetzung: fertige Seiten werden wiederverwendet; nur fehlende Schritte laufen erneut.",
          );}
        const prepared: SourceDoc[] = [];
        for (const source of (next?.prepared ? [] : next?.sources ?? sources)) {
          abort.signal.throwIfAborted();
          prepared.push(await compact(source));
        }
        if (next && !next.prepared) next.sources = prepared;
        next = await transcribeRoomWork(
          prepared,
          trackedAsk,
          progress,
          abort.signal,
          next ?? undefined,
          updateWork,
          joinedCriteria(),
        );
        abort.signal.throwIfAborted();
        if (disposed.current) return;
        updateWork(next);
        setGroups(
          next.papers.map((paper) => ({
            student: paper.student,
            pages: paper.pages.join(", "),
            note: paper.note ?? "",
            ignored: paper.ignored,
          })),
        );
        if (!automatic || reviewOnly) return;
      } else if (next) {
        next = {
          ...next,
          papers: validateGradingGroups(
            groups.map((group) => ({
              ...group,
              pages: group.pages.split(/[,;\s]+/).filter(Boolean).map(Number),
            })),
            next.pages,
          ),
        };
        updateWork(next);
      }
      if (next) {
        setLastAction("mark");
        const used = joinedCriteria();
        const result = await markRoomWork(
          next,
          used,
          trackedAsk,
          progress,
          abort.signal,
          updateWork,
        );
        abort.signal.throwIfAborted();
        await save(result, next, used);
      }
    } catch (cause) {
      if (!disposed.current) {
        if (
          cause instanceof GradingFailure &&
          cause.code === "criteria_clarification"
        ) {
          setCriteriaClarification(cause.message);
          criteriaInput.current?.focus();
          criteriaInput.current?.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
          return;
        }
        setError(
          abort.signal.aborted
            ? "Angehalten. Fertige Abschriften, Bewertungen und Teilantworten bleiben erhalten. Lade den Zwischenstand herunter oder setze mit „Noch einmal versuchen“ fort. Laufende Anbieteranfragen können noch Kosten verursachen."
            : cause instanceof Error
            ? cause.message
            : "Die Korrektur ist fehlgeschlagen.",
        );
        setErrorCode(
          abort.signal.aborted
            ? "cancelled"
            : cause instanceof GradingFailure
            ? cause.code
            : "",
        );
      }
    } finally {
      if (!disposed.current) {
        const current = workRef.current;
        if (current?.papers.length) {
          setGroups(
            current.papers.map((paper) => ({
              student: paper.student,
              pages: paper.pages.join(", "),
              note: paper.note ?? "",
              ignored: paper.ignored,
            })),
          );
        }
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  async function upload(files: FileList | null) {
    if (!files || busy) return;
    setErrorCode("");
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      if (files.length > MAX_GRADING_UPLOADS) {
        throw new Error(
          "Höchstens 60 Dateien auf einmal wählen, alternativ eine ZIP-Datei.",
        );
      }
      const additions = await filesForGrading(Array.from(files), abort.signal);
      abort.signal.throwIfAborted();
      if (sources.length + additions.length > MAX_GRADING_PAGES) {
        throw new Error(
          `Mehr als ${MAX_GRADING_PAGES} Seiten/Abschnitte. Bitte den Stapel aufteilen.`,
        );
      }
      if (!disposed.current) setSources([...sources, ...additions]);
    } catch (cause) {
      if (!disposed.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Datei konnte nicht geöffnet werden.",
        );
      }
    } finally {
      if (!disposed.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  const ratio = status ? status.completed / Math.max(1, status.total) : 0;
  const percent = !status
    ? 0
    : status.stage === "prepare"
    ? 5
    : status.stage === "transcribe"
    ? Math.round(10 + ratio * 40)
    : status.stage === "group"
    ? 55
    : status.stage === "review"
    ? 60
    : status.stage === "guidance"
    ? Math.round(60 + ratio * 8)
    : status.stage === "mark"
    ? Math.min(99, Math.round(68 + ratio * 31))
    : saved || !!report
    ? 100
    : 99;
  const activeStep = status?.stage === "mark" || status?.stage === "guidance" ||
      status?.stage === "done"
    ? 3
    : status?.stage === "group" || status?.stage === "review"
    ? 2
    : 1;
  const help = gradingErrorHelp(error, errorCode, privateRoom);
  const duration = Math.max(0, Math.floor((clock - startedAt) / 1000));
  const silence = Math.max(0, Math.floor((clock - lastMessageAt) / 1000));
  const oldestJob = jobStarts.current.size
    ? Math.max(
      0,
      Math.floor((clock - Math.min(...jobStarts.current.values())) / 1000),
    )
    : 0;
  const checkedCount = session?.cache?.checked?.length ?? 0;
  const issuePanel = error && (
    <div
      ref={issueRef}
      role="alert"
      class="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
    >
      <h3 class="font-semibold">{help.title}</h3>
      <p class="mt-2 text-sm">{help.explanation}</p>
      <p class="mt-3 text-sm">
        <strong>So geht es weiter:</strong> {help.next}
      </p>
      <p class="mt-3 text-xs">
        Vor dem Schließen oder Neuladen unbedingt den Zwischenstand sichern.
        Fertige Schritte bleiben nur im offenen Fenster oder in deiner
        heruntergeladenen Sicherungsdatei erhalten.
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class={control}
          disabled={checkpointBusy}
          onClick={exportCheckpoint}
        >
          Sicherung jetzt herunterladen
        </button>
        <button
          type="button"
          class={primary}
          disabled={busy || checkpointBusy ||
            (lastAction === "mark" && !automatic && !reviewed)}
          onClick={() => void run(lastAction === "mark")}
        >
          Noch einmal versuchen
        </button>
        {!privateRoom && (
          <a
            class={control}
            href="/my"
            target="_blank"
            rel="noopener noreferrer"
          >
            Raumeinstellungen öffnen ↗
          </a>
        )}
      </div>
      {lastAction === "mark" && !automatic && !reviewed && (
        <p class="mt-2 text-xs">
          Vor dem Fortsetzen bitte unten „Ich habe Abschrift und Seitenzuordnung
          geprüft“ bestätigen.
        </p>
      )}
      <details class="mt-3 text-xs">
        <summary class="cursor-pointer underline">
          Genaue Fehlermeldung für Rückfragen anzeigen
        </summary>
        <p class="mt-2 whitespace-pre-wrap break-words">{error}</p>
      </details>
    </div>
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agentische Korrekturvorschläge"
      class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-3 sm:p-6"
    >
      <section class="mx-auto my-3 w-full max-w-4xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-xl font-bold text-slate-900">
            Korrekturvorschläge für deine Klasse
          </h2>
          <button
            type="button"
            class={control}
            aria-label="Korrektur schließen"
            onClick={() => {
              if (
                (busy || ((session?.pages.length || report) && !saved)) &&
                !confirm(
                  "Zwischenstände verwerfen und schließen? Lade sie vorher über „Zwischenstand herunterladen“ herunter. Laufende Modellanfragen können noch Kosten verursachen.",
                )
              ) return;
              controller.current?.abort();
              onClose();
            }}
          >
            ✕
          </button>
        </div>
        {issuePanel}
        <p class="mt-3 text-sm text-slate-600">
          Lade die Arbeiten deiner Klasse hoch und lege fest, worauf Bud-E
          achten soll. Du erhältst für jede Person einen Korrekturvorschlag als
          Word und PDF.
        </p>
        <div
          class="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-100 bg-white p-3 shadow-sm"
          aria-label="Sichern und Fortsetzen"
        >
          <span class="mr-auto text-sm font-semibold text-slate-800">
            {report
              ? "Ergebnisse fertig"
              : busy
              ? "Korrektur läuft – dieses Fenster offen lassen"
              : session?.pages.length
              ? "Dein Zwischenstand ist noch in diesem Fenster"
              : "Schritt für Schritt durch deine Korrektur"}
          </span>
          <button
            type="button"
            class={control}
            disabled={checkpointBusy || (!sources.length && !session)}
            onClick={exportCheckpoint}
          >
            Zwischenstand herunterladen
          </button>
          {busy && (
            <button
              type="button"
              class={control}
              onClick={() => controller.current?.abort()}
            >
              Pausieren
            </button>
          )}
          <button
            type="button"
            class="px-2 py-2 text-sm font-semibold text-indigo-700 underline"
            onClick={() => setShowResumeHelp(!showResumeHelp)}
          >
            Wie sichere ich und mache später weiter?
          </button>
        </div>
        {showResumeHelp && (
          <div class="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm leading-6">
            <h3 class="font-semibold">
              Sichern und später fortsetzen – ohne alles neu zu machen
            </h3>
            <ol class="mt-2 list-decimal space-y-2 pl-5">
              <li>
                Klicke auf „Zwischenstand herunterladen“. Dein Browser speichert
                eine Datei mit dem Namen „Bud-E-Korrektur-Zwischenstand…json“,
                meist im Ordner „Downloads“. Die Endung .json ist richtig; du
                musst die Datei nicht öffnen.
              </li>
              <li>
                Zum Aufhören erst „Pausieren“ anklicken. Schließe oder lade die
                Webseite erst neu, wenn du die Sicherungsdatei heruntergeladen
                hast. Diese Sicherung wird nicht automatisch auf dem Server
                gespeichert.
              </li>
              <li>
                Öffne später denselben Raum und „Korrekturvorschläge“. Wähle bei
                „Zwischenstand laden“ deine gesicherte Datei. Die
                Originalarbeiten musst du nicht erneut hochladen.
              </li>
              <li>
                Prüfe Zuordnung und Kriterien. Bestätige das Häkchen und klicke
                „Korrekturvorschläge erstellen“ bzw. bei fehlenden Abschriften
                „Abschrift und Zuordnung fortsetzen“. Bereits fertige Schritte
                werden wiederverwendet.
              </li>
            </ol>
            <p class="mt-3 font-semibold">
              Die Datei enthält Schülerarbeiten im Klartext. Geschützt
              aufbewahren, nicht an Schüler weitergeben. Weitere KI-Aufrufe
              können erneut Geld kosten.
            </p>
          </div>
        )}
        {session && (
          <div
            class="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-slate-600"
            aria-label="Bisheriger Arbeitsfortschritt im Fenster"
          >
            <div class="rounded-xl bg-slate-50 p-3">
              <strong class="block text-lg text-slate-900">
                {session.pages.length}/{session.sources.length}
              </strong>Seiten abgeschrieben
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <strong class="block text-lg text-slate-900">
                {session.papers.filter((p) => !p.ignored).length}
              </strong>Arbeiten zugeordnet
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <strong class="block text-lg text-slate-900">
                {checkedCount}
              </strong>Rückmeldungen fertig geprüft
            </div>
          </div>
        )}
        <GradingBudgetPanel
          load={loadBudget}
          busy={busy}
          privateRoom={privateRoom}
          problem={error}
        />
        <ol class="my-4 grid gap-3 text-sm sm:grid-cols-3">
          {[
            "Abschreiben",
            "Seiten zuordnen",
            "Bewerten & am Original prüfen",
          ].map((label, at) => (
            <li
              key={label}
              class={`rounded-xl border p-3 ${
                status && activeStep === at + 1
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <span class="font-bold">{at + 1}.</span>
              {label}
            </li>
          ))}
        </ol>
        <details class="my-3 text-sm text-slate-600">
          <summary class="cursor-pointer font-semibold">
            So funktioniert die Korrektur · Kosten und Datenschutz
          </summary>
          <p class="mt-2 text-sm leading-6 text-slate-600">
            Eine PDF kann die Arbeiten der ganzen Klasse enthalten. Sie wird
            zuerst in echte Einzelseiten zerlegt. Ein gemeinsamer KI-Aufruf
            sortiert danach alle Seiten – auch durcheinandergeratene Fotos –
            nach Schüler und Lesereihenfolge. Anschließend erhält jede
            Schülerarbeit einen eigenen Bewertungsentwurf mit demselben
            Erwartungshorizont und danach eine separate Zweitprüfung am
            Original. Dadurch entstehen zusätzliche Modellaufrufe; auch eine
            Zweitprüfung ist keine Garantie für Fehlerfreiheit. Bis zu{" "}
            {GRADING_PARALLEL} Aufrufe laufen gleichzeitig.
          </p>
          <p class="my-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            KI kann Namen, Handschrift und Seitenzuordnung verwechseln. Verwende
            möglichst Pseudonyme und prüfe die Ergebnisse vor der Weitergabe.
            Mehrere Modellaufrufe verursachen Kosten. {privateRoom
              ? "Anfragen gehen direkt an deinen Anbieter; nur der fertige Gesamtbericht wird im privaten Chat verschlüsselt gespeichert."
              : "Die Freigabe und das Budget deines Klassenraums gelten bei jedem Aufruf."}
            {" "}
            Originaldateien und Zwischenstände bleiben nur in diesem Fenster,
            bis du sie selbst herunterlädst. Ein Zwischenstand enthält die
            Arbeiten, Abschriften, Zuordnung, Kriterien und fertige/angefangene
            Bewertungen – keine API-Keys oder Passwörter. Die JSON-Datei ist
            unverschlüsselt: geschützt aufbewahren und nicht an Schüler
            weitergeben. Nach erneutem Hochladen kannst du auf einem anderen
            Gerät fortsetzen. Automatisch höchstens drei Versuche je
            fehlerhaftem Schritt; weitere Versuche nur auf deinen Klick.
            Word-DOCX ist editierbar; PDF ist direkt herunterladbar – kein
            Editor-Häkchen erforderlich.
          </p>
        </details>
        <p class="my-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          KI erstellt Vorschläge, keine freigegebene Bewertung. Prüfe Namen,
          Zuordnung und Punkte vor der Weitergabe. Vor dem Schließen:
          Zwischenstand sichern. Mehrere Modellaufrufe können Kosten
          verursachen.
        </p>
        <div class="my-4 rounded-xl border border-slate-200 p-3 text-sm">
          <p class="font-semibold">
            Deine Sicherungsdatei · auch auf einem anderen Gerät fortsetzen
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class={control}
              disabled={checkpointBusy || (!sources.length && !session)}
              onClick={() => void exportCheckpoint()}
            >
              Sicherungsdatei herunterladen
            </button>
            <label class="text-sm font-semibold">
              Zwischenstand laden
              <input
                aria-label="Zwischenstand laden"
                type="file"
                accept=".json,application/json"
                class="mt-1 block text-xs"
                disabled={busy || checkpointBusy}
                onChange={(event) => {
                  void importCheckpoint(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <p class="mt-2 text-xs text-slate-600">
            Auch während der Verarbeitung herunterladbar. Fertige Schritte
            werden beim Fortsetzen übersprungen; neue Modellaufrufe können
            Kosten verursachen. Vor dem Schließen oder Neuladen bitte sichern.
          </p>
          {downloadedAt && (
            <p class="mt-2 text-xs font-semibold text-emerald-800">
              Download um {downloadedAt}{" "}
              gestartet. Prüfe den Downloads-Ordner deines Browsers. Später
              fertig gewordene Schritte sind erst in einer neuen Sicherung
              enthalten.
            </p>
          )}
          {checkpointMessage && (
            <p role="status" class="mt-2 text-xs text-indigo-800">
              {checkpointMessage}
            </p>
          )}
        </div>
        {!session && (
          <div class="my-4 rounded-xl border border-slate-200 p-4">
            <label class="block text-sm font-semibold">
              1. Arbeiten hochladen<input
                aria-label="Arbeiten hochladen"
                type="file"
                multiple
                disabled={busy}
                accept=".zip,.pdf,.docx,.doc,.odt,.txt,.md,image/png,image/jpeg,image/webp"
                class="mt-2 block w-full text-sm"
                onChange={(event) => {
                  void upload(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <p class="mt-2 text-xs text-slate-500">
              PDF/Word/Fotos bis 20 MB je Datei, ZIP bis 40 MB. ZIP-Unterordner
              werden nach geeigneten Dateien durchsucht. Höchstens{" "}
              {MAX_GRADING_PAGES}
              vorbereitete Seiten/Abschnitte. Word wird anhand von Umbrüchen,
              Textabschnitten und eingebetteten Fotos zerlegt; für eine exakte
              Original-Seitenaufteilung Word vorher als PDF exportieren.
            </p>
            <details class="mt-3">
              <summary class="cursor-pointer text-sm font-semibold">
                {sources.length}{" "}
                Seiten/Abschnitte ausgewählt · Dateien anzeigen oder entfernen
              </summary>
              <ul class="my-3 max-h-48 space-y-2 overflow-y-auto text-sm">
                {sources.map((source, at) => (
                  <li key={at} class="flex items-center justify-between gap-2">
                    <span class="min-w-0 break-words">
                      {at + 1}. {source.name}
                    </span>
                    <button
                      type="button"
                      class={control}
                      disabled={busy}
                      aria-label={`Datei ${at + 1} entfernen`}
                      onClick={() =>
                        setSources(sources.filter((_, n) =>
                          n !== at
                        ))}
                    >
                      Entfernen
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        {!report && (
          <div class="my-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            <label class="block text-sm font-semibold">
              2. Erwartungshorizont / Korrekturkriterien<textarea
                ref={criteriaInput}
                aria-label="Erwartungshorizont / Korrekturkriterien"
                class={input + " min-h-32"}
                maxLength={20000}
                value={criteria}
                disabled={busy}
                onInput={(event) => setCriteria(event.currentTarget.value)}
                placeholder="Welche Antworten erwartest du? Wie viele Punkte gibt es je Teilaufgabe, wann Teilpunkte? Beispiel: Aufgabe 1 je richtige Lücke 1 Punkt; Aufgabe 2 je 2 Punkte, richtiger Ansatz 1 Teilpunkt. Notenschlüssel nur falls gewünscht."
              />
            </label>
            {criteriaClarification && (
              <div
                role="alert"
                class="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <p class="font-semibold">Rückfrage an dich als Lehrkraft</p>
                <p class="mt-2 whitespace-pre-wrap">{criteriaClarification}</p>
                <p class="mt-2 text-xs">
                  Die Bewertung pausiert. Ergänze die Kriterien oben und starte
                  die Korrekturvorschläge anschließend erneut. Fertige
                  Abschriften bleiben erhalten; es wird keine Punktregel
                  erfunden.
                </p>
              </div>
            )}
            <p class="mt-2 text-xs text-slate-600">
              Der Maßstab gilt für alle Arbeiten. Fehlende Punkte werden nicht
              erfunden; ohne Notenschlüssel gibt es keine Note. Rückmeldungen
              richten sich freundlich direkt an die Schüler.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                class={control}
                disabled={busy || criteria.includes(DERIVE_SOLUTIONS_POLICY)}
                onClick={() =>
                  setCriteria(
                    criteria.trim() + "\n\n" + DERIVE_SOLUTIONS_POLICY,
                  )}
              >
                Lösungen aus den Aufgaben ableiten erlauben
              </button>
              <button
                type="button"
                class={control}
                disabled={busy || /Ohne Punkte bewerten\./.test(criteria)}
                onClick={() =>
                  setCriteria(
                    criteria.trim() +
                      "\n\nOhne Punkte bewerten. Nur fachliche Rückmeldung, keine Note.",
                  )}
              >
                Ausdrücklich ohne Punkte bewerten
              </button>
            </div>
            {criteriaQuestions.length > 0 && (
              <div
                class="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
                aria-live="polite"
              >
                <p class="font-semibold">Vor der Bewertung noch klären:</p>
                <ul class="mt-2 list-disc space-y-1 pl-5">
                  {criteriaQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
                <p class="mt-2 text-xs">
                  Ergänze deine Antworten im Feld oben. Abschrift und Zuordnung
                  sind auch vorher möglich, wenn die Automatik ausgeschaltet
                  ist.
                </p>
              </div>
            )}
            {
              <>
                <label class="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={automatic}
                    disabled={busy}
                    onChange={(event) =>
                      setAutomatic(event.currentTarget.checked)}
                    class="mt-1"
                  />
                  <span>
                    Alle drei Stufen automatisch durchführen – ohne
                    Zwischenstopp zur Prüfung der Abschrift
                  </span>
                </label>
                <p class="mt-2 text-xs text-slate-600">
                  Ohne Häkchen hält Bud-E nach Abschrift und Gruppierung an. Mit
                  Häkchen muss der Erwartungshorizont schon vor dem Start
                  eingetragen sein; die anschließende Bewertung startet
                  automatisch. Unsichere Lesestellen können trotzdem enthalten
                  sein.
                </p>
              </>
            }
          </div>
        )}
        {!ready && (
          <button
            type="button"
            class={primary}
            disabled={busy || checkpointBusy || !sources.length ||
              (automatic && criteriaQuestions.length > 0)}
            onClick={() => void run(false)}
          >
            {session
              ? "Abschrift und Zuordnung fortsetzen"
              : automatic
              ? "Alle drei Stufen starten"
              : "Abschrift und Zuordnung starten"}
          </button>
        )}
        {status && (
          <div class="my-4 rounded-xl bg-slate-50 p-4">
            <div class="mb-2 flex justify-between text-sm font-semibold">
              <span>
                {status.stage === "review"
                  ? "Prüfpause – deine Rückmeldung ist gefragt"
                  : status.stage === "guidance"
                  ? `Lösungsschlüssel vorbereiten: ${status.completed} / ${status.total} Teilschritte`
                  : status.stage === "mark"
                  ? `Bewertet: ${status.completed} / ${status.total} Schülerarbeiten`
                  : status.stage === "transcribe"
                  ? `Abgeschrieben: ${status.completed} / ${status.total} Seiten`
                  : status.stage === "done"
                  ? `Alle ${status.total} Schülerarbeiten bewertet`
                  : status.stage === "group"
                  ? "Stufe 2: alle Seiten werden gruppiert"
                  : "Seiten werden vorbereitet"}
              </span>
              <span>{percent}%</span>
            </div>
            {status.stage === "guidance" && (
              <p class="mb-3 text-sm text-slate-600">
                Bevor Bud-E einzelne Schüler bewertet, erstellt und prüft es für
                jede Testversion eine gemeinsame Lösung. Das verhindert
                unterschiedliche Maßstäbe. „0 bewertet“ wäre in dieser Phase
                normal – die Einzelbewertung beginnt danach.
              </p>
            )}
            {steps.length > 0 && (
              <p class="mb-2 text-xs text-slate-600" aria-live="polite">
                {steps.at(-1)}
              </p>
            )}
            <div
              role="progressbar"
              aria-label="Korrekturfortschritt"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              class="h-3 overflow-hidden rounded-full bg-slate-200"
            >
              <div
                class="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            {busy && (
              <p class="mt-3 text-xs text-slate-600" role="timer">
                Dieser Durchgang läuft seit {Math.floor(duration / 60)} Min.
                {" "}
                {duration % 60} Sek. · {pendingCalls}{" "}
                KI-Schritte in Bearbeitung · letzte Statusmeldung vor {silence}
                {" "}
                Sek. {pendingCalls > 0 &&
                  ` · längster offener KI-Schritt: ${oldestJob} Sek.`}{" "}
                Große Stapel und gründliche Zweitprüfungen können mehrere
                Minuten dauern. Diese Anzeige ist keine Zusage, dass der
                Anbieter noch antwortet.
              </p>
            )}
            {busy && (silence >= 75 || oldestJob >= 90) && (
              <div class="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Es gibt länger keine neue Rückmeldung.</strong>{" "}
                Lass den Tab geöffnet und prüfe die Internetverbindung. Du
                kannst jederzeit den Zwischenstand herunterladen und pausieren.
                Starte nicht mehrfach gleichzeitig neu; laufende
                Anbieteranfragen können noch Kosten verursachen.
              </div>
            )}
            {!busy && !report && session && (
              <p class="mt-3 text-sm font-semibold text-indigo-800">
                {error
                  ? "Angehalten – deine fertigen Schritte sind noch da. Beachte die Hilfe unten und sichere den Zwischenstand."
                  : ready
                  ? "Du bist dran: Prüfe Zuordnung und Kriterien, setze das Bestätigungshäkchen und erstelle dann die Korrekturvorschläge."
                  : "Bereit zum Fortsetzen: Nur die noch fehlenden Schritte werden bearbeitet."}
              </p>
            )}
          </div>
        )}
        {steps.length > 0 && (
          <details class="my-4 rounded-xl border border-slate-200 p-3">
            <summary class="cursor-pointer text-sm font-semibold">
              Arbeitsschritte ({steps.length})
            </summary>
            <ol class="mt-2 max-h-56 list-decimal space-y-1 overflow-y-auto pl-5 text-xs text-slate-600">
              {steps.map((step, at) => <li key={at}>{step}</li>)}
            </ol>
          </details>
        )}
        {session && (
          <div class="my-4">
            <details class="rounded-xl border border-slate-200 p-3">
              <summary class="cursor-pointer font-semibold">
                Abschrift prüfen · {session.pages.length} Seiten ·{" "}
                {session.papers.filter((p) => !p.ignored).length}{" "}
                Schülerarbeiten ·{" "}
                {session.papers.filter((p) => p.ignored).reduce(
                  (n, p) => n + p.pages.length,
                  0,
                )} Seiten nicht bewertet
              </summary>
              <div class="my-3">
                <GradingReportDownload
                  transcript
                  text={transcriptMarkdown(session.pages, session.papers, "de")}
                />
              </div>
              <div class="max-h-96 space-y-3 overflow-y-auto">
                {session.pages.map((page) => (
                  <div
                    key={page.page}
                    class="block text-xs font-semibold text-slate-600"
                  >
                    <label>
                      Seite {page.page} · {page.file}
                      <textarea
                        aria-label={`Abschrift Seite ${page.page}`}
                        disabled={busy || !!report || !ready}
                        class={input + " min-h-28 font-normal"}
                        value={page.transcript}
                        onInput={(event) => {
                          const transcript = event.currentTarget.value;
                          updateWork({
                            ...session,
                            pages: session.pages.map((item) =>
                              item.page === page.page
                                ? { ...item, transcript }
                                : item
                            ),
                          });
                          setReviewed(false);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      class={control + " mt-1 text-xs"}
                      disabled={busy || checkpointBusy ||
                        session.pendingPages?.includes(page.page)}
                      aria-label={`Seite ${page.page} erneut abschreiben`}
                      onClick={() => {
                        const current = workRef.current ?? session;
                        updateWork({
                          ...current,
                          pendingPages: [
                            ...new Set([
                              ...(current.pendingPages ?? []),
                              page.page,
                            ]),
                          ],
                        });
                        setReport("");
                        setSaved(false);
                        setReviewed(false);
                        setLastAction("transcribe");
                        setCheckpointMessage(
                          `Seite ${page.page} zur erneuten Abschrift vorgemerkt. Klicke „Abschrift und Zuordnung fortsetzen“. Alle anderen fertigen Seiten bleiben erhalten.`,
                        );
                      }}
                    >
                      {session.pendingPages?.includes(page.page)
                        ? "Erneute Abschrift vorgemerkt"
                        : "Diese Seite erneut lesen"}
                    </button>
                  </div>
                ))}
              </div>
            </details>
            {!report && ready && (
              <div class="mt-4 rounded-xl border border-slate-200 p-4">
                <details open={!automatic && !busy}>
                  <summary class="cursor-pointer font-semibold">
                    Zuordnung und Reihenfolge prüfen · {groups.filter((g) =>
                      !g.ignored
                    ).length} Arbeiten
                  </summary>
                  <button
                    type="button"
                    class={control + " mt-2"}
                    disabled={busy || checkpointBusy}
                    onClick={() => {
                      if (!workRef.current) {
                        return;
                      }
                      updateWork({ ...workRef.current, papers: [] });
                      setGroups([]);
                      setReviewed(false);
                      void run(false, true);
                    }}
                  >
                    Zuordnung mit aktuellem Auftrag erneut prüfen
                  </button>
                  <p class="mt-1 text-xs text-slate-500">
                    Jede Seite muss genau einmal vorkommen. Seiten in
                    Lesereihenfolge eintragen, z. B. 3, 1, 4. Bei Bedarf Gruppen
                    ergänzen, Namen ändern oder Gruppen entfernen.
                  </p>
                  {groups.map((group, at) => (
                    <div key={at} class="mt-3 rounded-xl bg-slate-50 p-3">
                      <div class="grid gap-2 sm:grid-cols-2">
                        <label class="text-xs">
                          Schüler / Pseudonym<input
                            aria-label={`Schülergruppe ${at + 1}`}
                            class={input}
                            value={group.student}
                            disabled={busy}
                            onInput={(event) => {
                              const student = event.currentTarget.value;
                              setGroups(
                                groups.map((g, n) =>
                                  n === at ? { ...g, student } : g
                                ),
                              );
                              setReviewed(false);
                            }}
                          />
                        </label>
                        <label class="text-xs">
                          Seiten in Lesereihenfolge<input
                            aria-label={`Seiten Gruppe ${at + 1}`}
                            class={input}
                            value={group.pages}
                            disabled={busy}
                            onInput={(event) => {
                              const pages = event.currentTarget.value;
                              setGroups(
                                groups.map((g, n) =>
                                  n === at ? { ...g, pages } : g
                                ),
                              );
                              setReviewed(false);
                            }}
                          />
                        </label>
                      </div>
                      {group.note && (
                        <p class="mt-2 text-xs text-slate-500">{group.note}</p>
                      )}
                      <label class="mt-2 flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={group.ignored === true}
                          disabled={busy}
                          aria-label={`Gruppe ${at + 1} nicht bewerten`}
                          onChange={(event) => {
                            const ignored = event.currentTarget.checked;
                            setGroups(groups.map((g, n) =>
                              n === at
                                ? {
                                  ...g,
                                  ignored,
                                  note: g.note ||
                                    "Von der Lehrkraft ausdrücklich als nicht zu bewertende Vorlage/Rückseite ausgewählt.",
                                }
                                : g
                            ));
                            setReviewed(false);
                          }}
                        />Nicht bewerten: Vorlage oder ausdrücklich
                        ausgeschlossene Rückseite. Eine leere Hauptarbeit mit
                        Namen bitte behalten.
                      </label>
                      <button
                        type="button"
                        class="mt-2 text-xs text-red-700 underline"
                        disabled={busy}
                        onClick={() => {
                          setGroups(groups.filter((_, n) =>
                            n !== at
                          ));
                          setReviewed(false);
                        }}
                      >
                        Gruppe entfernen
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    class={control + " mt-3"}
                    disabled={busy}
                    onClick={() => {
                      setGroups([...groups, {
                        student: "",
                        pages: "",
                        note: "Manuell ergänzt",
                      }]);
                      setReviewed(false);
                    }}
                  >
                    Gruppe ergänzen
                  </button>
                  <label class="mt-4 block text-sm font-semibold">
                    Feedback / Korrekturen zur Abschrift<textarea
                      aria-label="Feedback zur Abschrift"
                      class={input}
                      maxLength={8000}
                      disabled={busy}
                      value={feedback}
                      onInput={(event) =>
                        setFeedback(event.currentTarget.value)}
                      placeholder="Z. B. Seite 4 gehört zu Spencer; in Aufgabe 3 steht Salto. Du kannst die Abschriften und Seitenlisten oben auch direkt bearbeiten."
                    />
                  </label>
                </details>
                <label class="mt-3 flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={busy}
                    onChange={(event) =>
                      setReviewed(event.currentTarget.checked)}
                  />Ich habe Abschrift und Seitenzuordnung geprüft.
                </label>
                <button
                  type="button"
                  class={primary + " mt-3"}
                  disabled={busy || criteriaQuestions.length > 0 ||
                    (!reviewed && !automatic) ||
                    groups.every((g) => g.ignored)}
                  onClick={() => void run(true)}
                >
                  Korrekturvorschläge erstellen
                </button>
              </div>
            )}
          </div>
        )}
        {report && (
          <div class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <h3 class="font-bold">
              Korrekturvorschläge fertig · alle {session?.papers.filter((p) =>
                !p.ignored
              ).length} Schülerarbeiten
            </h3>
            <p class="mt-2 text-xs text-slate-600">
              Beide Downloads enthalten sämtliche Schülergruppen, mit getrennten
              Abschnitten je Schüler. Word-Datei: .docx (kein veraltetes binäres
              .doc).
            </p>
            <div class="my-3 max-h-96 overflow-y-auto text-sm">
              <ClassroomCodeContent content={report} />
            </div>
            <GradingReportDownload text={report} />
            <button
              type="button"
              class={control + " mt-2"}
              disabled={busy || checkpointBusy}
              onClick={() => {
                const current = workRef.current;
                if (!current?.cache) return;
                current.cache.checked = [];
                updateWork(current);
                setReport("");
                setSaved(false);
                setReviewed(false);
                setLastAction("mark");
                setCheckpointMessage(
                  "Rückmeldungen zur erneuten Originalprüfung vorgemerkt. Abschriften und Entwürfe bleiben erhalten. Bestätige die Zuordnung und starte die Korrekturvorschläge erneut; zusätzliche API-Kosten sind möglich.",
                );
              }}
            >
              Rückmeldungen erneut prüfen
            </button>
            {saved
              ? (
                <p class="mt-3 text-xs text-slate-500">
                  Im Chat verfügbar. Bitte vor Verwendung prüfen.
                </p>
              )
              : (
                <button
                  type="button"
                  class={control + " mt-2"}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    onBusyChange(true);
                    try {
                      await save(report, session!, joinedCriteria());
                      setError("");
                    } catch (cause) {
                      if (!disposed.current) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Speichern fehlgeschlagen.",
                        );
                      }
                    } finally {
                      if (!disposed.current) {
                        setBusy(false);
                        onBusyChange(false);
                      }
                    }
                  }}
                >
                  Im Chat speichern
                </button>
              )}
          </div>
        )}
        {busy && (
          <p role="status" class="mt-3 text-sm text-indigo-700">
            Bud-E arbeitet. Mit „Pausieren“ oben kannst du anhalten. Fertige
            Schritte bleiben im offenen Fenster erhalten.
          </p>
        )}
      </section>
    </div>
  );
}
