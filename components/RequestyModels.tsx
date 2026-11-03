// components/RequestyModels.tsx
/**
 * Model pickers shown in the settings once the key is a Requesty key.
 *
 * One dropdown per task the gateway serves - chat and chat with pictures.
 * Each list is grouped so the privacy properties are visible without reading
 * model names: the two we recommend sit at the top, then EU-hosted zero
 * retention, then zero retention outside the EU, then the free models, then
 * the rest. The list refreshes itself from Requesty, so a model that appears
 * next month shows up without anyone editing code.
 */

import { useEffect, useState } from "preact/hooks";
import { settingsContent } from "../internalization/content.ts";

export type RqRole = "llm" | "vlm";

export const RQ_ROLES: RqRole[] = ["llm", "vlm"];

interface Entry {
  id: string;
  name: string;
  zdr: boolean;
  eu: boolean;
  free: boolean;
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

/** "0.1" rather than "0.100", "-" when a model has no price, "free" at zero. */
function price(v: number): string {
  if (!v) return "free";
  return v >= 1 ? v.toFixed(2).replace(/\.?0+$/, "") : v.toFixed(3).replace(/0+$/, "");
}

function label(e: Entry): string {
  const badges = [
    e.eu && e.zdr ? "EU+ZDR" : "",
    e.eu && !e.zdr ? "EU" : "",
    !e.eu && e.zdr ? "ZDR" : "",
    e.free ? "free" : "",
  ].filter(Boolean).join(" ");
  const money = e.free ? "" : ` · $${price(e.promptPrice)}/${price(e.completionPrice)}`;
  return `${badges ? `[${badges}] ` : ""}${e.name}${money}`;
}

/** Which optgroup an entry belongs to. */
function groupOf(e: Entry): "recommended" | "euzdr" | "zdr" | "free" | "other" {
  if (e.recommended) return "recommended";
  if (e.eu && e.zdr) return "euzdr";
  if (e.zdr) return "zdr";
  if (e.free) return "free";
  return "other";
}

export default function RequestyModels({
  apiKey,
  values,
  onChange,
  lang = "en",
}: {
  apiKey: string;
  values: Record<RqRole, string>;
  onChange: (role: RqRole, modelId: string) => void;
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
      const r = await fetch("/api/requesty-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universalApiKey: apiKey, force }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      setCatalog(data);
    } catch (err) {
      console.error("[RQ] model list:", err);
      setError(t("rqError"));
    } finally {
      setLoading(false);
    }
  }

  // Reload whenever the key changes to a different Requesty key. The key is
  // in the dependency list so pasting a new one refreshes rather than showing
  // a list fetched for the previous account.
  useEffect(() => {
    if (apiKey) load(false);
  }, [apiKey]);

  const roleLabel: Record<RqRole, string> = {
    llm: t("rqRoleLlm"),
    vlm: t("rqRoleVlm"),
  };

  const groupLabel = {
    recommended: t("rqGroupRecommended"),
    euzdr: t("rqGroupEuZdr"),
    zdr: t("rqGroupZdr"),
    free: t("rqGroupFree"),
    other: t("rqGroupOther"),
  } as const;

  return (
    <div class="mb-4 border border-emerald-200 rounded-lg bg-emerald-50/60 p-3">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-semibold text-emerald-900 text-sm">{t("rqTitle")}</h3>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          class="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-100 disabled:opacity-50"
        >
          {loading ? t("rqLoading") : t("rqRefresh")}
        </button>
      </div>

      <p class="text-xs text-emerald-900/80 mb-2">{t("rqHint")}</p>

      {error && (
        <p class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-2">
          {error}
        </p>
      )}
      {catalog?.stale && (
        <p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
          {t("rqStale")}
        </p>
      )}

      {RQ_ROLES.map((role) => {
        const entries = catalog?.roles?.[role] ?? [];
        const chosen = values[role] ?? "";
        // An override naming a model that has since disappeared would silently
        // vanish from the select, so it is kept as its own option.
        const missing = chosen && !entries.some((e) => e.id === chosen);

        return (
          <div class="mb-2" key={role}>
            <label class="block text-xs font-medium text-emerald-900 mb-1">
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
                  ? `${label(entries.find((e) => e.recommended === "default")!)} (${t("rqDefault")})`
                  : t("rqLoading")}
              </option>
              {missing && <option value={chosen}>{chosen}</option>}
              {(["recommended", "euzdr", "zdr", "free", "other"] as const).map((g) => {
                const inGroup = entries.filter((e) => groupOf(e) === g);
                if (inGroup.length === 0) return null;
                return (
                  <optgroup label={groupLabel[g]} key={g}>
                    {inGroup.map((e) => (
                      <option value={e.id} key={e.id}>
                        {label(e)}
                        {e.recommended === "alternative" ? ` (${t("rqAlternative")})` : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
        );
      })}

      <p class="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
        {t("rqScopeNote")}
      </p>
      <p class="text-[11px] text-emerald-900/70 mt-2">{t("rqLegend")}</p>
      {catalog && (
        <p class="text-[11px] text-emerald-900/50 mt-1">
          {t("rqUpdated")}: {new Date(catalog.fetchedAt).toLocaleString(lang === "de" ? "de-DE" : "en-GB")}
        </p>
      )}
    </div>
  );
}
