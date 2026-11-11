"use client";

import { CAMPAIGN_SOURCES } from "@/lib/sources";

/**
 * Seletor de origem da campanha (Campaign.source). Grid de botões — mesmo
 * componente nas três telas que criam/editam campanha, pra nunca mais uma
 * delas ficar sem o campo e gravar OTHER por omissão.
 */
export default function CampaignSourcePicker({
  value,
  onChange,
  label = "Canal / Origem",
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
        {label}
      </label>
      <div className="grid grid-cols-3 gap-2">
        {CAMPAIGN_SOURCES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onChange(s.value)}
            className={`text-xs font-semibold py-2 px-2 rounded-lg border transition-all ${
              value === s.value
                ? "border-indigo-500 bg-indigo-500/15 text-indigo-400"
                : "border-[#1e2d45] bg-[#161f30] text-slate-400 hover:border-slate-500"
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>
      <p className="text-slate-600 text-[10px] mt-1.5">
        {hint ??
          "Vira a origem do lead gerado pelos gatilhos e o utm_source dos links da campanha. Link e gatilho podem sobrescrever."}
      </p>
    </div>
  );
}
