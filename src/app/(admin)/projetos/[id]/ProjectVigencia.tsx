"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Flag, Check, X } from "lucide-react";
import { formatBrazilDate, formatBrazilDateTime } from "@/lib/datetime";

/**
 * Vigência do projeto (Ativo · Pausado · Encerrado) + contratos que ele entrega.
 *
 * Com contrato ligado, quem manda é o contrato do Financeiro: encerrou lá, o
 * projeto arquiva. Sem contrato (projeto interno/avulso), a vigência é manual.
 * "Entregar" dá os pontos da gamificação e encerra os contratos escolhidos.
 */

export type ContractOpt = {
  id: string; label: string; status: string; isRecurring: boolean; billingCycle: string | null;
  startedAt: string | null; endedAt: string | null; service: string | null;
  projectId: string | null; projectName: string | null; suggested: boolean;
};

const VIG = {
  ATIVO:     { label: "Ativo",     cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  PAUSADO:   { label: "Pausado",   cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  ENCERRADO: { label: "Encerrado", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
} as const;

const CS_STATUS: Record<string, { label: string; cls: string }> = {
  ATIVO:          { label: "ativo",          cls: "text-emerald-300" },
  EM_IMPLANTACAO: { label: "em implantação", cls: "text-sky-300" },
  PAUSADO:        { label: "pausado",        cls: "text-amber-300" },
  ENCERRADO:      { label: "encerrado",      cls: "text-slate-500" },
};
const CICLO: Record<string, string> = { MENSAL: "mensal", TRIMESTRAL: "trimestral", ANUAL: "anual" };

function vigOf(status: string): keyof typeof VIG {
  if (status === "ENTREGUE" || status === "CANCELADO") return "ENCERRADO";
  if (status === "PAUSADO") return "PAUSADO";
  return "ATIVO";
}

function tipo(c: ContractOpt) {
  return c.isRecurring ? `recorrente${c.billingCycle ? ` · ${CICLO[c.billingCycle] ?? c.billingCycle.toLowerCase()}` : ""}` : "pontual";
}

export default function ProjectVigencia({
  projectId, status, deliveredAt, hasClient, contracts, extra,
}: {
  projectId: string; status: string; deliveredAt: string | Date | null; hasClient: boolean; contracts: ContractOpt[];
  /** Ação extra na coluna dos botões (ex.: ver o detalhamento). */
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const linked = contracts.filter((c) => c.projectId === projectId);
  const vig = vigOf(status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [delivering, setDelivering] = useState(false);
  const [toClose, setToClose] = useState<Set<string>>(new Set());

  async function call(url: string, method: string, body: unknown) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "Não consegui salvar."); return false; }
      router.refresh();
      return true;
    } catch {
      setErr("Falha de conexão."); return false;
    } finally {
      setBusy(false);
    }
  }

  function openPicker() {
    // Já ligados + sugeridos soltos vêm marcados.
    setPick(new Set(contracts.filter((c) => c.projectId === projectId || (c.suggested && !c.projectId)).map((c) => c.id)));
    setPicking(true);
  }
  async function savePicker() {
    if (await call(`/api/projetos/${projectId}/contratos`, "PUT", { ids: [...pick] })) setPicking(false);
  }
  function openDeliver() {
    // Pontual vem marcado; recorrente (gestão, site parcelado) fica desmarcado.
    setToClose(new Set(linked.filter((c) => c.status !== "ENCERRADO" && !c.isRecurring).map((c) => c.id)));
    setDelivering(true);
  }
  async function deliver() {
    if (await call(`/api/projetos/${projectId}/entregar`, "POST", { encerrar: [...toClose] })) setDelivering(false);
  }
  const setManual = (s: string) => call(`/api/projetos/${projectId}`, "PATCH", { status: s });

  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n);
  };
  const openLinked = linked.filter((c) => c.status !== "ENCERRADO");

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-slate-500 text-xs uppercase tracking-wider">Vigência</span>
        <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${VIG[vig].cls}`}>{VIG[vig].label}</span>
        <span className="text-[11px] text-slate-600">
          {linked.length ? "vem dos contratos ligados" : "manual — projeto sem contrato ligado"}
        </span>
        <div className="ml-auto flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          {hasClient && (
            <button type="button" onClick={openPicker} disabled={busy}
              className="text-xs px-2.5 py-1 rounded-lg border border-[#1e2d45] text-slate-300 hover:text-white flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" /> {linked.length ? "Contratos" : "Ligar contrato"}
            </button>
          )}
          {!deliveredAt && status !== "ENTREGUE" && (
            <button type="button" onClick={openDeliver} disabled={busy}
              className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5" /> Entregar projeto
            </button>
          )}
        </div>
        {extra}
        </div>
      </div>

      {/* Contratos ligados */}
      {linked.length > 0 && (
        <ul className="space-y-1.5">
          {linked.map((c) => {
            const st = CS_STATUS[c.status] ?? { label: c.status.toLowerCase(), cls: "text-slate-400" };
            return (
              <li key={c.id} className="flex items-center gap-2 text-xs rounded-lg bg-[#080c14] border border-[#1e2d45] px-3 py-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.status === "ENCERRADO" ? "bg-slate-600" : c.status === "PAUSADO" ? "bg-amber-400" : "bg-emerald-400"}`} />
                <span className="text-slate-100 font-medium truncate">{c.label}</span>
                {c.service && c.service !== c.label && <span className="text-slate-500 truncate">· {c.service}</span>}
                <span className="text-slate-500 shrink-0">· {tipo(c)}</span>
                <span className={`ml-auto shrink-0 ${st.cls}`}>{st.label}</span>
                <span className="text-slate-600 shrink-0 w-28 text-right">
                  {c.status === "ENCERRADO" && c.endedAt ? `até ${formatBrazilDate(c.endedAt)}` : c.startedAt ? `desde ${formatBrazilDate(c.startedAt)}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sem contrato: vigência manual */}
      {linked.length === 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {([["EM_ANDAMENTO", "Ativo"], ["PAUSADO", "Pausado"], ["CANCELADO", "Encerrar sem entrega"]] as const).map(([s, label]) => {
            const on = s === "EM_ANDAMENTO" ? vig === "ATIVO" : s === "PAUSADO" ? vig === "PAUSADO" : status === "CANCELADO";
            return (
              <button key={s} type="button" disabled={busy || on} onClick={() => void setManual(s)}
                className={`text-xs px-3 py-1 rounded-full border ${on ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-[#1e2d45] text-slate-400 hover:text-white"}`}>
                {label}
              </button>
            );
          })}
          {!hasClient && <span className="text-[11px] text-slate-600 ml-1">Defina o cliente no ⚙ Configurar pra ligar contratos.</span>}
        </div>
      )}

      {deliveredAt && (
        <div className="mt-3 text-emerald-300 text-xs">✓ Entregue em {formatBrazilDateTime(deliveredAt)}</div>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}

      {/* Escolher contratos */}
      {picking && (
        <div className="mt-4 rounded-lg border border-indigo-500/30 bg-[#080c14] p-3">
          <div className="text-xs text-slate-300 font-medium mb-1">Contratos que este projeto entrega</div>
          <p className="text-[11px] text-slate-500 mb-2">Enquanto algum estiver ativo, o projeto fica Ativo. Todos encerrados no Financeiro → o projeto arquiva sozinho.</p>
          {contracts.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">Este cliente não tem contratos no Financeiro.</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {contracts.map((c) => {
                const st = CS_STATUS[c.status] ?? { label: c.status.toLowerCase(), cls: "text-slate-400" };
                return (
                  <label key={c.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-[#0d1424] cursor-pointer">
                    <input type="checkbox" checked={pick.has(c.id)} onChange={() => toggle(pick, c.id, setPick)} className="accent-indigo-500" />
                    <span className="text-slate-100 truncate">{c.label}</span>
                    <span className="text-slate-500 shrink-0">· {tipo(c)}</span>
                    <span className={`shrink-0 ${st.cls}`}>· {st.label}</span>
                    {c.suggested && !c.projectId && <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] shrink-0">sugerido</span>}
                    {c.projectId && c.projectId !== projectId && (
                      <span className="ml-auto text-[10px] text-amber-400 shrink-0 truncate max-w-[40%]">está em {c.projectName ?? "outro projeto"} — marcar move pra cá</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setPicking(false)} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-white">Cancelar</button>
            <button type="button" onClick={() => void savePicker()} disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      )}

      {/* Confirmar entrega */}
      {delivering && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-[#080c14] p-3">
          <div className="text-xs text-slate-200 font-medium mb-1">🏁 Entregar projeto</div>
          <p className="text-[11px] text-slate-500 mb-2">
            Carimba a entrega e dá os pontos da gamificação pra equipe do projeto (bônus se estiver no prazo).
          </p>
          {openLinked.length > 0 && (
            <>
              <p className="text-[11px] text-slate-400 mb-1.5">
                Encerrar no Financeiro junto com a entrega? Desmarque o que <b>continua</b> — gestão mensal, hospedagem, site ainda em parcelas.
              </p>
              <div className="space-y-1">
                {openLinked.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-[#0d1424] cursor-pointer">
                    <input type="checkbox" checked={toClose.has(c.id)} onChange={() => toggle(toClose, c.id, setToClose)} className="accent-emerald-500" />
                    <span className="text-slate-100">{c.label}</span>
                    <span className="text-slate-500">· {tipo(c)}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 mt-2">
                {openLinked.some((c) => !toClose.has(c.id))
                  ? "Sobra contrato ativo → o projeto segue Ativo (entrega fica registrada)."
                  : "Nada continua → o projeto vai pra Encerrados."}
              </p>
            </>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setDelivering(false)} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-white flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancelar</button>
            <button type="button" onClick={() => void deliver()} disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> {busy ? "Entregando…" : "Confirmar entrega"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
