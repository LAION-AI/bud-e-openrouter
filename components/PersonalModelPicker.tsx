import type {
  PersonalProvider,
  PersonalRole,
} from "../utils/personalClient.ts";
import type { PersonalModel } from "../utils/personalProviders.ts";
import {
  personalModelChoices,
  personalModelVendor,
} from "../utils/personalModelSelection.ts";

export default function PersonalModelPicker(
  { models, provider, role, label, value, query, onlyFree, disabled, onChange }:
    {
      models: PersonalModel[];
      provider: PersonalProvider;
      role: PersonalRole;
      label: string;
      value: string;
      query: string;
      onlyFree: boolean;
      disabled: boolean;
      onChange: (id: string) => void;
    },
) {
  const choices = personalModelChoices(models, provider, role, query, onlyFree);
  const groups = new Map<string, PersonalModel[]>();
  for (const model of choices) {
    if (model.id === value) continue;
    const vendor = personalModelVendor(model, provider);
    const group = groups.get(vendor) ?? [];
    group.push(model);
    groups.set(vendor, group);
  }
  const selected = models.find((model) => model.id === value);
  return (
    <div>
      {query.trim() && (
        <div class="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-2">
          <p class="mb-2 px-2 text-xs text-slate-500" aria-live="polite">
            {choices.length} Treffer · passendste zuerst
          </p>
          <div
            role="listbox"
            aria-label={`${label} Suchergebnisse`}
            class="max-h-56 overflow-y-auto"
          >
            {choices.slice(0, 6).map((model) => (
              <button
                type="button"
                role="option"
                aria-selected={model.id === value}
                disabled={disabled}
                key={model.id}
                onClick={() => onChange(model.id)}
                class={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-100 disabled:opacity-50 ${
                  model.id === value
                    ? "bg-indigo-100 ring-1 ring-indigo-300"
                    : ""
                }`}
              >
                <span class="block break-words font-semibold text-slate-800">
                  {personalModelVendor(model, provider)} · {model.name}
                </span>
                <span class="block break-words text-xs text-slate-500">
                  {model.id} · {model.price}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <select
        class="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-900"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">Modell wählen …</option>
        {value && (
          <option value={value}>
            {selected
              ? `${
                personalModelVendor(selected, provider)
              } · ${selected.name} · ${selected.price}`
              : value} · aktuell ausgewählt
          </option>
        )}
        {[...groups].sort(([a], [b]) =>
          a.localeCompare(b, "de", { sensitivity: "base" })
        ).map(([vendor, group]) => (
          <optgroup key={vendor} label={vendor}>
            {personalModelChoices(group, provider, role).map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.price}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
