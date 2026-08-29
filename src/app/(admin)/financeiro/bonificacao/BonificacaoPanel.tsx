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
    id: string; nome: string; amountCents: number; serviceValueCents: number;
    pago: boolean; pagoEm: string | null;
    origem: { tipo: "venda" | "contrato" | "avulso"; id: string; descricao: string };
  }[];
}

const card = "bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5";

/**
 * Mês em que a bonificação foi PAGA — que normalmente não é a competência.
 * Bonificação de agosto sai em setembro, e sem mostrar isso a lista fica
 * ambígua sobre qual pagamento já saiu.
 */
function mesCurto(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");
}
const input =
  "bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

export default function BonificacaoPanel({ data }: { data: BonificacaoData | null }) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Origem escolhida pra lançar: qual linha está com o formulário aberto.
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [quem, setQuem] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);
  // Serviço avulso: bonificação sem venda nem contrato de origem (um extra
  // combinado por fora). Descrição identifica; valor do serviço é manual.
  const [avulsoAberto, setAvulsoAberto] = useState(false);
  const [avulsoDesc, setAvulsoDesc] = useState("");
  const [avulsoValor, setAvulsoValor] = useState("");

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
      }),
    });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível lançar.");
      return;
    }
    setAbrindo(null); setQuem("");
    router.refresh();
  }

  async function lancarAvulso() {
    if (!quem) { setErro("Escolha o colaborador."); return; }
    if (!avulsoDesc.trim()) { setErro("Descreva o serviço avulso."); return; }
    setOcupado("avulso");
    setErro("");
    const colab = data!.colaboradores.find((c) => c.id === quem);
    const res = await fetch("/api/financeiro/bonificacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: data!.month,
        notes: avulsoDesc.trim(),
        serviceValueCents: toCents(avulsoValor),
        ...(colab ? { userId: colab.id } : { name: quem }),
      }),
    });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível lançar.");
      return;
    }
    setAvulsoAberto(false); setAvulsoDesc(""); setAvulsoValor(""); setQuem("");
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
    const m = new Map<string, { total: number; pago: number; pagoEm: string | null }>();
    for (const b of data.lancados) {
      const cur = m.get(b.nome) ?? { total: 0, pago: 0, pagoEm: null as string | null };
      cur.total += b.amountCents;
      if (b.pago) {
        cur.pago += b.amountCents;
        // Guarda o pagamento mais recente: se saiu em parcelas, o que interessa
        // saber de relance é quando foi a última.
        if (!cur.pagoEm || (b.pagoEm && b.pagoEm > cur.pagoEm)) cur.pagoEm = b.pagoEm;
      }
      m.set(b.nome, cur);
    }
    return [...m].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.total - a.total);
  })();

  const totalMes = porColaborador.reduce((s, c) => s + c.total, 0);
  const totalPago = porColaborador.reduce((s, c) => s + c.pago, 0);

  const tipos = [...new Set(data.recorrentes.map((r) => r.tipo))].sort();
  const recorrentesVisiveis = data.recorrentes.filter((r) => !filtroTipo || r.tipo === filtroTipo);

  // Lançamentos por origem, mostrados na própria linha pra você ver quem já
  // recebeu sem descer até a lista.
  //
  // Qualquer origem aceita VÁRIOS colaboradores — o valor do serviço pode ser
  // dividido entre quem trabalhou nele. A trava contra pagar duas vezes é por
  // (origem, colaborador, mês), no servidor: a mesma pessoa não entra duas
  // vezes na mesma origem.
  const lancadosPorOrigem = new Map<string, { nome: string; amountCents: number; pago: boolean; pagoEm: string | null }[]>();
  for (const b of data.lancados) {
    const chave = `${b.origem.tipo}:${b.origem.id}`;
    const lista = lancadosPorOrigem.get(chave) ?? [];
    lista.push({ nome: b.nome, amountCents: b.amountCents, pago: b.pago, pagoEm: b.pagoEm });
    lancadosPorOrigem.set(chave, lista);
  }

  function JaLancados({ chave }: { chave: string }) {
    const lista = lancadosPorOrigem.get(chave);
    if (!lista?.length) return null;
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {lista.map((l, i) => (
          <span
            key={i}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              l.pago ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
            }`}
          >
            {l.nome} · {brlFromCents(l.amountCents)}
            {l.pagoEm && ` · pago ${mesCurto(l.pagoEm)}`}
          </span>
        ))}
      </div>
    );
  }

  function FormLancar({ origem, chave }: { origem: { saleId?: string; clientServiceId?: string }; chave: string }) {
    if (abrindo !== chave) {
      return (
        <button
          onClick={() => { setAbrindo(chave); setQuem(""); setErro(""); }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-xs hover:bg-indigo-500/20 flex-shrink-0"
        >
          <Plus className="w-3 h-3" /> Bonificar
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        {/* Só o colaborador. O valor da bonificação você calcula depois e lança
            na lista — aqui só se registra QUEM entra no fechamento. */}
        <select value={quem} onChange={(e) => setQuem(e.target.value)} className={input}>
          <option value="">Colaborador…</option>
          {data!.colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
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
                  <div className="text-[11px] text-emerald-400/80">
                    {brlFromCents(c.pago)} já pago
                    {c.pagoEm && <span className="text-slate-600"> · {mesCurto(c.pagoEm)}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lançamentos */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-white font-semibold text-sm">Lançamentos ({data.lancados.length})</h2>
          {!avulsoAberto && (
            <button
              onClick={() => { setAvulsoAberto(true); setQuem(""); setErro(""); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-xs hover:bg-indigo-500/20"
            >
              <Plus className="w-3 h-3" /> Lançar avulso
            </button>
          )}
        </div>

        {/* Serviço que não está na esteira nem nos contratos — lançado à mão. */}
        {avulsoAberto && (
          <div className="mb-3 pb-3 border-b border-[#1e2d45] flex items-end gap-2 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">Colaborador</span>
              <select value={quem} onChange={(e) => setQuem(e.target.value)} className={input}>
                <option value="">Escolha…</option>
                {data.colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <span className="text-[11px] text-slate-500">Descrição do serviço</span>
              <input
                value={avulsoDesc}
                onChange={(e) => setAvulsoDesc(e.target.value)}
                placeholder="Ex: ajuste no site fora do contrato"
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">Valor do serviço</span>
              <input
                value={avulsoValor}
                onChange={(e) => setAvulsoValor(e.target.value)}
                placeholder="0,00"
                className={input + " w-28 text-right"}
              />
            </label>
            <button
              onClick={lancarAvulso}
              disabled={ocupado === "avulso"}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs flex items-center gap-1"
            >
              {ocupado === "avulso" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Lançar
            </button>
            <button onClick={() => setAvulsoAberto(false)} className="text-slate-500 hover:text-white text-xs pb-1.5">Cancelar</button>
          </div>
        )}

        {data.lancados.length === 0 ? (
          <p className="text-slate-600 text-sm py-2">
            Nada lançado nesta competência. Use &ldquo;Bonificar&rdquo; nas listas abaixo, ou
            &ldquo;Lançar avulso&rdquo; pra um serviço fora delas.
          </p>
        ) : (
          <div className="space-y-1.5">
            {data.lancados.map((b) => (
              <div key={b.id} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.02] ${ocupado === b.id ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <div className="text-sm text-white">
                    {b.nome}
                    <span className="text-slate-600 text-xs ml-2">
                      {b.origem.tipo === "contrato" ? "contrato" : b.origem.tipo === "venda" ? "venda" : "avulso"} · {b.origem.descricao}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[11px] text-slate-500">
                    serviço <b className="text-slate-400 font-medium">{brlFromCents(b.serviceValueCents)}</b>
                  </span>
                  {/* A bonificação é digitada aqui: é o número que você calcula
                      fora e lança. Salva ao sair do campo. */}
                  <label className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">bonif.</span>
                    <input
                      defaultValue={b.amountCents ? (b.amountCents / 100).toFixed(2).replace(".", ",") : ""}
                      onBlur={(e) => {
                        const novo = toCents(e.target.value);
                        if (novo !== b.amountCents) alterar(b.id, { amountCents: novo });
                      }}
                      placeholder="0,00"
                      className={input + ` w-24 text-right ${b.pago ? "text-emerald-400" : "text-amber-400"}`}
                    />
                  </label>
                  {b.pagoEm && (
                    <span className="text-[11px] text-emerald-400/70">pago em {mesCurto(b.pagoEm)}</span>
                  )}
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
        )}
      </div>

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
              className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.02]"
            >
              <div className="min-w-0">
                <div className="text-sm text-slate-200 truncate">{r.cliente}</div>
                <div className="text-xs text-slate-600 truncate">
                  {r.label} · {brlFromCents(r.amountCents)}
                  {r.faturado
                    ? <span className="text-emerald-400/80"> · faturado</span>
                    : <span className="text-amber-500/80"> · não faturado</span>}
                </div>
                <JaLancados chave={`contrato:${r.id}`} />
              </div>
              <FormLancar origem={{ clientServiceId: r.id }} chave={`c-${r.id}`} />
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
                  <JaLancados chave={`venda:${v.id}`} />
                </div>
    
                <FormLancar origem={{ saleId: v.id }} chave={`v-${v.id}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
