import type { ResearchReport } from "../utils/classroomResearch.ts";

export default function ResearchDetails(
  { report }: { report: ResearchReport },
) {
  return (
    <details class="mt-3 rounded-lg border border-slate-300 bg-white/80 p-3 text-xs">
      <summary class="cursor-pointer font-semibold text-slate-700">
        Suche nachprüfen ·{" "}
        {report.kind === "papers" ? "ORKG / Papers" : "Wikipedia"} · Rohdaten
      </summary>
      <p class="mt-2">
        Suchbegriff: {report.query} ·{" "}
        {new Date(report.at).toLocaleString("de-DE")}
      </p>
      <p class="mt-1 text-slate-600">
        Das sind die Antworten der Such-API, nicht vom Sprachmodell erfundene
        Ergebnisse. Die KI erhält die unten verlinkten Auszüge, nicht zwingend
        alle Treffer.
      </p>
      {report.error && <p class="mt-2 text-red-700">{report.error}</p>}
      {report.requests.map((request, i) => (
        <div key={i} class="mt-3">
          <a
            href={request.url}
            target="_blank"
            rel="noopener noreferrer"
            class="break-all text-blue-700 underline"
          >
            API-Abfrage {i + 1}
          </a>
          <p>
            HTTP {request.status || "– (keine Antwort)"}
            {request.truncated ? " · Anzeige gekürzt" : ""}
          </p>
          <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-3 text-slate-100">{request.body}</pre>
        </div>
      ))}
    </details>
  );
}
