import { useEffect, useState } from "preact/hooks";
import type { ClassroomConfig, Feature } from "../utils/classroomStore.ts";
import {
  CLASSROOM_DURATIONS,
  MAX_CLASSROOM_DURATION_MS,
} from "../utils/classroomTiming.ts";

type Model = {
  id: string;
  name: string;
  roles: Feature[];
  zdr: boolean;
  eu: boolean;
  free: boolean;
  priceNote: string;
  vision: boolean;
  checkStatus: "ok" | "error" | "unknown";
  checkedAt: number;
};
type Voice = {
  id: string;
  name: string;
  language: string;
  description: string;
};
type Feedback = {
  title: string;
  message: string;
  kind: "success" | "error" | "info";
};
type CreditResult = {
  accountAvailable: boolean;
  totalCredits?: number;
  totalUsage?: number;
  remainingCredits?: number;
  keyLimitRemaining: number | null;
  keyLimit: number | null;
};
type AdminState = {
  slug: string;
  provider: string;
  keyHint: string;
  models: Record<Feature, string>;
  enabled: Record<Feature, boolean>;
  ttsVoice: string;
  ttsStyle: string;
  budgetUsd: number;
  spentUsd: number;
  active: boolean;
  reason: "active" | "closed" | "expired" | "budget" | "model";
  expiresAt: number;
  disabled: boolean;
};
const features: Array<{ id: Feature; label: string; description: string }> = [
  {
    id: "chat",
    label: "Sprache & Bilder verstehen",
    description: "Das Standardmodell für den Klassenchat.",
  },
  {
    id: "tts",
    label: "Vorlesen (TTS)",
    description: "Antworten als Sprache ausgeben.",
  },
  {
    id: "asr",
    label: "Sprache erkennen (ASR)",
    description: "Gesprochene Fragen in Text umwandeln.",
  },
  {
    id: "image",
    label: "Bilder erzeugen",
    description: "Bilder aus Beschreibungen erstellen.",
  },
  {
    id: "music",
    label: "Musik erzeugen",
    description: "Musik aus einer Beschreibung erstellen.",
  },
];
const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const buttonClass =
  "rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";

async function api(action: string, data: Record<string, unknown> = {}) {
  const response = await fetch("/api/classroom", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Die Anfrage ist fehlgeschlagen.");
  }
  return result;
}

function category(model: Model): string {
  if (model.zdr && model.eu) return "EU + Zero Data Retention";
  if (model.zdr) return "Zero Data Retention";
  if (model.free) return "Kostenlos";
  return "Weitere Modelle";
}

function chatPriority(model: Model): number {
  const id = model.id.toLowerCase();
  if (/^openai\/gpt-6-.*(?:luna|sol|terra)/.test(id)) return 0;
  if (/^openai\/gpt-5(?:\.|-)/.test(id)) return 1;
  if (/^google\/gemini-.*flash/.test(id)) return 2;
  if (id.startsWith("google/gemini-")) return 3;
  if (id.startsWith("openai/")) return 4;
  return 5;
}

function geminiVersion(model: Model): [number, number] | null {
  const match = model.id.match(/(?:^|\/)gemini-(\d+)(?:\.(\d+))?/i);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : null;
}

function newestGeminiFirst(a: Model, b: Model): number {
  const left = geminiVersion(a);
  const right = geminiVersion(b);
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return right[0] - left[0] || right[1] - left[1];
}

