// components/OpenRouterModels.tsx
/**
 * Model pickers shown in the settings once the key is an OpenRouter key.
 *
 * One dropdown per task. Each list is grouped so the privacy properties are
 * visible without reading model names: the two we recommend sit at the top,
 * then EU + zero retention, then the weaker combinations. The list refreshes
 * itself from OpenRouter, so a model that appears next month shows up without
 * anyone editing code.
 */

import { useEffect, useState } from "preact/hooks";
import { settingsContent } from "../internalization/content.ts";

export type OrRole = "llm" | "vlm" | "asr" | "tts" | "image" | "music";

export const OR_ROLES: OrRole[] = ["llm", "vlm", "asr", "tts", "image", "music"];

interface Entry {
  id: string;
  name: string;
  zdr: boolean;
  eu: boolean;
  speaks?: boolean;
  promptPrice: number;
  completionPrice: number;
  context: number;
  recommended?: "default" | "alternative";
}

interface CatalogResponse {
  roles: Record<string, Entry[]>;
  fetchedAt: number;
  stale: boolean;
  error?: string;
}

/** "0.1" rather than "0.100", and "-" when a model has no price. */
function price(v: number): string {
  if (!v) return "-";
  return v >= 1 ? v.toFixed(2).replace(/\.?0+$/, "") : v.toFixed(3).replace(/0+$/, "");
}

function label(e: Entry): string {
  const badges = [e.eu ? "EU" : "", e.zdr ? "ZDR" : ""].filter(Boolean).join("+");
  const money = e.promptPrice || e.completionPrice
    ? ` · $${price(e.promptPrice)}/${price(e.completionPrice)}`
    : "";
  return `${badges ? `[${badges}] ` : ""}${e.name}${money}`;
}

/** Which optgroup an entry belongs to. */
function groupOf(e: Entry): "recommended" | "euzdr" | "eu" | "zdr" | "other" {
  if (e.recommended) return "recommended";
  if (e.eu && e.zdr) return "euzdr";
  if (e.eu) return "eu";
  if (e.zdr) return "zdr";
  return "other";
}

