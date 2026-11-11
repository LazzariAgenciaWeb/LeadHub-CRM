"use client";

import { LEAD_SOURCE_OPTIONS, getSourceMeta } from "@/lib/sources";

/**
 * Origem de um link ou gatilho — override opcional da origem da campanha.
 * Valor vazio = herdar. Grava a chave de Lead.source (ex: "instagram"), que é
 * a mesma coisa que vai no utm_source.
 */
export default function LeadSourceSelect({
  value,
  onChange,
  inheritLabel = "Herdar da campanha",
  className = "",
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  inheritLabel?: string;
  className?: string;
  title?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title ?? "Origem do lead"}
      className={
        className ||
        "bg-[#161f30] border border-[#1e2d45] rounded-lg px-2 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
      }
    >
      <option value="">↳ {inheritLabel}</option>
      {LEAD_SOURCE_OPTIONS.map((key) => {
        const meta = getSourceMeta(key);
        return (
          <option key={key} value={key}>
            {meta.icon} {meta.label}
          </option>
        );
      })}
    </select>
  );
}
