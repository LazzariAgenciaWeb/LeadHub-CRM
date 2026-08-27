"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, Building2, Plus, X, ExternalLink, Check, Pencil, Unlink, Trash2 } from "lucide-react";
import FinanceiroTabs from "../FinanceiroTabs";
import { brlFromCents } from "../lib";

export interface EsteiraSale {
  id: string;
  title: string;
  valueCents: number;
  kind: string;
  closedAt: string;
  sellerName: string | null;
  leadId: string | null;
  client: { id: string; name: string } | null;
  contractStatus: string;
  billingStatus: string;
  productionStatus: string;
}

export interface EsteiraData {
  isGlobal: boolean;
  clients: { id: string; name: string }[];
  sales: EsteiraSale[];
}

// Cada checkpoint tem um estado que significa "resolvido" e um "DISPENSADO",
// que existe porque nem toda venda precisa de contrato ou de produção — sem
// ele a fila nunca esvaziaria e as pessoas parariam de olhar pra ela.
const CHECKPOINTS = [
  {
    key: "contractStatus" as const,
    label: "Contrato",
    options: ["PENDENTE", "ENVIADO", "ASSINADO", "DISPENSADO"],
    done: ["ASSINADO", "DISPENSADO"],
  },
  {
    key: "billingStatus" as const,
    label: "Faturamento",
    options: ["PENDENTE", "FATURADO", "DISPENSADO"],
    done: ["FATURADO", "DISPENSADO"],
  },
  {
    // Três estágios, não dois: "o que preciso encaminhar", "o que está sendo
    // feito" e "o que já foi entregue" são perguntas diferentes — e só a
    // última libera bonificação do serviço pontual.
    key: "productionStatus" as const,
    label: "Produção",
    options: ["PENDENTE", "LIBERADO", "ENTREGUE", "DISPENSADO"],
    done: ["ENTREGUE", "DISPENSADO"],
  },
];

// Rótulo por checkpoint: "Pendente" quer dizer coisas diferentes em cada um —
// contrato pendente é "ainda não mandei", faturamento pendente é "a faturar",
// produção pendente é "preciso encaminhar". Um rótulo só apagaria a diferença.
const STATUS_LABEL: Record<string, Record<string, string>> = {
  contractStatus: { PENDENTE: "Pendente", ENVIADO: "Enviado", ASSINADO: "Assinado", DISPENSADO: "Não se aplica" },
  billingStatus: { PENDENTE: "A faturar", FATURADO: "Faturado", DISPENSADO: "Não se aplica" },
  productionStatus: {
    PENDENTE: "A encaminhar", LIBERADO: "Em produção", ENTREGUE: "Entregue", DISPENSADO: "Não se aplica",
  },
};

type FilterKey = "pendentes" | "sem-cliente" | "contrato" | "faturar" | "producao" | "todas";

function isDone(sale: EsteiraSale, cp: (typeof CHECKPOINTS)[number]) {
  return cp.done.includes(sale[cp.key]);
}
function fullyDone(sale: EsteiraSale) {
  return CHECKPOINTS.every((cp) => isDone(sale, cp));
}

const selectCls =
  "bg-[#161f30] border rounded-md px-1.5 py-1 text-[11px] focus:outline-none focus:border-indigo-500 cursor-pointer";

