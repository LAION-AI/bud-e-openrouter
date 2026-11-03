import { useEffect, useRef, useState } from "preact/hooks";
import { GradingInfo } from "./GradingHelp.tsx";
import {
  type GradingBudgetLoader,
  type GradingBudgetSnapshot,
  gradingMoney,
  roomBudgetState,
  signInGradingTeacher,
} from "../utils/gradingFeedback.ts";

export default function GradingBudgetPanel(
  { load, busy, privateRoom, problem = "" }: {
    load?: GradingBudgetLoader;
    busy: boolean;
    privateRoom: boolean;
    problem?: string;
  },
) {
  const [value, setValue] = useState<GradingBudgetSnapshot | null>(null);
  const [loading, setLoading] = useState(!!load),
    [error, setError] = useState("");
  const [providerLoading, setProviderLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false),
    [signingIn, setSigningIn] = useState(false),
    [loginError, setLoginError] = useState("");
  const loader = useRef(load), request = useRef<AbortController | null>(null);
  const generation = useRef(0), alive = useRef(true);
  loader.current = load;
  async function refresh(provider: boolean) {
    if (!loader.current) return;
    request.current?.abort();
    const abort = new AbortController(), at = ++generation.current;
    const timeout = setTimeout(
      () =>
        abort.abort(
          new DOMException("Budgetabfrage dauert zu lange", "TimeoutError"),
        ),
      15000,
    );
    request.current = abort;
    setLoading(true);
    setError("");
    let localLoaded = false;
    try {
      // Never hold the local room budget hostage to a slow external provider.
      const local = await loader.current(false, abort.signal);
      const show = (next: GradingBudgetSnapshot) => {
        if (!alive.current || at !== generation.current) return;
        setValue((old) => ({
          ...next,
          balance: next.balance ??
            (old?.provider === next.provider ? old?.balance : undefined),
        }));
      };
      show(local);
      localLoaded = true;
      if (alive.current && at === generation.current) setLoading(false);
      if (provider && !local.permission && !abort.signal.aborted) {
        if (alive.current && at === generation.current) {
          setProviderLoading(true);
        }
        show(await loader.current(true, abort.signal));
      }
    } catch {
      if (
        alive.current && at === generation.current &&
        (!abort.signal.aborted || abort.signal.reason?.name === "TimeoutError")
      ) {
        setError(
          localLoaded
            ? "Das Raumbudget wurde geladen, aber die Anbieterabfrage ist gerade nicht erreichbar. Ältere Anbieterwerte können inzwischen überholt sein."
            : "Die Verbindung zur Budgetabfrage ist fehlgeschlagen. Klicke auf „Budget aktualisieren“. Deine Korrektur und Zwischenstände bleiben unverändert.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (at === generation.current) {
        request.current = null;
        if (alive.current) {
          setLoading(false);
          setProviderLoading(false);
        }
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh(true);
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (problem) void refresh(true);
  }, [problem]);
  useEffect(() => {
    if (!busy || !load || privateRoom) return;
    const timer = setInterval(() => {
      if (!request.current) {
        void refresh(false);
      }
    }, 20000);
    return () => clearInterval(timer);
  }, [busy, privateRoom, !!load]);
  useEffect(() => {
    const focused = () => {
      if (!request.current) void refresh(true);
    };
    globalThis.addEventListener("focus", focused);
    return () => globalThis.removeEventListener("focus", focused);
  }, []);
  async function login(event: SubmitEvent) {
    event.preventDefault();
    if (signingIn || !value?.slug) return;
    const form = event.currentTarget as HTMLFormElement;
    const password = String(new FormData(form).get("teacherPassword") ?? "");
    form.reset();
    setSigningIn(true);
    setLoginError("");
    try {
      await signInGradingTeacher(value.slug, password);
      if (alive.current) {
        setLoginOpen(false);
        await refresh(true);
      }
    } catch (cause) {
      if (alive.current) {
        setLoginError(
          cause instanceof Error && cause.name !== "TimeoutError"
            ? cause.message
            : "Die Anmeldung dauert zu lange. Bitte Internetverbindung prüfen und erneut versuchen.",
        );
      }
    } finally {
      if (alive.current) setSigningIn(false);
    }
  }
  const room = value?.room,
    state = room ? roomBudgetState(room) : null,
    balance = value?.balance;
  const providerLow = balance &&
    ((balance.accountAvailable &&
      typeof balance.remainingCredits === "number" &&
      balance.remainingCredits > 0 && balance.remainingCredits < 0.5) ||
      (balance.keyLimitRemaining !== null && balance.keyLimitRemaining > 0 &&
        balance.keyLimitRemaining <
          Math.max(0.1, (balance.keyLimit ?? 0) * 0.15)));
  return (
    <details
      class="my-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
      open
    >
      <summary class="cursor-pointer font-semibold text-slate-900">
        Kosten im Blick · Budget und Anbieterguthaben
      </summary>
      <p class="mt-2 text-xs leading-5 text-slate-600">
        Jeder KI-Schritt kann Geld kosten, auch automatische Wiederholungen und
        Zweitprüfungen. Ein ausreichender Betrag garantiert nicht, dass der
        ganze Stapel durchläuft. Es wird nie automatisch ein Budget erhöht oder
        Guthaben gekauft.
        <GradingInfo
          label="API-Key und Kosten"
          text="Ein API-Key ist ein geheimer Zugangscode zum KI-Anbieter. Darüber werden die Anfragen abgerechnet. Du nutzt hier den bereits hinterlegten Zugang. Schreibe den Key nie in den Auftrag. Der Anbieter ist der Dienst, der die KI-Rechenarbeit ausführt, zum Beispiel OpenRouter."
        />
      </p>
      {value?.permission && (
        <div class="mt-3 rounded-xl border border-indigo-200 bg-white p-4 text-sm text-slate-700">
          <h3 class="font-semibold text-slate-900">
            {value.authReason === "different-room"
              ? "Bitte für diesen Raum anmelden"
              : "Lehrkraft-Anmeldung fehlt oder ist abgelaufen"}
          </h3>
          <p class="mt-2">
            Du kannst den Klassenchat ohne Passwort nutzen. Budget und Guthaben
            sind dagegen nur für die Lehrkraft sichtbar. Das bedeutet nicht,
            dass dein Budget aufgebraucht ist.
          </p>
          {value.slug && (
            <button
              type="button"
              class="mt-3 rounded-xl bg-indigo-600 px-4 py-2 font-semibold text-white"
              onClick={() => setLoginOpen(!loginOpen)}
            >
              Als Lehrkraft Budget anzeigen
            </button>
          )}
          {loginOpen && value.slug && (
            <form onSubmit={login} class="mt-3 space-y-3">
              <p>
                Raum:{" "}
                <strong>{value.slug}</strong>. Verwende das Passwort, das du
                unter /my für diesen Raum festgelegt hast – nicht dein Passwort
                beim KI-Anbieter.
              </p>
              <label class="block font-semibold">
                Raum-Passwort<input
                  name="teacherPassword"
                  aria-label="Raum-Passwort für Budgetanzeige"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                  disabled={signingIn}
                  class="mt-1 block w-full rounded-xl border border-slate-300 p-3"
                />
              </label>
              <button
                type="submit"
                disabled={signingIn}
                class="rounded-xl bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {signingIn ? "Anmeldung läuft …" : "Anmelden und Budget laden"}
              </button>
              <p class="text-xs">
                Die laufende Korrektur wird nicht neu gestartet. Das Passwort
                wird nicht in der Sicherungsdatei gespeichert. An gemeinsam
                genutzten Rechnern nachher unter /my abmelden.
              </p>
            </form>
          )}
          {loginError && (
            <p role="status" class="mt-2 text-red-800">{loginError}</p>
          )}
          <p class="mt-3 text-xs">
            Alternativ kannst du{" "}
            <a
              class="underline"
              href="/my"
              target="_blank"
              rel="noopener noreferrer"
            >
              /my in einem zweiten Tab
            </a>{" "}
            öffnen und dich dort für diesen Raum anmelden. Bei der Rückkehr wird
            die Anzeige aktualisiert. Die Korrektur bleibt in diesem Tab.
          </p>
        </div>
      )}
      {!value?.permission && (
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div class="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <h3 class="font-semibold">
              {privateRoom ? "Privater Raum" : "1. Raumbudget"}
              <GradingInfo
                label={privateRoom ? "Privater Raum" : "Raumbudget"}
                text={privateRoom
                  ? "Dein fertiger Gesamtbericht wird im privaten Chat verschlüsselt gespeichert. Originale und Zwischenstände werden nicht automatisch mitgesichert. Die KI verarbeitet die dafür ausgewählten Inhalte bei deinem Anbieter. Lokale Downloads sind nicht verschlüsselt."
                  : "Das Raumbudget ist die zusätzliche Ausgabengrenze für alle Personen in diesem Klassenraum. Du stellst sie unter /my ein. Es ist kein Geld auf dem Anbieterkonto. Beide Grenzen müssen für eine Anfrage ausreichen."}
              />
            </h3>
            {privateRoom
              ? (
                <p class="mt-1 text-slate-600">
                  Hier gilt kein Klassenraum-Budget. Bezahlt wird direkt über
                  deinen hinterlegten Anbieter-Key; dessen Limits gelten
                  weiterhin.
                </p>
              )
              : room && state
              ? (
                <>
                  <p class="mt-2 text-lg font-bold">
                    {gradingMoney(state.remaining)} frei verfügbar
                  </p>
                  <p class="mt-1 text-xs text-slate-600">
                    Gesamtgrenze {gradingMoney(room.budgetUsd)} · verbraucht
                    {" "}
                    {gradingMoney(room.spentUsd)}{" "}
                    · für laufende Anfragen vorgemerkt{" "}
                    {gradingMoney(room.reservedUsd)}.
                  </p>
                  <p class="mt-1 text-xs text-slate-600">
                    Vorgemerkt bedeutet nicht bereits ausgegeben. Auch andere
                    Personen im Raum nutzen dieses Budget.
                  </p>
                  {!room.active && (
                    <p class="mt-2 font-semibold text-red-800">
                      {room.disabled || room.expiresAt <= Date.now()
                        ? "Raum geschlossen oder Freigabe abgelaufen. Bitte unter /my wieder freigeben."
                        : "Für den nächsten Schritt ist derzeit kein Budget frei."}
                    </p>
                  )}
                  {state.low && (
                    <p class="mt-2 font-semibold text-amber-900">
                      {state.exhausted
                        ? "Raumbudget aufgebraucht. Zwischenstand sichern und unter /my die Kostengrenze prüfen."
                        : state.waiting
                        ? "Wenig frei: Laufende Anfragen reservieren Budget. Bud-E wartet gegebenenfalls automatisch."
                        : "Nur wenig Raumbudget übrig. Sichere den Zwischenstand; der nächste Schritt könnte pausieren."}
                    </p>
                  )}
                </>
              )
              : (
                <p class="mt-2 text-slate-600">
                  {loading
                    ? "Raumbudget wird geprüft …"
                    : "Raumbudget konnte nicht geladen werden. Bitte „Budget aktualisieren“ anklicken; deine Korrektur bleibt erhalten."}
                </p>
              )}
          </div>
          <div class="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <h3 class="font-semibold">
              {privateRoom
                ? "Anbieterguthaben und Key-Limit"
                : "2. Anbieterguthaben und Key-Limit"}
              <GradingInfo
                label="Guthaben und Key-Limit"
                text="Guthaben ist Geld im Konto beim KI-Anbieter. Ein Key-Limit beschränkt, wie viel ein bestimmter Zugangscode ausgeben darf. Es ist kein zusätzliches Guthaben. Nicht abrufbar heißt unbekannt – weder 0 noch kostenlos noch unbegrenzt."
              />
            </h3>
            {balance
              ? (
                <>
                  <p class="mt-2">
                    Kontoguthaben:{" "}
                    <strong>
                      {balance.accountAvailable &&
                          typeof balance.remainingCredits === "number"
                        ? gradingMoney(balance.remainingCredits)
                        : "nicht abrufbar"}
                    </strong>
                  </p>
                  {!balance.accountAvailable && (
                    <p class="mt-1 text-xs text-slate-600">
                      {balance.requiresManagementKey
                        ? "Der hinterlegte Chat-Key darf das echte OpenRouter-Kontoguthaben nicht lesen. Prüfe es im Anbieterkonto. Ein Management-Key kann unter /my separat zur Abfrage verwendet werden; er wird hier nicht benötigt."
                        : "Der Anbieter hat keinen verlässlichen Kontostand geliefert. Bitte direkt im Anbieterkonto prüfen."}
                    </p>
                  )}
                  <p class="mt-2">
                    Key-Restlimit:{" "}
                    <strong>
                      {balance.keyLimitRemaining !== null
                        ? gradingMoney(balance.keyLimitRemaining)
                        : balance.keyLimitState === "unlimited"
                        ? "kein eigenes Key-Limit"
                        : "unbekannt"}
                    </strong>
                  </p>
                  <p class="mt-1 text-xs text-slate-600">
                    Das Key-Limit ist nur eine zusätzliche Ausgabengrenze, kein
                    Guthaben. Auch ohne Key-Limit braucht das Konto bei
                    Bezahlmodellen Guthaben.
                  </p>
                  {(balance.accountAvailable &&
                      typeof balance.remainingCredits === "number" &&
                      balance.remainingCredits <= 0 ||
                    balance.keyLimitRemaining !== null &&
                      balance.keyLimitRemaining <= 0) && (
                    <p class="mt-2 font-semibold text-red-800">
                      Anbieterguthaben oder Key-Limit ist aufgebraucht. Beim
                      Anbieter prüfen – ein höheres Raumbudget allein hilft
                      nicht.
                    </p>
                  )}
                  {providerLow && (
                    <p class="mt-2 font-semibold text-amber-900">
                      Wenig Guthaben oder Key-Spielraum übrig. Sichere den
                      Zwischenstand und prüfe beim Anbieter, ob der Rest für
                      weitere Anfragen reicht.
                    </p>
                  )}
                  <p class="mt-2 text-xs text-slate-500">
                    Anbieterstand:{" "}
                    {new Date(balance.checkedAt).toLocaleTimeString("de-DE")}.
                    Keine Echtzeit-Garantie.
                  </p>
                </>
              )
              : (
                <p class="mt-2 text-slate-600">
                  {loading || providerLoading
                    ? "Anbieterstand wird geprüft …"
                    : value?.provider && value.provider !== "openrouter"
                    ? "Für diesen Anbieter ist hier keine verlässliche Guthabenabfrage verfügbar. Prüfe Guthaben, Abrechnung und Kontingente direkt im Anbieterkonto."
                    : "Anbieterguthaben konnte nicht geladen werden. Bitte „Budget aktualisieren“ anklicken oder direkt im Anbieterkonto prüfen. Der tatsächliche Betrag ist unbekannt."}
                </p>
              )}
          </div>
        </div>
      )}
      <div class="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          disabled={loading || providerLoading || !load}
          onClick={() => void refresh(true)}
          class="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold disabled:opacity-50"
        >
          {loading || providerLoading
            ? "Budget wird geprüft …"
            : "Budget aktualisieren"}
        </button>
        {!privateRoom && (
          <a
            class="underline"
            href="/my"
            target="_blank"
            rel="noopener noreferrer"
          >
            Raumeinstellungen in neuem Tab öffnen ↗
          </a>
        )}
        <span>Die Abfrage startet keine Korrektur und kauft nichts.</span>
      </div>
      {error && <p class="mt-2 text-xs text-amber-900">{error}</p>}
    </details>
  );
}
