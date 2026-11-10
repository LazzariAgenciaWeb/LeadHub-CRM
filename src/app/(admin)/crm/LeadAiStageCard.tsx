"use client";

import { useState } from "react";
import { Sparkles, Check, X, RefreshCw, CalendarClock } from "lucide-react";
import type { CRMLead } from "./CRMBoard";

type Patch = Partial<Pick<CRMLead,
  "pipelineStage" | "expectedReturnAt" |
  "aiStageSuggestion" | "aiStageReason" | "aiStageConfidence" | "aiStageReturnAt" | "aiStageAnalyzedAt">>;

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Cartão "IA pela conversa" no drawer do lead: mostra a etapa (e o retorno)
 * que a IA sugere a partir do WhatsApp, com Aplicar / Ignorar, e o botão
 * "Analisar com IA" pra rodar na hora. POST /api/leads/[id]/ai-stage.
 */
export default function LeadAiStageCard({ lead, onUpdated }: { lead: CRMLead; onUpdated: (p: Patch) => void }) {
  const [busy, setBusy] = useState<null | "analyze" | "apply" | "dismiss">(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(action: "analyze" | "apply" | "dismiss") {
    setBusy(action);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/ai-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Erro"); return; }
      const l = data.lead ?? {};
      onUpdated({
        pipelineStage: l.pipelineStage,
        expectedReturnAt: l.expectedReturnAt,
        aiStageSuggestion: l.aiStageSuggestion,
        aiStageReason: l.aiStageReason,
        aiStageConfidence: l.aiStageConfidence,
        aiStageReturnAt: l.aiStageReturnAt,
        aiStageAnalyzedAt: l.aiStageAnalyzedAt,
      });
      if (action === "analyze" && !l.aiStageSuggestion && !l.aiStageReturnAt) {
        setInfo("A IA manteve a etapa atual — nada mudou na conversa.");
      }
    } finally {
      setBusy(null);
    }
  }

  const pending = !!(lead.aiStageSuggestion || lead.aiStageReturnAt);

  return (
    <div className={`rounded-xl border p-3 ${pending ? "border-fuchsia-500/40 bg-fuchsia-500/[0.06]" : "border-[#1e2d45] bg-[#0a0f1a]"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-fuchsia-200 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> IA pela conversa
        </span>
        <button
          onClick={() => run("analyze")}
          disabled={busy !== null}
          title="A IA lê a conversa do WhatsApp agora (usa 1 interação da cota de IA)"
          className="text-[10px] px-2 py-1 rounded-md bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white disabled:opacity-50 flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${busy === "analyze" ? "animate-spin" : ""}`} />
          {busy === "analyze" ? "Lendo..." : "Analisar com IA"}
        </button>
      </div>

      {pending ? (
        <div className="mt-2 space-y-1.5">
          {lead.aiStageSuggestion && (
            <div className="text-xs text-slate-200">
              Mover para <span className="font-semibold text-white">{lead.aiStageSuggestion}</span>
              {lead.aiStageConfidence != null && (
                <span className="text-slate-500"> · {lead.aiStageConfidence}% de certeza</span>
              )}
            </div>
          )}
          {lead.aiStageReturnAt && (
            <div className="text-xs text-slate-200 flex items-center gap-1">
              <CalendarClock className="w-3 h-3 text-amber-300" /> Retorno combinado: <span className="font-semibold text-white">{fmt(lead.aiStageReturnAt)}</span>
            </div>
          )}
          {lead.aiStageReason && <p className="text-[11px] text-slate-400 leading-snug">{lead.aiStageReason}</p>}
          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={() => run("apply")}
              disabled={busy !== null}
              className="flex-1 text-[11px] py-1.5 rounded-md bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Check className="w-3 h-3" /> {busy === "apply" ? "Aplicando..." : "Aplicar"}
            </button>
            <button
              onClick={() => run("dismiss")}
              disabled={busy !== null}
              className="px-3 text-[11px] py-1.5 rounded-md bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white disabled:opacity-50 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Ignorar
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
          {lead.aiStageAnalyzedAt
            ? `Última leitura ${fmt(lead.aiStageAnalyzedAt)}: etapa atual condiz com a conversa.`
            : "A IA ainda não leu esta conversa."}
        </p>
      )}

      {info && <p className="text-[11px] text-slate-400 mt-1.5">{info}</p>}
      {error && <p className="text-[11px] text-amber-300 mt-1.5">{error}</p>}
    </div>
  );
}
