"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Award, ChevronLeft, ChevronRight, Plus, Check, Trash2, X, Loader2, Repeat, Package,
} from "lucide-react";
import FinanceiroTabs from "../FinanceiroTabs";
import { brlFromCents, monthLabel } from "../lib";

export interface BonificacaoData {
  month: string;
  prevMonth: string;
  nextMonth: string;
  colaboradores: { id: string; nome: string }[];
  recorrentes: { id: string; cliente: string; label: string; tipo: string; amountCents: number; faturado: boolean }[];
  pontuais: { id: string; titulo: string; cliente: string | null; valorCents: number; entregueEm: string }[];
  lancados: {
    id: string; nome: string; amountCents: number; pago: boolean;
    origem: { tipo: "venda" | "contrato" | "avulso"; id: string; descricao: string };
  }[];
}

const card = "bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5";
const input =
  "bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

export default function BonificacaoPanel({ data }: { data: BonificacaoData | null }) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Origem escolhida pra lançar: qual linha está com o formulário aberto.
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [quem, setQuem] = useState("");
  const [quanto, setQuanto] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);

  if (!data) {
    return (
      <div className="p-6 space-y-5">
        <h1 className="text-white font-bold text-xl">Bonificação</h1>
        <FinanceiroTabs />
        <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl px-5 py-4 text-sm text-amber-200">
          Esta sessão não está vinculada a uma empresa. Entre com a conta da agência.
        </div>
      </div>
    );
  }

  const toCents = (v: string) => {
    const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };

  async function lancar(origem: { saleId?: string; clientServiceId?: string }) {
    if (!quem) { setErro("Escolha o colaborador."); return; }
    setOcupado("novo");
    setErro("");
    const colab = data!.colaboradores.find((c) => c.id === quem);
    const res = await fetch("/api/financeiro/bonificacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: data!.month,
        ...origem,
        ...(colab ? { userId: colab.id } : { name: quem }),
        amountCents: toCents(quanto),
      }),
    });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível lançar.");
      return;
    }
    setAbrindo(null); setQuem(""); setQuanto("");
    router.refresh();
  }

  async function alterar(id: string, body: Record<string, unknown>) {
    setOcupado(id); setErro("");
    const res = await fetch("/api/financeiro/bonificacao", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    setOcupado(null);
    if (!res.ok) { setErro("Não foi possível salvar."); return; }
    router.refresh();
  }

  async function remover(id: string) {
    setOcupado(id);
    await fetch(`/api/financeiro/bonificacao?id=${id}`, { method: "DELETE" });
    setOcupado(null);
    router.refresh();
  }

  // Totais por colaborador — é o número que vira pagamento no mês seguinte.
  const porColaborador = (() => {
    const m = new Map<string, { total: number; pago: number }>();
    for (const b of data.lancados) {
      const cur = m.get(b.nome) ?? { total: 0, pago: 0 };
      cur.total += b.amountCents;
      if (b.pago) cur.pago += b.amountCents;
      m.set(b.nome, cur);
    }
    return [...m].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.total - a.total);
  })();

  const totalMes = porColaborador.reduce((s, c) => s + c.total, 0);
  const totalPago = porColaborador.reduce((s, c) => s + c.pago, 0);

  const tipos = [...new Set(data.recorrentes.map((r) => r.tipo))].sort();
  const recorrentesVisiveis = data.recorrentes.filter((r) => !filtroTipo || r.tipo === filtroTipo);

  // Origem que já tem lançamento: some da lista de candidatos, pra não lançar
  // duas vezes sem perceber.
  const jaLancado = new Set(data.lancados.map((b) => `${b.origem.tipo}:${b.origem.id}`));

  function FormLancar({ origem, chave }: { origem: { saleId?: string; clientServiceId?: string }; chave: string }) {
    if (abrindo !== chave) {
      return (
        <button
          onClick={() => { setAbrindo(chave); setQuem(""); setQuanto(""); setErro(""); }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-xs hover:bg-indigo-500/20 flex-shrink-0"
        >
          <Plus className="w-3 h-3" /> Bonificar
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <select value={quem} onChange={(e) => setQuem(e.target.value)} className={input}>
          <option value="">Colaborador…</option>
          {data!.colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <input value={quanto} onChange={(e) => setQuanto(e.target.value)} placeholder="0,00" className={input + " w-24"} />
        <button
          onClick={() => lancar(origem)}
          disabled={ocupado === "novo"}
          className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs flex items-center gap-1"
        >
          {ocupado === "novo" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Lançar
        </button>
        <button onClick={() => setAbrindo(null)} className="text-slate-500 hover:text-white text-xs">Cancelar</button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            Bonificação
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Contrato mensal bonifica quando é faturado; serviço pontual, quando é entregue.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/financeiro/bonificacao?mes=${data.prevMonth}`} className="p-2 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <span className="px-3 py-1.5 text-sm text-white font-medium min-w-[150px] text-center">{monthLabel(data.month)}</span>
          <Link href={`/financeiro/bonificacao?mes=${data.nextMonth}`} className="p-2 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500">
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <FinanceiroTabs />

      {erro && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-lg px-4 py-3 text-sm text-red-300 flex items-center justify-between">
          {erro}
          <button onClick={() => setErro("")}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Fechamento do mês */}
      <div className={card}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-sm">A pagar em {monthLabel(data.month)}</h2>
          <span className="text-sm">
            <b className="text-amber-400">{brlFromCents(totalMes - totalPago)}</b>
            <span className="text-slate-600"> em aberto · {brlFromCents(totalPago)} pago</span>
          </span>
        </div>
        {porColaborador.length === 0 ? (
          <p className="text-slate-600 text-sm py-3">Nada lançado nesta competência ainda.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {porColaborador.map((c) => (
              <div key={c.nome} className="px-3 py-2 rounded-lg bg-white/[0.02]">
                <div className="text-sm text-white">{c.nome}</div>
                <div className="text-lg font-bold text-amber-400">{brlFromCents(c.total)}</div>
                {c.pago > 0 && (
                  <div className="text-[11px] text-emerald-400/80">{brlFromCents(c.pago)} já pago</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lançamentos */}
      {data.lancados.length > 0 && (
        <div className={card}>
          <h2 className="text-white font-semibold text-sm mb-3">Lançamentos ({data.lancados.length})</h2>
          <div className="space-y-1.5">
            {data.lancados.map((b) => (
              <div key={b.id} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.02] ${ocupado === b.id ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <div className="text-sm text-white">
                    {b.nome}
                    <span className="text-slate-600 text-xs ml-2">
                      {b.origem.tipo === "contrato" ? "contrato" : "venda"} · {b.origem.descricao}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-sm font-medium ${b.pago ? "text-emerald-400" : "text-amber-400"}`}>
                    {brlFromCents(b.amountCents)}
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={b.pago}
                      onChange={(e) => alterar(b.id, { paid: e.target.checked })}
                      className="accent-emerald-500"
                    />
                    pago
                  </label>
                  <button onClick={() => remover(b.id)} className="text-slate-600 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contratos mensais faturados */}
      <div className={card}>
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Repeat className="w-4 h-4 text-indigo-400" />
            Contratos do mês
          </h2>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setFiltroTipo(null)}
              className={`px-2 py-1 rounded text-[11px] border ${!filtroTipo ? "border-indigo-500/40 bg-indigo-500/10 text-white" : "border-[#1e2d45] text-slate-500"}`}
            >
              Todos
            </button>
            {tipos.map((t) => (
              <button
                key={t}
                onClick={() => setFiltroTipo(t)}
                className={`px-2 py-1 rounded text-[11px] border ${filtroTipo === t ? "border-indigo-500/40 bg-indigo-500/10 text-white" : "border-[#1e2d45] text-slate-500"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-600 mb-3">
          Bonifica quando está faturado e o cliente ativo — entregue ou não. Hospedagem normalmente
          não bonifica; use os filtros pra separar.
        </p>
        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {recorrentesVisiveis.map((r) => (
            <div
              key={r.id}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg ${
                jaLancado.has(`contrato:${r.id}`) ? "bg-emerald-500/[0.04]" : "bg-white/[0.02]"
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm text-slate-200 truncate">{r.cliente}</div>
                <div className="text-xs text-slate-600 truncate">
                  {r.label} · {brlFromCents(r.amountCents)}
                  {r.faturado
                    ? <span className="text-emerald-400/80"> · faturado</span>
                    : <span className="text-amber-500/80"> · não faturado</span>}
                </div>
              </div>
              {jaLancado.has(`contrato:${r.id}`) ? (
                <span className="text-[11px] text-emerald-400 flex-shrink-0">lançado</span>
              ) : (
                <FormLancar origem={{ clientServiceId: r.id }} chave={`c-${r.id}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Vendas pontuais entregues */}
      <div className={card}>
        <h2 className="text-white font-semibold text-sm flex items-center gap-2 mb-1">
          <Package className="w-4 h-4 text-emerald-400" />
          Serviços pontuais entregues no mês
        </h2>
        <p className="text-xs text-slate-600 mb-3">
          Vem da esteira: venda com produção marcada como <b>Entregue</b> nesta competência.
        </p>
        {data.pontuais.length === 0 ? (
          <p className="text-slate-600 text-sm py-3">
            Nenhuma entrega marcada neste mês. Marque a produção como &ldquo;Entregue&rdquo; na esteira.
          </p>
        ) : (
          <div className="space-y-1">
            {data.pontuais.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.02]">
                <div className="min-w-0">
                  <div className="text-sm text-slate-200 truncate">
                    {v.titulo}
                    {v.cliente && <span className="text-slate-600 text-xs ml-2">{v.cliente}</span>}
                  </div>
                  <div className="text-xs text-slate-600">
                    vendido por {brlFromCents(v.valorCents)} · entregue {new Date(v.entregueEm).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                {/* Pontual aceita MAIS DE UM colaborador: o botão continua
                    disponível mesmo depois do primeiro lançamento. */}
                <FormLancar origem={{ saleId: v.id }} chave={`v-${v.id}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
