import { useEffect, useState } from "preact/hooks";
import type { GradingSession } from "../utils/gradingBatch.ts";
import {
  buildGradingDossier,
  gradingDossierWorks,
} from "../utils/gradingDossier.ts";
import { gradingEvidenceWarnings } from "../utils/gradingEvidence.ts";
import type { SourceDoc } from "../utils/grading.ts";
import { gradingOriginalImage } from "../utils/gradingOriginals.ts";
import { GradingInfo } from "./GradingHelp.tsx";

const button =
  "rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-800 disabled:opacity-40";
export default function GradingDossierDownload(
  { session, criteria }: { session: GradingSession; criteria: string },
) {
  const [working, setWorking] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const uncertainGroups = session.papers.filter((paper) =>
    !paper.ignored &&
    /unsicher|unbekannt|unleser|im Zweifel|nicht sicher|möglicherweise|ungeklärt|\[\?/i
      .test(`${paper.student} ${paper.note ?? ""}`)
  );
  useEffect(() => {
    let stopped = false;
    void gradingDossierWorks(session, criteria).then((works) => {
      if (!stopped) {
        setWarnings(
          works.flatMap((work) =>
            work.report
              ? gradingEvidenceWarnings(
                work.pages.map((p) => p.transcript),
                work.report,
              ).map((w) => `${work.id}: ${w}`)
              : []
          ),
        );
      }
    }).catch(() => {}); // A precise mapping error is shown if export is attempted.
    return () => {
      stopped = true;
    };
  }, [session, criteria]);
  async function download(pdf: boolean) {
    setWorking(true);
    setError("");
    setStatus("Seitenzuordnung wird geprüft …");
    try {
      const bytes = await buildGradingDossier(
        session,
        criteria,
        pdf,
        setStatus,
      );
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: pdf
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `Pruefmappe-Originale-Abschriften-Feedback.${
        pdf ? "pdf" : "docx"
      }`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(
        "Prüfmappe heruntergeladen. Sie enthält alle Arbeiten – nicht vollständig an einzelne Schüler weitergeben.",
      );
    } catch (cause) {
      setError(
        (cause instanceof Error ? cause.message : "Download fehlgeschlagen.") +
          " Deine Ergebnisse bleiben erhalten. Du kannst den Download erneut versuchen oder zuerst den Zwischenstand sichern.",
      );
      setStatus("");
    } finally {
      setWorking(false);
    }
  }
  return (
    <section
      class="my-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4"
      aria-label="Prüfmappe herunterladen"
    >
      <h4 class="font-semibold text-indigo-950">
        Alles nachvollziehen: deine Prüfmappe
        <GradingInfo
          label="Prüfmappe und Schüler-Feedback"
          text="Die Prüfmappe ist für dich: Sie verbindet Originale, Abschriften und Rückmeldungen der ganzen Klasse. Word (.docx) kannst du bearbeiten, PDF ansehen und drucken. Die getrennten Schüler-Feedbacks sind zum Weitergeben nach deiner Prüfung gedacht. Alle Downloads sind unverschlüsselt."
        />
      </h4>
      <details
        class="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm"
        aria-label="Übersicht der Seitenzuordnung"
      >
        <summary class="cursor-pointer font-semibold">
          Welche Seiten gehören zu wem? ·{" "}
          {session.papers.filter((p) => !p.ignored).length} Arbeitsgruppen
        </summary>
        <p class="mt-2 text-slate-600">
          Das ist eine Zuordnung der KI, keine bestätigte Klassenliste. Prüfe
          besonders Namen, Rückseiten und mögliche doppelte Arbeiten. Die
          Original-ID findest du auch in der Abschrift und Prüfmappe.
        </p>
        <ul class="mt-3 max-h-80 space-y-3 overflow-y-auto">
          {session.papers.map((paper, at) => (
            <li key={at} class="border-t border-slate-100 pt-2">
              <strong>
                Arbeit {String(at + 1).padStart(2, "0")}: {paper.student}
              </strong>
              <p>
                Original-IDs in Lesereihenfolge: {paper.pages.join(", ")}
                {paper.ignored ? " · nicht bewertet" : ""}
              </p>
              {paper.note && (
                <p class="mt-1 text-xs text-slate-600">{paper.note}</p>
              )}
            </li>
          ))}
        </ul>
      </details>
      {uncertainGroups.length > 0 && (
        <p class="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          Bei {uncertainGroups.length}{" "}
          Arbeitsgruppen sind Name oder Zuordnung als unsicher beschrieben.
          Prüfe die Übersicht und die Originale, bevor du Rückmeldungen
          verteilst.
        </p>
      )}
      {warnings.length > 0 && (
        <div
          class="my-3 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950"
          aria-label="Widersprüche zwischen Abschrift und Rückmeldung"
        >
          <p class="font-bold">
            Vor der Weitergabe prüfen: {warnings.length}{" "}
            Abweichungen zwischen Abschrift und Rückmeldung.
          </p>
          <p class="mt-1">
            Die KI kann beim Bewerten versehentlich eine erwartete Lösung statt
            des tatsächlichen Schüler-Eintrags übernehmen. Eine zweite
            KI-Prüfung schließt das nicht sicher aus. Vergleiche die markierten
            Stellen am Original. Die Prüfmappe enthält diese Hinweise. Die
            reinen Schüler-Feedbacks enthalten sie nicht – bitte erst nach
            deiner Prüfung verteilen.
          </p>
          <details class="mt-2">
            <summary class="cursor-pointer font-semibold">
              Welche Originalseiten muss ich prüfen?
            </summary>
            <ul class="mt-2 max-h-64 list-disc space-y-2 overflow-y-auto pl-5">
              {warnings.map((w, at) => <li key={at}>{w}</li>)}
            </ul>
          </details>
        </div>
      )}
      <p class="mt-2 text-sm text-slate-700">
        Je Schülerarbeit: Originalseite → Abschrift auf einer neuen Seite. Bei
        mehreren Blättern wiederholt sich dieses Paar. Danach folgt das
        Schüler-Feedback auf einer neuen Seite. Original-IDs verbinden die Teile
        eindeutig; nicht bewertete Seiten bleiben mit Begründung enthalten.
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class={button}
          disabled={working}
          onClick={() => void download(true)}
        >
          Prüfmappe als PDF herunterladen
        </button>
        <button
          type="button"
          class={button}
          disabled={working}
          onClick={() => void download(false)}
        >
          Prüfmappe als Word herunterladen
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-600">
        Wird auf deinem Gerät erstellt, ohne neue KI-Anfrage. Enthält die
        Arbeiten aller Schüler. Vor dem Schließen herunterladen oder den
        Zwischenstand sichern.
      </p>
      <p class="mt-2 text-xs text-slate-600">
        Auch ohne Warnung sind richtige Lesung, Zuordnung und Punktvergabe nicht
        garantiert. Die Prüfung am Original bleibt nötig.
      </p>
      {status && (
        <p role="status" class="mt-2 text-sm text-indigo-800">{status}</p>
      )}
      {error && <p role="alert" class="mt-2 text-sm text-red-800">{error}</p>}
    </section>
  );
}

export function GradingOriginalPreview({ source }: { source: SourceDoc }) {
  const [open, setOpen] = useState(false),
    [image, setImage] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function show() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (image || source.kind === "text") return;
    setLoading(true);
    setError("");
    try {
      setImage((await gradingOriginalImage(source)).src);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Original konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <div class="my-2">
      <button
        type="button"
        class={button}
        disabled={loading}
        aria-expanded={open}
        onClick={() => void show()}
      >
        {open ? "Original ausblenden" : `Originalseite ${source.index} ansehen`}
      </button>
      {open && (
        <div class="mt-2 rounded-lg border border-slate-200 bg-white p-2">
          {loading && (
            <p role="status">Original wird auf deinem Gerät geöffnet …</p>
          )}
          {error && (
            <p role="alert">
              {error}{" "}
              Schließe die Vorschau und öffne sie erneut, um es noch einmal zu
              versuchen.
            </p>
          )}
          {image && (
            <img
              src={image}
              alt={`Originalseite ${source.index} · ${source.name}`}
              class="mx-auto max-h-[42rem] max-w-full object-contain"
            />
          )}
          {source.kind === "text" && (
            <pre class="whitespace-pre-wrap font-sans font-normal">{source.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}