export default function EsteiraPanel({ data }: { data: EsteiraData }) {
  const router = useRouter();
  const [sales, setSales] = useState(data.sales);
  const [filter, setFilter] = useState<FilterKey>("pendentes");
  const [linking, setLinking] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  // Escolha do cliente é confirmada num botão, não no onChange do select.
  // Gravar direto na seleção transforma um clique errado no dropdown em
  // vínculo errado gravado — foi assim que a primeira versão errou.
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function openLink(sale: EsteiraSale) {
    const same = linking === sale.id;
    setLinking(same ? null : sale.id);
    setPicked("");
    // Pré-preenche com o nome da venda: no caso comum o cliente se chama igual.
    setNewName(same ? "" : sale.title);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setErr("");
    const res = await fetch(`/api/financeiro/vendas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error ?? "Não foi possível salvar.");
      return;
    }
    const updated = await res.json();
    setSales((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              contractStatus: updated.contractStatus,
              billingStatus: updated.billingStatus,
              productionStatus: updated.productionStatus,
              kind: updated.kind,
              client: updated.clientCompany ?? null,
            }
          : s
      )
    );
    setLinking(null);
    setNewName("");
    setPicked("");
    router.refresh();
  }

  /**
   * Tira a venda da esteira. Não mexe no lead — se ele continuar numa etapa de
   * ganho, um novo PATCH no CRM recria a venda. Serve pra limpar entrada
   * indevida (marcado como ganho por engano, teste, duplicata).
   */
  async function remove(sale: EsteiraSale) {
    const ok = window.confirm(
      `Excluir "${sale.title}" da esteira?\n\nO lead no CRM não é alterado. Se ele continuar numa etapa marcada como Ganho, a venda volta a aparecer no próximo movimento do card.`
    );
    if (!ok) return;

    setBusy(sale.id);
    setErr("");
    const res = await fetch(`/api/financeiro/vendas/${sale.id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error ?? "Não foi possível excluir.");
      return;
    }
    setSales((prev) => prev.filter((s) => s.id !== sale.id));
    router.refresh();
  }

  const counts = {
    semCliente: sales.filter((s) => !s.client).length,
    contrato: sales.filter((s) => !isDone(s, CHECKPOINTS[0])).length,
    faturar: sales.filter((s) => !isDone(s, CHECKPOINTS[1])).length,
    producao: sales.filter((s) => !isDone(s, CHECKPOINTS[2])).length,
    pendentes: sales.filter((s) => !fullyDone(s) || !s.client).length,
  };

  const filtered = sales.filter((s) => {
    switch (filter) {
      case "sem-cliente": return !s.client;
      case "contrato":    return !isDone(s, CHECKPOINTS[0]);
      case "faturar":     return !isDone(s, CHECKPOINTS[1]);
      case "producao":    return !isDone(s, CHECKPOINTS[2]);
      case "todas":       return true;
      default:            return !fullyDone(s) || !s.client;
    }
  });

  const FILTERS: { key: FilterKey; label: string; count?: number; tone?: string }[] = [
    { key: "pendentes", label: "Em aberto", count: counts.pendentes },
    { key: "sem-cliente", label: "Sem cliente", count: counts.semCliente, tone: "text-indigo-400" },
    { key: "contrato", label: "Falta contrato", count: counts.contrato, tone: "text-amber-400" },
    { key: "faturar", label: "Falta faturar", count: counts.faturar, tone: "text-amber-400" },
    { key: "producao", label: "Falta entregar", count: counts.producao, tone: "text-amber-400" },
    { key: "todas", label: "Todas" },
  ];

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      <div>
        <h1 className="text-white font-bold text-xl flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-indigo-400" />
          Esteira pós-venda
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Cada venda ganha no CRM entra aqui até virar cliente, contrato, fatura e liberação de produção.
          {data.isGlobal && <span className="ml-1 text-indigo-400">Visão global.</span>}
        </p>
      </div>

      <FinanceiroTabs />

      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              filter === f.key
                ? "bg-indigo-500/15 border-indigo-500/40 text-white"
                : "border-[#1e2d45] text-slate-400 hover:text-white hover:border-slate-600"
            }`}
          >
            {f.label}
            {f.count !== undefined && f.count > 0 && (
              <span className={`ml-1.5 font-bold ${f.tone ?? "text-slate-400"}`}>{f.count}</span>
            )}
          </button>
        ))}
      </div>

      {err && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-lg px-4 py-2 text-sm text-red-300 flex items-center justify-between">
          {err}
          <button onClick={() => setErr("")}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl py-16 text-center">
          <p className="text-slate-400 text-sm">
            {sales.length === 0
              ? "Nenhuma venda registrada ainda."
              : "Nada pendente neste filtro."}
          </p>
          {sales.length === 0 && (
            <p className="text-slate-600 text-xs mt-1.5">
              Vendas aparecem aqui automaticamente quando um lead entra numa etapa marcada como Ganho.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <div
              key={s.id}
              className={`bg-[#0f1623] border rounded-xl p-4 transition-opacity ${
                busy === s.id ? "opacity-50" : ""
              } ${fullyDone(s) && s.client ? "border-emerald-500/20" : "border-[#1e2d45]"}`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium text-sm">{s.title}</span>
                    <span className="text-emerald-400 font-semibold text-sm">{brlFromCents(s.valueCents)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                      {s.kind === "RECORRENTE" ? "Recorrente" : "Pontual"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>Fechada em {new Date(s.closedAt).toLocaleDateString("pt-BR")}</span>
                    {s.sellerName && <span className="text-slate-600">· {s.sellerName}</span>}
                    {s.leadId && (
                      <Link
                        href={`/crm/oportunidades?lead=${s.leadId}`}
                        className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5"
                      >
                        ver no CRM <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                </div>

                {/* Cliente */}
                <div className="flex items-center gap-2">
                  {s.client ? (
                    <>
                      <Link
                        href={`/empresas/${s.client.id}#financeiro`}
                        className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
                      >
                        <Building2 className="w-3.5 h-3.5 text-slate-500" />
                        {s.client.name}
                      </Link>
                      <button
                        onClick={() => openLink(s)}
                        title="Trocar ou desvincular o cliente"
                        className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/5"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => openLink(s)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-xs hover:bg-indigo-500/20"
                    >
                      <Plus className="w-3 h-3" /> Vincular cliente
                    </button>
                  )}
                </div>
              </div>

              {/* Vinculação: cliente existente ou cadastro novo */}
              {linking === s.id && (
                <div className="mt-3 pt-3 border-t border-[#1e2d45] flex items-end gap-3 flex-wrap">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500">
                      {s.client ? "Trocar por outro cliente" : "Cliente já cadastrado"}
                    </span>
                    <select
                      value={picked}
                      onChange={(e) => { setPicked(e.target.value); if (e.target.value) setNewName(""); }}
                      className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 min-w-[200px]"
                    >
                      <option value="">Selecione…</option>
                      {data.clients
                        .filter((c) => c.id !== s.client?.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                  </label>
                  <span className="text-slate-600 text-xs pb-2.5">ou</span>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500">Cadastrar novo</span>
                    <input
                      value={newName}
                      onChange={(e) => { setNewName(e.target.value); if (e.target.value) setPicked(""); }}
                      placeholder={s.title}
                      className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                  </label>
                  {/* O rótulo diz o que vai acontecer ANTES do clique — vincular a
                      quem já existe ou criar cadastro novo são efeitos bem diferentes. */}
                  <button
                    disabled={!picked && !newName.trim()}
                    onClick={() =>
                      picked
                        ? patch(s.id, { clientCompanyId: picked })
                        : patch(s.id, { newClientName: newName.trim() })
                    }
                    className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {picked
                      ? `Vincular a ${data.clients.find((c) => c.id === picked)?.name ?? "cliente"}`
                      : `Criar “${newName.trim() || s.title}” e vincular`}
                  </button>
                  {s.client && (
                    <button
                      onClick={() => patch(s.id, { clientCompanyId: null })}
                      className="px-3 py-2 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-red-300 hover:border-red-500/40 text-sm flex items-center gap-1.5"
                    >
                      <Unlink className="w-3.5 h-3.5" /> Desvincular
                    </button>
                  )}
                  <button onClick={() => setLinking(null)} className="px-2 py-2 text-slate-500 hover:text-white text-sm">
                    Cancelar
                  </button>
                </div>
              )}

              {/* Checkpoints */}
              <div className="mt-3 pt-3 border-t border-[#1e2d45] flex items-center gap-4 flex-wrap">
                {CHECKPOINTS.map((cp) => {
                  const value = s[cp.key];
                  const ok = isDone(s, cp);
                  return (
                    <label key={cp.key} className="flex items-center gap-1.5">
                      <span className={`text-[11px] ${ok ? "text-emerald-400" : "text-slate-500"}`}>
                        {cp.label}
                      </span>
                      <select
                        value={value}
                        onChange={(e) => patch(s.id, { [cp.key]: e.target.value })}
                        className={`${selectCls} ${
                          ok
                            ? "border-emerald-500/30 text-emerald-300"
                            : "border-amber-500/30 text-amber-300"
                        }`}
                      >
                        {cp.options.map((o) => (
                          <option key={o} value={o}>{STATUS_LABEL[cp.key][o]}</option>
                        ))}
                      </select>
                    </label>
                  );
                })}

                <label className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[11px] text-slate-500">Tipo</span>
                  <select
                    value={s.kind}
                    onChange={(e) => patch(s.id, { kind: e.target.value })}
                    className={`${selectCls} border-[#1e2d45] text-slate-300`}
                  >
                    <option value="PONTUAL">Pontual</option>
                    <option value="RECORRENTE">Recorrente</option>
                  </select>
                </label>

                {/* Saída manual da esteira: entrada indevida (ganho por engano,
                    teste, duplicata) precisa de um jeito de sumir — a remoção
                    automática só age na reabertura e só se ninguém encostou. */}
                <button
                  onClick={() => remove(s)}
                  disabled={busy === s.id}
                  title="Excluir da esteira"
                  className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
