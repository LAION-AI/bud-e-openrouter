import { useEffect, useRef, useState } from "preact/hooks";
import {
  type GradingBudgetLoader,
  type GradingBudgetSnapshot,
  gradingMoney,
  roomBudgetState,
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
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
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
    try {
      const next = await loader.current(provider, abort.signal);
      if (alive.current && at === generation.current) {
        setValue((old) => ({
          ...next,
          balance: next.balance ??
            (old?.provider === next.provider ? old?.balance : undefined),
        }));
        setError("");
      }
    } catch {
      if (
        alive.current && at === generation.current &&
        (!abort.signal.aborted || abort.signal.reason?.name === "TimeoutError")
      ) {
        setError(
          "Budgetabfrage nicht erreichbar. Angezeigte ältere Werte sind keine Zusage, dass die nächste Anfrage bezahlt werden kann.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (at === generation.current) {
        request.current = null;
        if (alive.current) setLoading(false);
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
      </p>
      {value?.permission && (
        <p class="mt-3 text-sm text-amber-900">
          Genaue Budgetwerte sind nur für die angemeldete Lehrkraft sichtbar.
          Öffne{" "}
          <a
            class="underline"
            href="/my"
            target="_blank"
            rel="noopener noreferrer"
          >
            /my in einem zweiten Tab
          </a>{" "}
          und melde dich für diesen Raum an. Danach hier „Budget aktualisieren“
          klicken. Die Korrektur bleibt in diesem Tab.
        </p>
      )}
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div class="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <h3 class="font-semibold">
            {privateRoom ? "Privater Raum" : "1. Raumbudget"}
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
                  Gesamtgrenze {gradingMoney(room.budgetUsd)} · verbraucht{" "}
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
                  : "Raumbudget nicht abrufbar – nicht mit 0 oder unbegrenzt gleichsetzen."}
              </p>
            )}
        </div>
        <div class="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <h3 class="font-semibold">
            {privateRoom
              ? "Anbieterguthaben und Key-Limit"
              : "2. Anbieterguthaben und Key-Limit"}
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
                    Anbieter prüfen – ein höheres Raumbudget allein hilft nicht.
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
                {loading
                  ? "Anbieterstand wird geprüft …"
                  : value?.provider && value.provider !== "openrouter"
                  ? "Für diesen Anbieter ist hier keine verlässliche Guthabenabfrage verfügbar. Prüfe Guthaben, Abrechnung und Kontingente direkt im Anbieterkonto."
                  : "Anbieterguthaben nicht abrufbar. Bitte direkt im Anbieterkonto prüfen; unbekannt bedeutet nicht kostenlos oder unbegrenzt."}
              </p>
            )}
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          disabled={loading || !load}
          onClick={() => void refresh(true)}
          class="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold disabled:opacity-50"
        >
          {loading ? "Budget wird geprüft …" : "Budget aktualisieren"}
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
