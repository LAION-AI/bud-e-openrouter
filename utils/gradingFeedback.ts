import type { OpenRouterBalance } from "./openrouterBalance.ts";

export type GradingBudgetSnapshot = {
  scope: "classroom" | "personal";
  permission?: "teacher-login-required";
  slug?: string;
  authReason?: "missing" | "different-room";
  provider?: string;
  checkedAt: number;
  room?: {
    budgetUsd: number;
    spentUsd: number;
    reservedUsd: number;
    activeCalls: number;
    active: boolean;
    expiresAt: number;
    disabled: boolean;
  };
  balance?: OpenRouterBalance;
};
export type GradingBudgetLoader = (
  provider: boolean,
  signal: AbortSignal,
) => Promise<GradingBudgetSnapshot>;

export function gradingFailureCode(message: string): string {
  if (
    /API.?Key|API.?Schlüssel|ungültiger.*Schlüssel|401|unauthorized/i.test(
      message,
    )
  ) return "provider_auth";
  if (/Guthaben|credits?|402|insufficient.*balance/i.test(message)) {
    return "provider_credit";
  }
  if (/Ausgabenrahmen|Raum.?Budget/i.test(message)) return "room_budget";
  if (
    /geschlossen|Freigabe|abgelaufen|gesperrt|erneut anmelden/i.test(message)
  ) return "room_closed";
  if (
    /429|Anfragelimit|Kontingent|quota|ausgelastet|Minutenlimit|zu viele Anfragen/i
      .test(message)
  ) return "provider_rate";
  if (/Zeitlimit|timeout|timed out/i.test(message)) return "timeout";
  if (
    /JSON|Schema|strukturierte|unvollständig|Format|Teilantwort/i.test(message)
  ) return "format";
  if (
    /fetch|network|Netzwerk|Verbindung|Internet|erreichbar|502|503/i.test(
      message,
    )
  ) return "network";
  return "other";
}

