import type { PersonalProvider, PersonalRole } from "./personalClient.ts";
import type { PersonalModel } from "./personalProviders.ts";

const collator = new Intl.Collator("de", {
  sensitivity: "base",
  numeric: true,
});
const normalize = (text: string) =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
const vendorNames: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
  anthropic: "Anthropic",
  "x-ai": "xAI",
  meta: "Meta",
  "meta-llama": "Meta",
  qwen: "Qwen",
  mistralai: "Mistral AI",
};
export function personalModelVendor(
  model: PersonalModel,
  provider: PersonalProvider,
): string {
  if (provider === "google") return "Google";
  const prefix = model.id.includes("/")
    ? model.id.split("/")[0]
    : model.name.includes(":")
    ? model.name.split(":")[0]
    : "Weitere Anbieter";
  return vendorNames[prefix.toLowerCase()] ??
    prefix.replace(/[-_]/g, " ").replace(
      /\b\p{L}/gu,
      (letter) => letter.toUpperCase(),
    );
}
export function personalModelChoices(
  models: PersonalModel[],
  provider: PersonalProvider,
  role: PersonalRole,
  query = "",
  onlyFree = false,
): PersonalModel[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const rank = (model: PersonalModel) => {
    const vendor = normalize(personalModelVendor(model, provider));
    const name = normalize(model.name), id = normalize(model.id);
    const basename = id.split("/").at(-1)!;
    const words = `${vendor} ${name} ${id}`.split(/[^\p{L}\p{N}]+/u);
    let score = 0;
    for (const term of terms) {
      const part = [vendor, name, id, basename].some((s) => s === term)
        ? 0
        : vendor.startsWith(term)
        ? 1
        : [name, basename].some((s) => s.startsWith(term))
        ? 2
        : words.some((s) => s.startsWith(term))
        ? 3
        : `${vendor} ${name} ${id}`.includes(term)
        ? 4
        : Infinity;
      score += part;
    }
    return score;
  };
  return models.filter((model) =>
    model.roles.includes(role) && (!onlyFree || model.free)
  )
    .map((model) => ({ model, rank: rank(model) }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) =>
      a.rank - b.rank ||
      collator.compare(
        personalModelVendor(a.model, provider),
        personalModelVendor(b.model, provider),
      ) ||
      collator.compare(a.model.name, b.model.name) ||
      collator.compare(a.model.id, b.model.id)
    )
    .map((entry) => entry.model);
}
