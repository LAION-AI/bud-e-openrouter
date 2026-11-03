import { GradingFailure } from "./gradingProtocol.ts";

/** Structural checks, not a replacement for subject/handwriting review. */
export function gradingReportIssues(text: string): string[] {
  const issues: string[] = [], tasks = new Set<string>();
  let columns = 0;
  for (const line of text.split("\n")) {
    const task = /^#{1,6}\s*Aufgabe\s+(\d+)\b/i.exec(line);
    if (task) {
      if (tasks.has(task[1])) {
        issues.push(
          `Aufgabe ${
            task[1]
          } hat mehrere Hauptabschnitte; eine einzige widerspruchsfreie Endfassung erstellen.`,
        );
      }
      tasks.add(task[1]);
    }
    if (!line.trim().startsWith("|")) {
      columns = 0;
      continue;
    }
    const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length;
    if (!columns) columns = cells;
    else if (columns !== cells) {
      issues.push(
        "Unvollständige Markdown-Tabelle: Zeilen haben unterschiedlich viele Spalten.",
      );
    }
  }
  return [...new Set(issues)];
}

/** Extract exactly one complete JSON object; never invent missing content. */
export function gradingJson(
  text: string,
  warning: (message: string) => void = () => {},
): Record<string, unknown> {
  if (text.length > 300000) {
    throw new GradingFailure("Die strukturierte Antwort ist zu lang.");
  }
  const input = text.replace(/^\uFEFF/, "").trim();
  const start = input.indexOf("{");
  if (start < 0) {
    throw new GradingFailure("Die KI hat kein JSON-Objekt geliefert.");
  }
  let quoted = false, escaped = false, depth = 0, end = -1;
  for (let at = start; at < input.length; at++) {
    const ch = input[at];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      if (--depth === 0) {
        end = at + 1;
        break;
      }
    }
  }
  if (end < 0 || input.slice(end).includes("{")) {
    throw new GradingFailure(
      "Die JSON-Antwort ist unvollständig oder mehrdeutig. Die Seite wird erneut angefragt.",
    );
  }
  const raw = input.slice(start, end);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Only deterministic syntax repairs: literal control characters in strings,
    // invalid backslash escapes, trailing commas. No guesses about missing text.
    let fixed = "";
    quoted = false;
    for (let at = 0; at < raw.length; at++) {
      const ch = raw[at];
      if (ch === '"') {
        quoted = !quoted;
        fixed += ch;
      } else if (quoted && ch === "\\") {
        const next = raw[at + 1];
        if (
          next &&
          ('"\\/bfnrt'.includes(next) ||
            (next === "u" && /^[a-f0-9]{4}$/i.test(raw.slice(at + 2, at + 6))))
        ) {
          fixed += ch + next;
          at++;
        } else fixed += "\\\\";
      } else if (quoted && ch.charCodeAt(0) < 32) {
        fixed += JSON.stringify(ch).slice(1, -1);
      } else if (
        !quoted && ch === "," && /^[\s]*[}\]]/.test(raw.slice(at + 1))
      ) continue;
      else fixed += ch;
    }
    try {
      value = JSON.parse(fixed);
      warning("JSON-Schreibweise lokal bereinigt; Abschrift bitte prüfen.");
    } catch {
      throw new GradingFailure(
        "Die KI hat kein gültiges JSON geliefert. Nur dieser Schritt muss erneut versucht werden.",
      );
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GradingFailure("Ungültige strukturierte KI-Antwort.");
  }
  return value as Record<string, unknown>;
}

export function retryableGrading(error: unknown): boolean {
  if (error instanceof GradingFailure) return error.retryable;
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  return !/Guthaben|Ausgabenrahmen|geschlossen|Freigabe|gesperrt|API.Key|nicht mehr verfügbar|Zugriff.*abgelehnt|Erwartungshorizont|Tageslimit|Tageskontingent|daily.quota/i
    .test(error instanceof Error ? error.message : "");
}
export function gradingDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}
export async function recoverGrading<T>(
  label: string,
  task: (
    attempt: number,
    plain: boolean,
    requestSignal: AbortSignal,
  ) => Promise<T>,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<T> {
  let plain = false;
  for (let attempt = 0;; attempt++) {
    signal.throwIfAborted();
    const started = Date.now();
    const heartbeat = setInterval(() => {
      progress(
        `${label}: warte seit ${
          Math.round((Date.now() - started) / 1000)
        } Sekunden auf den Abschluss dieses KI-Schritts. Das ist noch keine fertige Antwort. Bei Bedarf kannst du pausieren und den Zwischenstand sichern.`,
      );
    }, 25000);
    try {
      return await withGradingTimeout(
        signal,
        (requestSignal) => task(attempt, plain, requestSignal),
      );
    } catch (error) {
      signal.throwIfAborted();
      if (
        error instanceof GradingFailure && error.code === "format_unsupported"
      ) plain = true;
      if (
        /schema|response.format|Google hat die Modellanfrage abgelehnt/i.test(
          error instanceof Error ? error.message : "",
        )
      ) plain = true;
      if (attempt >= 2 || !retryableGrading(error)) throw error;
      const message = error instanceof Error ? error.message : "";
      const delay =
        /429|zu viele Anfragen|Anfragelimit|Minutenlimit|ausgelastet|überlastet/i
            .test(message)
          ? 10000 * (attempt + 1)
          : Math.min(1000 * 2 ** attempt, 5000);
      progress(
        `${label}: vorübergehender Fehler · automatischer Versuch ${
          attempt + 2
        }/3 in ${delay / 1000} Sekunden`,
      );
      await gradingDelay(delay, signal);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

export async function withGradingTimeout<T>(
  signal: AbortSignal,
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 180000,
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  let cancel!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      controller.abort(signal.reason);
      reject(signal.reason);
    };
  });
  signal.addEventListener("abort", cancel, { once: true });
  let expired!: (error: unknown) => void;
  const timeout = new Promise<never>((_resolve, reject) => expired = reject);
  const timer = setTimeout(() => {
    const error = new GradingFailure(
      "Zeitlimit der Modellanfrage erreicht. Fertige Ergebnisse bleiben erhalten.",
      true,
      "timeout",
    );
    controller.abort(error);
    expired(error);
  }, timeoutMs);
  try {
    return await Promise.race([task(controller.signal), stopped, timeout]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

export async function gradingHash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(
    new Uint8Array(bytes),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