export function gradingErrorHelp(message: string, code = "", personal = false) {
  const kind = !code || ["model", "request"].includes(code)
    ? gradingFailureCode(message)
    : code;
  const settings = personal
    ? "Öffne die Einstellungen deines privaten Raums"
    : "Öffne /my in einem zweiten Tab und melde dich als Lehrkraft für diesen Raum an";
  const help: Record<string, [string, string, string]> = {
    room_budget: [
      "Das Raumbudget reicht für den nächsten Schritt nicht aus.",
      "Das ist die Kostengrenze dieses Raums – nicht das Guthaben beim KI-Anbieter. Bereits verbrauchtes Geld wird beim Fortsetzen nicht zurückgesetzt.",
      `${settings}. Erhöhe dort bei Bedarf das Raumbudget. Danach hier auf „Noch einmal versuchen“ klicken.`,
    ],
    provider_credit: [
      "Der KI-Anbieter meldet zu wenig Guthaben oder ein erreichtes Key-Limit.",
      "Ein höheres Raumbudget allein löst das nicht. Das Anbieterkonto und der API-Key haben eigene Grenzen.",
      "Prüfe Guthaben und Key-Limit beim Anbieter, z. B. im OpenRouter-Konto. Lade bei Bedarf Guthaben nach oder passe das Key-Limit an. Danach hier fortsetzen.",
    ],
    provider_auth: [
      "Der KI-Anbieter akzeptiert den hinterlegten Schlüssel nicht.",
      "Der Schlüssel kann abgelaufen, gesperrt oder falsch sein. Deine bisherigen Abschriften sind dadurch nicht verloren.",
      `${settings} und prüfe bzw. ersetze den API-Key. Danach hier fortsetzen.`,
    ],
    room_closed: [
      personal
        ? "Dein privater Raum muss wieder entsperrt werden."
        : "Der Klassenraum ist nicht mehr freigegeben.",
      "Die Freigabe kann beendet oder abgelaufen sein. Das ist kein Fehler in deinen Arbeiten.",
      `${settings}. Gib den Raum wieder frei. Falls du diese Seite neu öffnen musst, lade zuerst den Zwischenstand herunter.`,
    ],
    provider_rate: [
      "Der KI-Anbieter nimmt gerade nicht genügend Anfragen an.",
      "Das kann ein kurzfristiger Engpass oder ein Tageslimit sein – es bedeutet nicht automatisch, dass Guthaben fehlt.",
      "Warte etwas und versuche es erneut. Bei einem Tageslimit später fortsetzen oder in den Raumeinstellungen ein anderes geeignetes Modell wählen.",
    ],
    timeout: [
      "Eine Antwort hat zu lange gedauert.",
      "Die Korrektur wurde angehalten. Fertige Abschriften und geprüfte Rückmeldungen bleiben im offenen Fenster erhalten. Eine abgebrochene Anbieteranfrage kann trotzdem noch Kosten verursachen.",
      "Sichere zuerst den Zwischenstand. Prüfe deine Internetverbindung und klicke dann auf „Noch einmal versuchen“.",
    ],
    format: [
      "Eine KI-Antwort war nicht vollständig oder nicht lesbar genug.",
      "Bud-E hat den betroffenen Schritt bereits automatisch erneut versucht. Unvollständige Antworten werden nicht still als fertige Bewertung übernommen.",
      "Sichere den Zwischenstand und versuche es erneut. Nur fehlende oder noch nicht bestätigte Schritte werden wiederholt.",
    ],
    network: [
      "Die Verbindung zum KI-Dienst wurde unterbrochen.",
      "Mögliche Ursachen sind die Internetverbindung oder ein vorübergehend nicht erreichbarer Anbieter.",
      "Sichere den Zwischenstand, prüfe die Verbindung und versuche es erneut. Du musst die Arbeiten nicht neu hochladen.",
    ],
    cancelled: [
      "Die Korrektur ist pausiert.",
      "Fertige Schritte bleiben in diesem Fenster erhalten. Bereits gestartete Anbieteranfragen können noch Kosten verursachen.",
      "Du kannst hier fortsetzen oder den Zwischenstand herunterladen und später wieder laden.",
    ],
  };
  const [title, explanation, next] = help[kind] ??
    [
      "Die Korrektur konnte diesen Schritt nicht abschließen.",
      "Deine fertigen Zwischenergebnisse bleiben im offenen Fenster erhalten. Es wurde nichts still übersprungen.",
      "Lade zur Sicherheit den Zwischenstand herunter und klicke auf „Noch einmal versuchen“. Falls der Fehler bleibt, bewahre die Datei für die Fehlersuche auf.",
    ];
  return { kind, title, explanation, next };
}

export function gradingMoney(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(value);
}

export function roomBudgetState(
  room: NonNullable<GradingBudgetSnapshot["room"]>,
) {
  const remaining = Math.max(
    0,
    room.budgetUsd - room.spentUsd - room.reservedUsd,
  );
  const low = remaining <= Math.max(0.10, room.budgetUsd * 0.15);
  return {
    remaining,
    low,
    waiting: room.reservedUsd > 0 && low,
    exhausted: room.spentUsd >= room.budgetUsd,
  };
}

export async function classroomGradingBudget(
  slug: string,
  provider: boolean,
  signal: AbortSignal,
): Promise<GradingBudgetSnapshot> {
  const query = new URLSearchParams({
    action: "grading-status",
    slug,
    ...(provider ? { provider: "1" } : {}),
  });
  const response = await fetch(`/api/classroom?${query}`, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 401 || response.status === 403) {
    return {
      scope: "classroom",
      permission: "teacher-login-required",
      slug,
      authReason: response.status === 403 ? "different-room" : "missing",
      checkedAt: Date.now(),
    };
  }
  if (!response.ok) throw new Error("Budgetstand gerade nicht abrufbar.");
  return await response.json();
}

/** Same existing login, cookie protection and lockout as /my. No new session
 * mechanism and no password storage in chat/checkpoints/localStorage. */
export async function signInGradingTeacher(
  slug: string,
  password: string,
): Promise<void> {
  const response = await fetch("/api/classroom", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ action: "login", slug, password }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      data.error || "Anmeldung nicht möglich. Bitte erneut versuchen.",
    );
  }
}
