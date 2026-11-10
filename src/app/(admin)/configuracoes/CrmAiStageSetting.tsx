"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

type Mode = "off" | "suggest" | "auto";

const OPTIONS: { id: Mode; label: string; desc: string }[] = [
  { id: "off",     label: "Desligada",  desc: "Nada automático. O botão \"Analisar com IA\" no lead continua disponível." },
  { id: "suggest", label: "Sugerir",    desc: "A IA lê as conversas novas e deixa a sugestão de etapa no lead — você aplica ou ignora." },
  { id: "auto",    label: "Automático", desc: "A IA move sozinha quando tem certeza (80%+), só pra frente no funil. Ganho/Perdido sempre ficam como sugestão." },
];

/**
 * Modo da IA que ajusta a etapa dos leads/oportunidades pela conversa do
 * WhatsApp (lib/lead-stage-ai.ts). Cada análise usa 1 interação da cota de IA.
 */
export default function CrmAiStageSetting({ companyId }: { companyId: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [saving, setSaving] = useState(false);
  const qs = companyId ? `?companyId=${companyId}` : "";

  useEffect(() => {
    fetch(`/api/crm/ai-stage${qs}`)
      .then((r) => (r.ok ? r.json() : { mode: "off" }))
      .then((d) => setMode(d.mode ?? "off"))
      .catch(() => setMode("off"));
  }, [qs]);

  async function choose(m: Mode) {
    setSaving(true);
    const res = await fetch(`/api/crm/ai-stage${qs}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: m }),
    });
    if (res.ok) setMode(m);
    setSaving(false);
  }

  return (
    <div className="mb-6 bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-fuchsia-300" />
        <span className="text-white text-sm font-semibold">IA ajusta as etapas pela conversa</span>
      </div>
      <p className="text-slate-500 text-xs mb-3">
        Para leads e oportunidades com conversa no WhatsApp: a IA lê o que foi falado (respondeu, pediu orçamento,
        marcou reunião, fechou, recusou) e indica a etapa certa — e o retorno, quando a conversa combinou uma data.
        Cada análise usa 1 interação da cota de IA da empresa.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const active = mode === o.id;
          return (
            <button
              key={o.id}
              onClick={() => choose(o.id)}
              disabled={saving || mode === null}
              className={`text-left rounded-lg border p-2.5 transition-colors disabled:opacity-60 ${
                active ? "border-fuchsia-500/50 bg-fuchsia-500/10" : "border-[#1e2d45] hover:border-[#2a3d5a]"
              }`}
            >
              <div className={`text-xs font-semibold ${active ? "text-fuchsia-200" : "text-slate-300"}`}>{o.label}</div>
              <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{o.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