export default function ClassroomAdmin({ brand }: { brand: string }) {
  const [me, setMe] = useState<AdminState | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [onlyFree, setOnlyFree] = useState(false);
  const [onlyWorkingFree, setOnlyWorkingFree] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [slug, setSlug] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [providerChoice, setProviderChoice] = useState<
    "openrouter" | "requesty" | "google"
  >("openrouter");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voicePage, setVoicePage] = useState("");
  const [budget, setBudget] = useState("1.00");
  const [duration, setDuration] = useState(120);
  const [timeMode, setTimeMode] = useState<"duration" | "end">("duration");
  const [endTime, setEndTime] = useState("");
  const [config, setConfig] = useState<ClassroomConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [creditResult, setCreditResult] = useState<CreditResult | null>(null);
  const [managementKey, setManagementKey] = useState("");
  const [asrTestFile, setAsrTestFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const response = await fetch("/api/classroom?action=me", {
      credentials: "same-origin",
    });
    if (!response.ok) {
      setMe(null);
      setReady(true);
      return;
    }
    const account: AdminState = await response.json();
    setMe(account);
    setCreditResult(null);
    setManagementKey("");
    setProviderChoice(
      account.provider === "requesty"
        ? "requesty"
        : account.provider === "google"
        ? "google"
        : "openrouter",
    );
    setBudget(account.budgetUsd.toFixed(2));
    setConfig({
      models: account.models,
      enabled: account.enabled,
      ttsVoice: account.ttsVoice,
      ttsStyle: account.ttsStyle,
    });
    setModels([]);
    const catalog = await fetch("/api/classroom?action=models", {
      credentials: "same-origin",
    });
    if (catalog.ok) setModels((await catalog.json()).models);
    if (account.provider === "google") {
      await loadVoices("", "", false).catch(() => setVoices([]));
    } else {
      setVoices([]);
      setVoicePage("");
    }
    setReady(true);
  }

  async function loadVoices(search: string, pageToken = "", append = false) {
    const query = new URLSearchParams({ action: "voices", search });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`/api/classroom?${query}`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error("Die Google-Stimmen sind gerade nicht erreichbar.");
    }
    const data = await response.json();
    setVoices((old) => append ? [...old, ...data.voices] : data.voices);
    setVoicePage(data.nextPageToken || "");
  }
  async function refreshTestStatus() {
    const [account, catalog] = await Promise.all([
      fetch("/api/classroom?action=me", { credentials: "same-origin" }),
      fetch("/api/classroom?action=models", { credentials: "same-origin" }),
    ]);
    if (account.ok) setMe(await account.json());
    if (catalog.ok) setModels((await catalog.json()).models);
  }
  useEffect(() => {
    refresh().catch(() => {
      setError("Verbindung fehlgeschlagen.");
      setReady(true);
    });
  }, []);
  useEffect(() => {
    const updateAvailability = async () => {
      try {
        const response = await fetch("/api/classroom?action=me", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.ok) setMe(await response.json());
      } catch {
        // Keep the last confirmed state until the connection returns.
      }
    };
    const timer = globalThis.setInterval(() => void updateAvailability(), 30_000);
    const onVisible = () => {
      if (globalThis.document.visibilityState === "visible") {
        void updateAvailability();
      }
    };
    globalThis.document.addEventListener("visibilitychange", onVisible);
    return () => {
      globalThis.clearInterval(timer);
      globalThis.document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function run(task: () => Promise<void>, showErrorDialog = false) {
    setBusy(true);
    setError("");
    setNotice("");
    if (showErrorDialog) setFeedback(null);
    try {
      await task();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Fehler.";
      setError(message);
      if (showErrorDialog) {
        setFeedback({
          title: "Anfrage fehlgeschlagen",
          message,
          kind: "error",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitAccount(e: Event) {
    e.preventDefault();
    await run(async () => {
      await api(mode, {
        slug: slug.toLowerCase().trim(),
        password,
        ...(mode === "register"
          ? { key: key.trim(), provider: providerChoice }
          : {}),
      });
      setPassword("");
      setKey("");
      await refresh();
    });
  }

  async function save() {
    if (!config) return;
    await run(async () => {
      await api("save", { config, budgetUsd: Number(budget) });
      await refresh();
      setNotice("Einstellungen gespeichert.");
    });
  }

  async function activate() {
    if (!me) return;
    if (
      config &&
      (JSON.stringify(config.models) !== JSON.stringify(me.models) ||
        JSON.stringify(config.enabled) !== JSON.stringify(me.enabled) ||
        config.ttsVoice !== me.ttsVoice || config.ttsStyle !== me.ttsStyle ||
        Number(budget) !== me.budgetUsd)
    ) {
      setError("Bitte die Änderungen zuerst speichern, dann freigeben.");
      return;
    }
    const until = timeMode === "end" ? new Date(endTime).getTime() : undefined;
    if (timeMode === "end" && (!endTime || until === undefined ||
      !Number.isFinite(until) || until < Date.now() + 5 * 60_000 ||
      until > Date.now() + MAX_CLASSROOM_DURATION_MS)) {
      setFeedback({
        title: "Abschaltzeitpunkt prüfen",
        message: "Wähle einen Zeitpunkt zwischen fünf Minuten und 30 Tagen ab jetzt.",
        kind: "error",
      });
      return;
    }
    const text = until !== undefined
      ? `bis ${new Date(until).toLocaleString("de-DE")}`
      : `für ${CLASSROOM_DURATIONS.find((x) => x.minutes === duration)?.label ?? `${duration} Minuten`}`;
    if (
      !confirm(
        `Wirklich ${text} freigeben? Jeder mit dem Link kann in dieser Zeit auf deinen API-Key chatten. Bei einem Bezahlkonto entstehen Kosten.`,
      )
    ) return;
    await run(async () => {
      const result = await api(
        "activate",
        timeMode === "end" ? { expiresAt: until } : { minutes: duration },
      );
      if (!result.state?.active) {
        throw new Error("Die Freigabe wurde nicht aktiv. Bitte erneut prüfen.");
      }
      const response = await fetch(
        `/api/classroom?action=public&slug=${encodeURIComponent(me.slug)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error("Der Schülerlink konnte nicht geprüft werden.");
      }
      const studentState = await response.json();
      if (!studentState.active ||
        studentState.expiresAt !== result.state.expiresAt) {
        throw new Error(
          "Der Schülerlink meldet den Raum noch als geschlossen. Bitte Seite neu laden oder die Lehrkraft-Ansicht prüfen.",
        );
      }
      setMe(result.state);
      setFeedback({
        title: "Klassenchat ist offen",
        message: `Der Schülerlink wurde geprüft. Freigegeben bis ${new Date(result.state.expiresAt).toLocaleString("de-DE")}.`,
        kind: "success",
      });
    }, true);
  }

  function changeModel(feature: Feature, id: string) {
    if (!config) return;
    setConfig({ ...config, models: { ...config.models, [feature]: id } });
  }

  async function testChat() {
    if (!config?.models.chat) return;
    const selected = config.models.chat;
    await run(async () => {
      const result = await api("test", { model: selected });
      await refreshTestStatus().catch(() => {});
      setCreditResult(null);
      setFeedback({
        title: "Chatmodell funktioniert",
        message: `${selected}: ${result.reply}`,
        kind: "success",
      });
    }, true);
  }

  async function scanFreeModels() {
    await run(async () => {
      const result = await api("scan-free") as {
        tested: number;
        working: number;
        remaining: number;
        results: Array<{ model: string; ok: boolean; error?: string }>;
      };
      await refreshTestStatus();
      setFeedback({
        title: result.tested
          ? "Kostenlose Modelle geprüft"
          : "Keine neuen Modelle zu prüfen",
        message: result.tested
          ? `${result.working} von ${result.tested} Modellen haben geantwortet. ${result.remaining} weitere sind noch ungetestet. Fehlversuche können an Anbieter-Limits liegen; ein grüner Test gilt nur für den Testzeitpunkt.\n\n${
            result.results.map((r) =>
              `${r.ok ? "✓" : "✗"} ${r.model}${r.error ? ` – ${r.error}` : ""}`
            ).join("\n")
          }`
          : "Alle kostenlosen Chatmodelle wurden in den letzten 24 Stunden bereits geprüft.",
        kind: result.working ? "success" : "info",
      });
    }, true);
  }

  async function testMedia(feature: Feature, file?: File) {
    if (!me || !config || feature === "chat") return;
    if (feature === "music" || feature === "image") {
      if (
        !confirm(
          `Dieser Test erzeugt wirklich ${
            feature === "music" ? "Musik" : "ein Bild"
          } und kann Geld kosten. Fortfahren?`,
        )
      ) return;
    }
    await run(async () => {
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      if (feature === "asr") {
        if (!file) {
          throw new Error(
            "Bitte eine kurze Audiodatei für den Test auswählen.",
          );
        }
        const form = new FormData();
        form.set("kind", feature);
        form.set("slug", me.slug);
        form.set("adminTest", "true");
        form.set("model", config.models.asr);
        form.set("audio", file);
        body = form;
      } else {
        const text = feature === "tts"
          ? "Hallo, die Verbindung funktioniert."
          : feature === "image"
          ? "Ein kleiner grüner Kreis auf weißem Hintergrund."
          : "Ein kurzer freundlicher Instrumental-Test mit Klavier.";
        body = JSON.stringify({
          kind: feature,
          slug: me.slug,
          adminTest: true,
          model: config.models[feature],
          ...(feature === "tts"
            ? { ttsVoice: config.ttsVoice, ttsStyle: config.ttsStyle }
            : {}),
          text,
        });
        headers = { "Content-Type": "application/json" };
      }
      const response = await fetch("/api/classroom-media", {
        method: "POST",
        body,
        headers,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Test fehlgeschlagen.");
      await refreshTestStatus().catch(() => {});
      setCreditResult(null);
      setFeedback({
        title: `${
          features.find((item) => item.id === feature)?.label
        } funktioniert`,
        message:
          `Modell: ${result.model}. Auf den lokalen Ausgabenrahmen angerechnet: $${
            Number(result.accountedUsd).toFixed(4)
          }.`,
        kind: "success",
      });
    }, true);
  }

  async function checkCredits() {
    await run(async () => {
      const result = await api("balance", {
        ...(managementKey.trim()
          ? { managementKey: managementKey.trim() }
          : {}),
      }) as CreditResult;
      setCreditResult(result);
      setManagementKey("");
      const limitText = result.keyLimitRemaining === null
        ? "Für den Chat-Key ist kein eigenes Ausgabenlimit gesetzt."
        : `Verbleibendes Chat-Key-Limit: $${
          result.keyLimitRemaining.toFixed(2)
        }.`;
      setFeedback(
        result.accountAvailable
          ? {
            title: "OpenRouter-Kontoguthaben",
            message: `Tatsächlich verbleibend: $${
              result.remainingCredits!.toFixed(2)
            }. Gesamtgutschriften: $${
              result.totalCredits!.toFixed(2)
            }; bisher verbraucht: $${
              result.totalUsage!.toFixed(2)
            }. ${limitText}`,
            kind: "success",
          }
          : {
            title: "Kontoguthaben nicht abrufbar",
            message:
              `Der Chat-Key darf das OpenRouter-Kontoguthaben nicht abfragen. ${limitText} Das Key-Limit ist nicht dein Kontoguthaben. Für den tatsächlichen Restbetrag kannst du unten einmalig einen OpenRouter-Management-Key eingeben. Er wird nicht gespeichert.`,
            kind: "info",
          },
      );
    }, true);
  }

  if (!ready) {
    return (
      <div class="py-20 text-center text-slate-500">
        Lade deinen Klassenraum …
      </div>
    );
  }
  if (!me || !config) {
    return (
      <div class="mx-auto max-w-xl rounded-3xl border border-indigo-100 bg-white/95 p-6 shadow-xl sm:p-10">
        <div class="mb-7 rounded-2xl bg-indigo-50 p-5">
          <img
            src="/logo.png"
            width="64"
            height="64"
            alt=""
            class="mb-2 h-16 w-16"
          />
          <p class="text-sm font-bold uppercase tracking-widest text-indigo-600">
            Dein Klassenraum
          </p>
          <h1 class="mt-2 text-3xl font-bold text-slate-900">
            Ein Link für deine Stunde.
          </h1>
          <p class="mt-3 text-slate-600">
            Wähle ein Pseudonym, hinterlege deinen eigenen API-Key und
            entscheide, wann die Klasse mit {brand} chatten darf.
          </p>
        </div>
        <div class="mb-5 flex gap-2" role="tablist">
          <button
            type="button"
            class={`rounded-xl px-4 py-2 ${
              mode === "register"
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
            onClick={() => setMode("register")}
          >
            Neu anlegen
          </button>
          <button
            type="button"
            class={`rounded-xl px-4 py-2 ${
              mode === "login"
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
            onClick={() => setMode("login")}
          >
            Wieder einloggen
          </button>
        </div>
        <form class="space-y-4" onSubmit={submitAccount}>
          <label class="block text-sm font-semibold text-slate-700">
            Pseudonym
            <input
              class={`${inputClass} mt-1`}
              value={slug}
              onInput={(e) => setSlug(e.currentTarget.value.toLowerCase())}
              autoComplete="username"
              placeholder="schuhmann"
              required
            />
            <span class="mt-1 block text-xs font-normal text-slate-500">
              3–24 Zeichen, nur a–z und 0–9. Der Name wird Teil des Links.
            </span>
          </label>
          <label class="block text-sm font-semibold text-slate-700">
            Passwort
            <input
              type="password"
              class={`${inputClass} mt-1`}
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autoComplete={mode === "register"
                ? "new-password"
                : "current-password"}
              required
            />
            {mode === "register" && (
              <span class="mt-1 block text-xs font-normal text-slate-500">
                Mindestens 12 Zeichen: klein, GROSS, Zahl und Sonderzeichen.
              </span>
            )}
          </label>
          {mode === "register" && (
            <label class="block text-sm font-semibold text-slate-700">
              Anbieter und API-Key
              <select
                class={`${inputClass} mt-1`}
                value={providerChoice}
                onChange={(e) =>
                  setProviderChoice(
                    e.currentTarget.value as
                      | "openrouter"
                      | "requesty"
                      | "google",
                  )}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="requesty">Requesty</option>
                <option value="google">Google AI Studio / Gemini</option>
              </select>
              <input
                type="password"
                class={`${inputClass} mt-1`}
                value={key}
                onInput={(e) => setKey(e.currentTarget.value)}
                autoComplete="off"
                required
              />
              <span class="mt-1 block text-xs font-normal text-slate-500">
                Der Schlüssel wird verschlüsselt auf dem Server gespeichert und
                nie an Schüler-Browser gesendet. Verwende möglichst einen
                eigenen Key mit Anbieter-seitigem Ausgabenlimit.
              </span>
            </label>
          )}
          {error && (
            <p role="alert" class="rounded-xl bg-red-50 p-3 text-red-700">
              {error}
            </p>
          )}
          <button type="submit" class={buttonClass} disabled={busy}>
            {busy
              ? "Bitte warten …"
              : mode === "register"
              ? "Klassenraum anlegen"
              : "Einloggen"}
          </button>
        </form>
      </div>
    );
  }

  const classroomUrl = `${
    globalThis.location?.origin ?? "https://bud-e.ai"
  }/${me.slug}`;
  const remaining = Math.max(0, me.budgetUsd - me.spentUsd);
  return (
    <div class="mx-auto max-w-5xl space-y-6 pb-16">
      <div class="rounded-3xl bg-white/95 p-6 shadow-xl sm:p-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-sm font-bold uppercase tracking-widest text-indigo-600">
              Klassenraum · {me.provider}
            </p>
            <h1 class="mt-1 text-3xl font-bold text-slate-900">{me.slug}</h1>
            <p class="mt-2 text-slate-600">
              API-Key {me.keyHint}{" "}
              · Der vollständige Schlüssel wird nicht angezeigt.
            </p>
          </div>
          <button
            type="button"
            class="rounded-xl border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50"
            onClick={() =>
              run(async () => {
                await api("logout");
                setMe(null);
                setConfig(null);
              })}
          >
            Abmelden
          </button>
        </div>
        <div class="mt-6 rounded-2xl bg-indigo-50 p-5">
          <p class="font-semibold text-indigo-900">Link für deine Klasse</p>
          <a href={classroomUrl} class="break-all text-indigo-700 underline">
            {classroomUrl}
          </a>
          <p class="mt-2 text-sm text-indigo-800">
            {me.active
              ? `Freigegeben bis ${
                new Date(me.expiresAt).toLocaleString("de-DE")
              }. Der Raum bleibt bis dahin offen, sofern du ihn nicht schließt oder der Ausgabenrahmen erreicht wird.`
              : me.reason === "budget"
              ? "Der Ausgabenrahmen ist erreicht. Erhöhe ihn und gib den Raum erneut frei."
              : me.reason === "expired"
              ? "Die Freigabe ist abgelaufen. Wähle eine neue Zeit und gib den Raum erneut frei."
              : me.reason === "model"
              ? "Der Chat ist nicht nutzbar: Bitte ein Chatmodell auswählen, speichern und erneut freigeben."
              : "Der Chat ist gerade geschlossen. Wähle unten eine Zeit und gib ihn frei."}
          </p>
        </div>
      </div>

      <div class="grid gap-6 md:grid-cols-2">
        <section class="rounded-3xl bg-white/95 p-6 shadow-lg">
          <h2 class="text-xl font-bold text-slate-900">
            Zeit & Ausgabenrahmen
          </h2>
          <p class="mt-2 text-sm text-slate-600">
            Der lokale Rahmen ist eine zusätzliche Bremse, kein garantierter
            Kostendeckel. Setze auch beim Anbieter ein Limit für diesen Key.
          </p>
          <label class="mt-5 block text-sm font-semibold text-slate-700">
            Maximaler Rahmen in US-Dollar
            <input
              type="number"
              min="0"
              max="10000"
              step="0.01"
              class={`${inputClass} mt-1`}
              value={budget}
              onInput={(e) => setBudget(e.currentTarget.value)}
            />
          </label>
          <p class="mt-2 text-sm text-slate-600">
            Erfasst: ${me.spentUsd.toFixed(4)}{" "}
            · verbleibend: höchstens ${remaining.toFixed(4)}
          </p>
          <fieldset class="mt-4">
            <legend class="text-sm font-semibold text-slate-700">
              Wie lange soll der Chat offen sein?
            </legend>
            <div class="mt-2 grid gap-2 sm:grid-cols-2">
              <label class={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${timeMode === "duration" ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-300 bg-white text-slate-700"}`}>
                <input
                  type="radio"
                  name="classroom-time-mode"
                  checked={timeMode === "duration"}
                  onChange={() => setTimeMode("duration")}
                  class="h-4 w-4 accent-indigo-600"
                />
                Dauer ab jetzt
              </label>
              <label class={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${timeMode === "end" ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-300 bg-white text-slate-700"}`}>
                <input
                  type="radio"
                  name="classroom-time-mode"
                  checked={timeMode === "end"}
                  onChange={() => setTimeMode("end")}
                  class="h-4 w-4 accent-indigo-600"
                />
                Bis zu einem Datum
              </label>
            </div>
          </fieldset>
          {timeMode === "duration"
            ? (
              <label class="mt-4 block text-sm font-semibold text-slate-700">
                Gewünschte Dauer
                <select
                  class={`${inputClass} mt-1`}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.currentTarget.value))}
                >
                  {CLASSROOM_DURATIONS.map((option) => (
                    <option key={option.minutes} value={option.minutes}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )
            : (
              <label class="mt-4 block text-sm font-semibold text-slate-700">
                Genauer Abschaltzeitpunkt
                <input
                  type="datetime-local"
                  class={`${inputClass} mt-1`}
                  value={endTime}
                  onInput={(e) => setEndTime(e.currentTarget.value)}
                />
                <span class="mt-1 block text-xs font-normal text-slate-500">
                  Ortszeit deines Geräts, mindestens fünf Minuten und höchstens 30 Tage ab jetzt.
                </span>
              </label>
            )}
          <div class="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              class={buttonClass}
              disabled={busy}
              onClick={save}
            >
              Einstellungen speichern
            </button>
            <button
              type="button"
              class="rounded-xl border border-green-600 px-4 py-2 font-semibold text-green-700 hover:bg-green-50"
              disabled={busy}
              onClick={activate}
            >
              Für gewählte Zeit freigeben
            </button>
            <button
              type="button"
              class="rounded-xl border border-red-300 px-4 py-2 font-semibold text-red-700 hover:bg-red-50"
              disabled={busy || me.disabled}
              onClick={() =>
                run(async () => {
                  await api("deactivate");
                  await refresh();
                  setNotice("Klassenchat geschlossen.");
                })}
            >
              Sofort schließen
            </button>
          </div>
        </section>
        <section class="rounded-3xl bg-white/95 p-6 shadow-lg">
          <h2 class="text-xl font-bold text-slate-900">Verbindung prüfen</h2>
          <p class="mt-2 text-sm text-slate-600">
            Der Test stellt eine echte kurze Modellanfrage. Sie kann geringe
            Kosten verursachen und wird auf den lokalen Rahmen angerechnet.
          </p>
          <button
            type="button"
            class={`${buttonClass} mt-5`}
            disabled={busy || !config.models.chat}
            onClick={testChat}
          >
            Ausgewähltes Chatmodell testen
          </button>
          {me.provider === "openrouter" && (
            <div class="mt-4 space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
              <p class="text-sm text-indigo-900">
                Kontoguthaben und Key-Limit sind zwei verschiedene Werte. Das
                Kontoguthaben benötigt bei OpenRouter einen Management-Key.
              </p>
              <label class="block text-sm font-semibold text-slate-700">
                Management-Key für einmalige Guthabenabfrage (optional)
                <input
                  type="password"
                  class={`${inputClass} mt-1`}
                  value={managementKey}
                  onInput={(e) => setManagementKey(e.currentTarget.value)}
                  autoComplete="off"
                  placeholder="Leer lassen, um nur mit dem Chat-Key zu prüfen"
                />
                <span class="mt-1 block text-xs font-normal text-slate-600">
                  Wird nur für diese Abfrage übertragen, nicht gespeichert und
                  nicht für den Klassenchat verwendet.
                </span>
              </label>
              <button
                type="button"
                class="text-sm font-semibold text-indigo-700 underline disabled:opacity-50"
                disabled={busy}
                onClick={checkCredits}
              >
                OpenRouter-Guthaben abfragen
              </button>
              {creditResult && (
                <p class="text-sm text-slate-700">
                  {creditResult.accountAvailable
                    ? `Kontoguthaben: $${
                      creditResult.remainingCredits!.toFixed(2)
                    }`
                    : "Kontoguthaben mit diesem Key nicht abrufbar"}
                  {creditResult.keyLimitRemaining !== null
                    ? ` · Key-Limit: $${
                      creditResult.keyLimitRemaining.toFixed(2)
                    }`
                    : " · kein eigenes Key-Limit"}
                </p>
              )}
            </div>
          )}
          <label class="mt-6 block text-sm font-semibold text-slate-700">
            API-Key ersetzen
            <select
              class={`${inputClass} mt-1`}
              value={providerChoice}
              onChange={(e) =>
                setProviderChoice(
                  e.currentTarget.value as "openrouter" | "requesty" | "google",
                )}
            >
              <option value="openrouter">OpenRouter</option>
              <option value="requesty">Requesty</option>
              <option value="google">Google AI Studio / Gemini</option>
            </select>
            <input
              type="password"
              class={`${inputClass} mt-1`}
              value={key}
              onInput={(e) => setKey(e.currentTarget.value)}
              autoComplete="off"
              placeholder="Neuen Key einfügen"
            />
          </label>
          <button
            type="button"
            class="mt-3 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50"
            disabled={busy || !key}
            onClick={() =>
              run(async () => {
                if (
                  !confirm(
                    "Key wirklich ersetzen? Der Klassenchat wird geschlossen und die Modellauswahl zurückgesetzt.",
                  )
                ) return;
                await api("replace-key", {
                  key: key.trim(),
                  provider: providerChoice,
                });
                setKey("");
                await refresh();
                setFeedback({
                  title: "Key ersetzt – Raum geschlossen",
                  message: "Nach einem Key-Wechsel musst du ein Chatmodell wählen, speichern und den Raum erneut freigeben. Der bisherige Schülerlink bleibt gleich.",
                  kind: "info",
                });
              }, true)}
          >
            Key ersetzen
          </button>
        </section>
      </div>

      <section class="rounded-3xl bg-white/95 p-6 shadow-lg sm:p-8">
        <h2 class="text-2xl font-bold text-slate-900">Modelle & Freigaben</h2>
        <p class="mt-2 text-slate-600">
          Diese Liste zeigt Modelle aus dem Anbieter-Katalog. Erst ein
          erfolgreicher Test bestätigt, dass dein Key das gewählte Modell
          wirklich nutzen kann. Angezeigte Preise sind Modellpreise, keine
          Garantie für den Endbetrag.
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <label class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={onlyFree}
              onChange={(e) => setOnlyFree(e.currentTarget.checked)}
            />
            Nur kostenlose Modelle anzeigen
          </label>
          {me.provider === "openrouter" && (
            <>
              <label class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={onlyWorkingFree}
                  onChange={(e) => setOnlyWorkingFree(e.currentTarget.checked)}
                />
                Nur erfolgreich getestete kostenlose Modelle
              </label>
              <button
                type="button"
                class="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                disabled={busy}
                onClick={scanFreeModels}
              >
                Kostenlose Modelle prüfen (max. 6)
              </button>
            </>
          )}
        </div>
        {me.provider === "openrouter" && (
          <p class="mt-2 text-xs text-slate-600">
            Die Prüfung sendet kurze echte Anfragen an höchstens sechs neue
            Modelle, höchstens einmal pro 30 Minuten. Das verbraucht einen Teil
            des kostenlosen Anfragekontingents. Der Status gilt 24 Stunden und
            garantiert nicht, dass das Modell später noch erreichbar ist.
          </p>
        )}
        {onlyFree && me.provider === "google" && (
          <div class="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Google liefert über die Modell-API keinen verlässlichen
              Kostenlos-Status. Deshalb zeigt dieser Filter bei Google zunächst
              keine Modelle – unbekannt bedeutet nicht kostenlos. Prüfe den
              <a
                href="https://ai.google.dev/gemini-api/docs/pricing"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
              >
                Free Tier und Preise
              </a>{" "}
              sowie deine Abrechnung in AI Studio, bevor du ein Modell
              freigibst.
            </p>
            <button
              type="button"
              class="mt-2 font-semibold text-indigo-700 underline"
              onClick={() => setOnlyFree(false)}
            >
              Google-Modelle mit unbekanntem Preisstatus anzeigen
            </button>
          </div>
        )}
        {features.map(({ id, label, description }) => {
          const available = models.filter((m) => m.roles.includes(id));
          const visible = onlyWorkingFree
            ? available.filter((m) => m.free && m.checkStatus === "ok")
            : onlyFree
            ? available.filter((m) => m.free)
            : available;
          return (
            <div key={id} class="mt-7 border-t border-slate-200 pt-6">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 class="text-lg font-bold text-slate-900">{label}</h3>
                  <p class="text-sm text-slate-600">{description}</p>
                </div>
                {id !== "chat" && (
                  <label class="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={config.enabled[id]}
                      disabled={!config.models[id] || !available.length}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          enabled: {
                            ...config.enabled,
                            [id]: e.currentTarget.checked,
                          },
                        })}
                    />{" "}
                    Freigeben
                  </label>
                )}
              </div>
              {id !== "chat" && (
                <p class="mt-3 text-sm text-slate-600">
                  Standardmäßig aus. Wähle erst ein Modell, speichere und
                  aktiviere diese Funktion bewusst. Medienanfragen werden aus
                  dem lokalen Rahmen vorsichtig pauschal angerechnet.
                </p>
              )}
              {!visible.length
                ? (
                  <p class="mt-4 text-sm text-slate-500">
                    {onlyWorkingFree
                      ? "Noch kein kostenloses Modell hat in den letzten 24 Stunden erfolgreich geantwortet. Starte die Prüfung oder deaktiviere diesen Filter."
                      : onlyFree
                      ? "Für diese Funktion ist kein sicher als kostenlos eingestuftes Modell im Katalog. Deaktiviere den Filter, um alle Modelle zu sehen."
                      : "Für diesen Anbieter ist hier aktuell kein Modell im Katalog."}
                  </p>
                )
                : (
                  <div
                    class="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    role="radiogroup"
                    aria-label={`${label} Modell`}
                  >
                    {visible.sort((a, b) => {
                      const checked = { ok: 0, unknown: 1, error: 2 };
                      const order = [
                        "EU + Zero Data Retention",
                        "Zero Data Retention",
                        "Kostenlos",
                        "Weitere Modelle",
                      ];
                      return (id === "chat"
                        ? (me.provider === "google"
                          ? newestGeminiFirst(a, b)
                          : chatPriority(a) - chatPriority(b) ||
                            (geminiVersion(a) && geminiVersion(b)
                              ? newestGeminiFirst(a, b)
                              : 0))
                        : 0) ||
                        checked[a.checkStatus] - checked[b.checkStatus] ||
                        order.indexOf(category(a)) -
                          order.indexOf(category(b)) ||
                        a.name.localeCompare(b.name);
                    }).map((model) => (
                      <label
                        key={model.id}
                        class={`block rounded-xl border bg-white p-3 ${
                          config.models[id] === model.id
                            ? "border-indigo-500 ring-1 ring-indigo-300"
                            : "border-slate-200"
                        }`}
                      >
                        <span class="flex items-start gap-3">
                          <input
                            type="radio"
                            name={`model-${id}`}
                            class="mt-1"
                            checked={config.models[id] === model.id}
                            onChange={() => changeModel(id, model.id)}
                          />
                          <span class="min-w-0">
                            <span class="block font-semibold text-slate-900">
                              {model.name}{" "}
                              <span class="font-normal text-slate-600">
                                ({model.free ? "kostenlos" : model.priceNote})
                              </span>
                            </span>
                            <span class="block break-all text-xs text-slate-500">
                              {model.id}
                            </span>
                            <span class="mt-1 block text-xs text-indigo-700">
                              {category(model)}
                            </span>
                            <span
                              class={`mt-1 block text-xs ${
                                model.checkStatus === "ok"
                                  ? "text-green-700"
                                  : model.checkStatus === "error"
                                  ? "text-red-700"
                                  : "text-slate-500"
                              }`}
                            >
                              {model.checkStatus === "ok"
                                ? "✓ Mit diesem Key in den letzten 24 Stunden erfolgreich"
                                : model.checkStatus === "error"
                                ? "Zuletzt fehlgeschlagen – erneut testen"
                                : "Mit diesem Key noch nicht getestet"}
                            </span>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              {id === "chat" && config.models.chat && (
                <button
                  type="button"
                  class="mt-3 rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={testChat}
                >
                  Ausgewähltes Chatmodell testen
                </button>
              )}
              {id === "tts" && config.models.tts && (
                <div class="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                  <h4 class="font-semibold text-indigo-900">
                    Stimme und Sprechstil
                  </h4>
                  {me.provider === "google"
                    ? (
                      <>
                        <p class="mt-1 text-sm text-indigo-800">
                          Die Stimmen kommen direkt aus dem Google-Katalog.
                          Standardmäßig zeigen wir deutschsprachige Stimmen;
                          suche nach einem Namen, wenn du mehr finden möchtest.
                        </p>
                        <div class="mt-3 flex gap-2">
                          <input
                            class={inputClass}
                            value={voiceSearch}
                            onInput={(e) =>
                              setVoiceSearch(e.currentTarget.value)}
                            placeholder="Stimme suchen"
                          />
                          <button
                            type="button"
                            class="rounded-xl border border-indigo-300 px-3 text-indigo-700"
                            onClick={() =>
                              run(async () => await loadVoices(voiceSearch))}
                          >
                            Suchen
                          </button>
                        </div>
                        <select
                          class={`${inputClass} mt-3`}
                          value={config.ttsVoice}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              ttsVoice: e.currentTarget.value,
                            })}
                        >
                          <option value="">Bitte Stimme wählen</option>
                          {config.ttsVoice && !voices.some((voice) =>
                            voice.id === config.ttsVoice
                          ) &&
                            (
                              <option value={config.ttsVoice}>
                                Gewählt: {config.ttsVoice}
                              </option>
                            )}
                          {voices.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.name} · {voice.language || "mehrsprachig"}
                            </option>
                          ))}
                        </select>
                        {voicePage && (
                          <button
                            type="button"
                            class="mt-2 text-sm text-indigo-700 underline"
                            onClick={() =>
                              run(async () =>
                                await loadVoices(voiceSearch, voicePage, true)
                              )}
                          >
                            Weitere Stimmen laden
                          </button>
                        )}
                      </>
                    )
                    : (
                      <label class="mt-3 block text-sm font-semibold text-slate-700">
                        Stimme des gewählten OpenRouter-Modells
                        <input
                          class={`${inputClass} mt-1`}
                          list="openrouter-voice-hints"
                          value={config.ttsVoice}
                          onInput={(e) =>
                            setConfig({
                              ...config,
                              ttsVoice: e.currentTarget.value,
                            })}
                          placeholder="Stimmenname laut Modellseite"
                        />
                        <datalist id="openrouter-voice-hints">
                          {[
                            "alloy",
                            "nova",
                            "Kore",
                            "Eve",
                            "en_paul_neutral",
                            "en-US-Harper:MAI-Voice-2",
                          ].map((voice) => (
                            <option key={voice} value={voice} />
                          ))}
                        </datalist>
                        <span class="mt-1 block text-xs font-normal text-slate-600">
                          OpenRouter bietet keine einheitliche Stimmenliste per
                          API. Die Beispiele sind nur Vorschläge; prüfe die
                          Stimmen auf der Seite des gewählten Modells und teste
                          hier.
                        </span>
                      </label>
                    )}
                  <label class="mt-4 block text-sm font-semibold text-slate-700">
                    Regieanweisung für TTS
                    <textarea
                      class={`${inputClass} mt-1`}
                      rows={2}
                      maxLength={300}
                      value={config.ttsStyle}
                      onInput={(e) =>
                        setConfig({
                          ...config,
                          ttsStyle: e.currentTarget.value,
                        })}
                    />
                    <span class="mt-1 block text-xs font-normal text-slate-600">
                      Zum Beispiel: „Sprich freundlich, klar und nicht zu
                      schnell auf Deutsch.“
                    </span>
                  </label>
                </div>
              )}
              {id !== "chat" && config.models[id] && (
                <div class="mt-3">
                  {id === "asr"
                    ? (
                      <div class="space-y-2">
                        <label class="block text-sm font-semibold text-slate-700">
                          Kurze Audiodatei für den ASR-Test (bis 2 MB)
                          <input
                            type="file"
                            accept="audio/*"
                            class="mt-2 block w-full text-sm font-normal text-slate-600"
                            disabled={busy}
                            onChange={(e) =>
                              setAsrTestFile(
                                e.currentTarget.files?.[0] ?? null,
                              )}
                          />
                        </label>
                        <button
                          type="button"
                          class="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                          disabled={busy || !asrTestFile}
                          onClick={() =>
                            testMedia(id, asrTestFile ?? undefined)}
                        >
                          Ausgewähltes ASR-Modell testen
                        </button>
                      </div>
                    )
                    : (
                      <button
                        type="button"
                        class="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => testMedia(id)}
                      >
                        Ausgewähltes Modell testen
                      </button>
                    )}
                </div>
              )}
            </div>
          );
        })}
        <div class="mt-8">
          <button
            type="button"
            class={buttonClass}
            disabled={busy}
            onClick={save}
          >
            Auswahl speichern
          </button>
        </div>
      </section>
      {notice && (
        <div role="status" class="rounded-2xl bg-green-50 p-4 text-green-800">
          {notice}
        </div>
      )}
      {error && !feedback && (
        <div role="alert" class="rounded-2xl bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}
      {feedback && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={feedback.title}
            class="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div
              class={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-2xl font-bold ${
                feedback.kind === "success"
                  ? "bg-green-100 text-green-700"
                  : feedback.kind === "error"
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {feedback.kind === "success"
                ? "✓"
                : feedback.kind === "error"
                ? "!"
                : "i"}
            </div>
            <h2 class="text-xl font-bold text-slate-900">{feedback.title}</h2>
            <p class="mt-3 whitespace-pre-wrap break-words text-slate-700">
              {feedback.message}
            </p>
            <button
              type="button"
              class={`${buttonClass} mt-6 w-full`}
              onClick={() => setFeedback(null)}
            >
              Verstanden
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