export default function OpenRouterModels({
  apiKey,
  values,
  onChange,
  ttsPrompt,
  onTtsPromptChange,
  defaultTtsPrompt,
  songAutoplay,
  onSongAutoplayChange,
  lang = "en",
}: {
  apiKey: string;
  values: Record<OrRole, string>;
  onChange: (role: OrRole, modelId: string) => void;
  ttsPrompt: string;
  onTtsPromptChange: (value: string) => void;
  defaultTtsPrompt: string;
  songAutoplay: boolean;
  onSongAutoplayChange: (value: boolean) => void;
  lang?: string;
}) {
  const t = (k: string) => (settingsContent[lang]?.[k] ?? settingsContent.en[k]) as string;

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(force = false) {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/openrouter-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universalApiKey: apiKey, force }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      setCatalog(data);
    } catch (err) {
      console.error("[OR] model list:", err);
      setError(t("orError"));
    } finally {
      setLoading(false);
    }
  }

  // Reload whenever the key changes to a different OpenRouter key. The key is
  // in the dependency list so pasting a new one refreshes rather than showing
  // a list fetched for the previous account.
  useEffect(() => {
    if (apiKey) load(false);
  }, [apiKey]);

  const roleLabel: Record<OrRole, string> = {
    llm: t("orRoleLlm"),
    vlm: t("orRoleVlm"),
    asr: t("orRoleAsr"),
    tts: t("orRoleTts"),
    image: t("orRoleImage"),
    music: t("orRoleMusic"),
  };

  const groupLabel = {
    recommended: t("orGroupRecommended"),
    euzdr: t("orGroupEuZdr"),
    eu: t("orGroupEu"),
    zdr: t("orGroupZdr"),
    other: t("orGroupOther"),
  } as const;

  return (
    <div class="mb-4 border border-indigo-200 rounded-lg bg-indigo-50/60 p-3">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-semibold text-indigo-900 text-sm">{t("orTitle")}</h3>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          class="text-xs px-2 py-1 rounded border border-indigo-300 text-indigo-800 bg-white hover:bg-indigo-100 disabled:opacity-50"
        >
          {loading ? t("orLoading") : t("orRefresh")}
        </button>
      </div>

      <p class="text-xs text-indigo-900/80 mb-2">{t("orHint")}</p>

      {error && (
        <p class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-2">
          {error}
        </p>
      )}
      {catalog?.stale && (
        <p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
          {t("orStale")}
        </p>
      )}

      {OR_ROLES.map((role) => {
        const entries = catalog?.roles?.[role] ?? [];
        const chosen = values[role] ?? "";
        // An override naming a model that has since disappeared would silently
        // vanish from the select, so it is kept as its own option.
        const missing = chosen && !entries.some((e) => e.id === chosen);

        return (
          <div class="mb-2" key={role}>
            <label class="block text-xs font-medium text-indigo-900 mb-1">
              {roleLabel[role]}
            </label>
            <select
              value={chosen}
              disabled={!catalog}
              onChange={(e) =>
                onChange(role, (e.target as HTMLSelectElement).value)}
              class="w-full p-2 text-sm border rounded bg-white disabled:bg-slate-100"
            >
              {/* Empty value = use whatever the server considers the default. */}
              <option value="">
                {entries.find((e) => e.recommended === "default")
                  ? `${label(entries.find((e) => e.recommended === "default")!)} (${t("orDefault")})`
                  : t("orLoading")}
              </option>
              {missing && <option value={chosen}>{chosen}</option>}
              {(["recommended", "euzdr", "eu", "zdr", "other"] as const).map((g) => {
                const inGroup = entries.filter((e) => groupOf(e) === g);
                if (inGroup.length === 0) return null;
                return (
                  <optgroup label={groupLabel[g]} key={g}>
                    {inGroup.map((e) => (
                      <option value={e.id} key={e.id}>
                        {label(e)}
                        {e.recommended === "alternative" ? ` (${t("orAlternative")})` : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
        );
      })}

      {/* Songs start by themselves unless this is off - music that begins
          unasked is a nuisance in a classroom. */}
      <label class="mt-3 flex items-start gap-2 text-xs text-indigo-900 cursor-pointer">
        <input
          type="checkbox"
          checked={songAutoplay}
          onChange={(e) => onSongAutoplayChange((e.target as HTMLInputElement).checked)}
          class="mt-0.5"
        />
        <span>
          <span class="font-medium">{t("orSongAutoplay")}</span>
          <span class="block text-indigo-900/70">{t("orSongAutoplayHint")}</span>
        </span>
      </label>

      {/* The speaking style. Gemini has no style parameter - the instruction is
          written in front of the text, so it is prose the user can rewrite. */}
      <div class="mt-3 pt-3 border-t border-indigo-200">
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-medium text-indigo-900">
            {t("orTtsPromptLabel")}
          </label>
          <button
            type="button"
            onClick={() => onTtsPromptChange(defaultTtsPrompt)}
            disabled={ttsPrompt === defaultTtsPrompt}
            class="text-[11px] px-2 py-0.5 rounded border border-indigo-300 text-indigo-800 bg-white hover:bg-indigo-100 disabled:opacity-40"
          >
            {t("orTtsPromptReset")}
          </button>
        </div>
        <textarea
          value={ttsPrompt}
          onInput={(e) => onTtsPromptChange((e.target as HTMLTextAreaElement).value)}
          rows={6}
          spellcheck={false}
          class="w-full p-2 text-xs border rounded bg-white font-mono leading-relaxed"
          placeholder={defaultTtsPrompt}
        />
        <p class="text-[11px] text-indigo-900/70 mt-1">{t("orTtsPromptHint")}</p>
      </div>

      {/* Worth saying plainly: there is no private option for reading aloud. */}
      <p class="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
        {t("orNoTtsEu")}
      </p>
      <p class="text-[11px] text-indigo-900/70 mt-2">{t("orLegend")}</p>
      {catalog && (
        <p class="text-[11px] text-indigo-900/50 mt-1">
          {t("orUpdated")}: {new Date(catalog.fetchedAt).toLocaleString(lang === "de" ? "de-DE" : "en-GB")}
        </p>
      )}
    </div>
  );
}
