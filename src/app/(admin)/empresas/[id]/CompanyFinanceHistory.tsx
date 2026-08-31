"use client";

import { History } from "lucide-react";

export interface FinanceLogItem {
  id: string;
  entity: string; // CONTRATO | COBRANCA
  action: string;
  description: string | null;
  userName: string | null;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

const ACTION_LABEL: Record<string, { label: string; cls: string }> = {
  CRIADO: { label: "criado", cls: "text-slate-400" },
  ALTERADO: { label: "alterado", cls: "text-slate-400" },
  ENCERRADO: { label: "encerrado", cls: "text-red-400" },
  REABERTO: { label: "reaberto", cls: "text-emerald-400" },
  FATURADO: { label: "faturado", cls: "text-amber-400" },
  PAGO: { label: "pago", cls: "text-emerald-400" },
  CANCELADO: { label: "cancelado", cls: "text-red-400" },
  EXCLUIDO: { label: "excluído", cls: "text-red-400" },
  IGNORADO: { label: "ignorado no mês", cls: "text-slate-400" },
  IGNORADO_REVERTIDO: { label: "voltou pra fila", cls: "text-emerald-400" },
};

const brl = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Trilha de auditoria do financeiro deste cliente — quem encerrou, reabriu,
 * faturou, pagou ou excluiu, quando e com que motivo. Mora numa aba própria,
 * então rende a lista inteira sem dobradiça.
 */
export default function CompanyFinanceHistory({ logs }: { logs: FinanceLogItem[] }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm flex items-center gap-1.5">
          <History className="w-4 h-4 text-slate-400" strokeWidth={2.25} />
          Histórico do financeiro
        </h3>
        <span className="text-xs text-slate-500">{logs.length} registro(s)</span>
      </div>

      {logs.length === 0 ? (
        <p className="text-slate-600 text-sm py-8 text-center">
          Nada registrado ainda. Encerrar, reabrir, faturar, pagar ou excluir aparece aqui — com autor e motivo.
        </p>
      ) : (
        <div className="space-y-1 max-h-[520px] overflow-y-auto">
          {logs.map((l) => {
            const a = ACTION_LABEL[l.action] ?? { label: l.action.toLowerCase(), cls: "text-slate-400" };
            const meta = l.meta ?? {};
            const alvo = (meta.contrato ?? meta.label ?? meta.descricao ?? "") as string;
            const valor = (meta.valorCents ?? null) as number | null;
            const comp = (meta.competencia ?? null) as string | null;
            return (
              <div key={l.id} className="px-3 py-2 rounded-lg bg-white/[0.02] text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="text-slate-500">{l.entity === "CONTRATO" ? "Contrato" : "Cobrança"}</span>{" "}
                    <b className={a.cls}>{a.label}</b>
                    {alvo && <span className="text-slate-400"> · {alvo}</span>}
                    {valor != null && <span className="text-slate-500"> · {brl(valor)}</span>}
                    {comp && <span className="text-slate-600"> · {comp}</span>}
                  </span>
                  <span className="text-slate-600 flex-shrink-0">
                    {new Date(l.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    {l.userName && ` · ${l.userName}`}
                  </span>
                </div>
                {l.description && (
                  <div className="text-slate-500 mt-0.5">motivo: {l.description}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
