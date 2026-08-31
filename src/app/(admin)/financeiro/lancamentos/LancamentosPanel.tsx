"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Receipt, Repeat, FileText, AlertTriangle, TrendingUp,
  ChevronLeft, ChevronRight, Check, ArrowRight, Info,
} from "lucide-react";
import FinanceiroTabs from "../FinanceiroTabs";
import { brlFromCents, CYCLE_LABEL, monthLabel, type Cycle } from "../lib";

export interface LancamentosData {
  month: string;
  prevMonth: string;
  nextMonth: string;
  contratosAtivos: number;
  competencia: { previstoCents: number; faturadoCents: number; faltaFaturarCents: number };
  pendentes: {
    id: string; label: string; cliente: string; clienteId: string;
    amountCents: number; cycle: string;
    /** Dia do vencimento combinado no contrato. Null = usa o dia do lote. */
    billingDay: number | null;
    /** Particularidades da cobrança deste cliente (NF no mês, Pix, avisar…). */
    obs: string | null;
    /** Telefone (só dígitos) do contato financeiro — atalho pro WhatsApp. */
    whatsapp: string | null;
    contato: string | null;
  }[];
  /** Contratos ignorados NESTA competência, com motivo — decisão de não faturar. */
  ignorados: {
    skipId: string; serviceId: string; label: string; cliente: string;
    amountCents: number; reason: string | null; por: string | null;
  }[];
  /** Vendas fechadas na competência — inclui pontual, que não tem contrato. */
  vendasDoMes: {
    id: string; title: string; cliente: string | null;
    amountCents: number; kind: string;
    faturado: boolean; pago: boolean; marcadoSemCobranca: boolean;
  }[];
  pontualAFaturarCents: number;
}

const card = "bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5";
const input =
  "bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

export default function LancamentosPanel({ data }: { data: LancamentosData }) {
  const router = useRouter();
  const c = data.competencia;
  const vendasFaturadasCents = data.vendasDoMes
    .filter((s) => s.faturado)
    .reduce((n, s) => n + s.amountCents, 0);

  // Lançamento das cobranças recorrentes da competência. Antes só dava pra
  // criar uma a uma abrindo cada empresa — inviável com dezenas de contratos.
  const [faturando, setFaturando] = useState(false);
  const [dueDay, setDueDay] = useState("10");
  const [faturarErr, setFaturarErr] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [ignorando, setIgnorando] = useState<string | null>(null);
  const [motivoIgnorar, setMotivoIgnorar] = useState("");
  const [mostrarIgnorados, setMostrarIgnorados] = useState(false);

  async function ignorar(serviceId: string) {
    setFaturando(true);
    setFaturarErr("");
    try {
      const res = await fetch("/api/financeiro/ignorar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: data.month, serviceId, reason: motivoIgnorar }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setFaturarErr(e.error ?? "Não foi possível ignorar.");
        return;
      }
      setIgnorando(null);
      setMotivoIgnorar("");
      setSelecionados((prev) => {
        const next = new Set(prev);
        next.delete(serviceId);
        return next;
      });
      router.refresh();
    } finally {
      setFaturando(false);
    }
  }

  async function reverterIgnorado(skipId: string) {
    setFaturando(true);
    try {
      await fetch(`/api/financeiro/ignorar?id=${skipId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setFaturando(false);
    }
  }

  // A seleção sobrevive à navegação: a conferência é interrompida toda hora
  // (abrir a fatura de um cliente, conferir no Bling, voltar). Guardada por
  // competência no navegador; some ao faturar ou ao desmarcar tudo.
  const storageKey = `leadhub:faturar-selecionados:${data.month}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const ids = raw ? (JSON.parse(raw) as string[]) : [];
      const validos = new Set(data.pendentes.map((p) => p.id));
      setSelecionados(new Set(ids.filter((id) => validos.has(id))));
    } catch {
      setSelecionados(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    try {
      if (selecionados.size === 0) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify([...selecionados]));
    } catch {
      // navegador sem storage (aba privada restrita) — segue só em memória
    }
  }, [selecionados, storageKey]);
  const toggle = (id: string) =>
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const marcados = data.pendentes.filter((p) => selecionados.has(p.id));
  const totalMarcadoCents = marcados.reduce((n, p) => n + p.amountCents, 0);
  // "Selecionar todos" opera sobre o VISÍVEL — buscar "clínica" e selecionar
  // marca só as clínicas, que é a intenção.
  const pendentesVisiveis = data.pendentes.filter(
    (p) =>
      !busca.trim() ||
      `${p.cliente} ${p.label}`.toLowerCase().includes(busca.trim().toLowerCase()),
  );
  const todosMarcados =
    pendentesVisiveis.length > 0 && pendentesVisiveis.every((p) => selecionados.has(p.id));

  async function faturar(serviceIds?: string[]) {
    setFaturando(true);
    setFaturarErr("");
    try {
      const res = await fetch("/api/financeiro/faturar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: data.month, dueDay: Number(dueDay) || 10, serviceIds }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setFaturarErr(e.error ?? "Não foi possível lançar as cobranças.");
        return;
      }
      setSelecionados(new Set());
      router.refresh();
    } finally {
      setFaturando(false);
    }
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      {/* Cabeçalho + navegação de competência */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Receipt className="w-5 h-5 text-amber-400" />
            Lançamentos do mês
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Fechamento da competência: faturar os contratos recorrentes e conferir as vendas.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/financeiro/lancamentos?mes=${data.prevMonth}`} className="p-2 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <span className="px-3 py-1.5 text-sm text-white font-medium min-w-[150px] text-center">
            {monthLabel(data.month)}
          </span>
          <Link href={`/financeiro/lancamentos?mes=${data.nextMonth}`} className="p-2 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <FinanceiroTabs />

      {/* Resumo da competência — contexto do fechamento, sem sair da tela */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={card}>
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wide">
            <Repeat className="w-3.5 h-3.5" /> Previsto no mês
          </div>
          <div className="mt-2 text-2xl font-bold text-indigo-400">{brlFromCents(c.previstoCents)}</div>
        </div>
        <div className={card}>
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wide">
            <FileText className="w-3.5 h-3.5" /> Já faturado
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{brlFromCents(c.faturadoCents)}</div>
        </div>
        <div className={card}>
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wide">
            <AlertTriangle className="w-3.5 h-3.5" /> Falta faturar
          </div>
          <div className={`mt-2 text-2xl font-bold ${c.faltaFaturarCents > 0 ? "text-amber-400" : "text-emerald-400"}`}>
            {brlFromCents(c.faltaFaturarCents)}
          </div>
        </div>
      </div>

      {/* Fila de faturamento */}
      <div className={card}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-400" />
            A faturar neste mês
          </h2>
          <span className="text-xs text-slate-500">
            {data.contratosAtivos} contrato(s) ativo(s)
          </span>
        </div>
        <p className="text-xs text-slate-600 mb-3">
          Contratos recorrentes sem cobrança lançada na competência. Lista derivada —
          some sozinha quando a cobrança é criada.
        </p>

        {/* Fechamento do mês: lança tudo de uma vez e depois confere o que
            sobrou na própria lista. Idempotente — repetir não duplica. */}
        {data.pendentes.length > 0 && (
          <div className="mb-3 flex flex-wrap items-end gap-2 pb-3 border-b border-[#1e2d45]">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">Vencimento (dia)</span>
              <input
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                className={`${input} w-20`}
              />
            </label>
            <button
              onClick={() => faturar(marcados.length > 0 ? marcados.map((p) => p.id) : undefined)}
              disabled={faturando}
              className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              {faturando
                ? "Lançando…"
                : marcados.length > 0
                  ? `Faturar selecionados (${marcados.length}) · ${brlFromCents(totalMarcadoCents)}`
                  : `Faturar todos (${data.pendentes.length})`}
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={todosMarcados}
                onChange={() =>
                  setSelecionados((prev) => {
                    const next = new Set(prev);
                    if (todosMarcados) pendentesVisiveis.forEach((p) => next.delete(p.id));
                    else pendentesVisiveis.forEach((p) => next.add(p.id));
                    return next;
                  })
                }
                className="accent-amber-500 w-3.5 h-3.5"
              />
              {todosMarcados ? "Limpar seleção" : busca.trim() ? "Selecionar visíveis" : "Selecionar todos"}
            </label>
            <span className="text-[11px] text-slate-600 basis-full">
              Cria as cobranças de {monthLabel(data.month)}. Contrato com dia de vencimento
              combinado usa o dia dele; o resto vence no dia {dueDay || "10"}.
              Contrato que já tem cobrança na competência é ignorado.
            </span>
            {faturarErr && (
              <span className="text-[11px] text-red-400 basis-full">{faturarErr}</span>
            )}
          </div>
        )}

        {data.pendentes.length > 0 && (
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente ou serviço…"
            className={`${input} w-full mb-2`}
          />
        )}

        {data.pendentes.length === 0 ? (
          <div className="py-8 text-center text-slate-600 text-sm">
            {data.contratosAtivos === 0
              ? "Nenhum contrato recorrente cadastrado ainda."
              : "Tudo faturado nesta competência."}
          </div>
        ) : pendentesVisiveis.length === 0 ? (
          <div className="py-8 text-center text-slate-600 text-sm">
            Nenhum contrato bate com a busca.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {pendentesVisiveis.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-colors group ${
                  selecionados.has(p.id)
                    ? "bg-amber-500/[0.07] border-amber-500/30"
                    : "bg-white/[0.02] border-transparent hover:border-[#1e2d45]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selecionados.has(p.id)}
                  onChange={() => toggle(p.id)}
                  className="accent-amber-500 w-3.5 h-3.5 flex-shrink-0"
                  aria-label={`Selecionar ${p.cliente} — ${p.label}`}
                />
                <Link href={`/empresas/${p.clienteId}#financeiro`} className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{p.cliente}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {p.label}
                    <span className="text-slate-600"> · {CYCLE_LABEL[(p.cycle as Cycle)] ?? p.cycle}</span>
                    {/* Vencimento que a cobrança vai receber — o do contrato
                        quando existe, senão o dia escolhido pro lote. */}
                    <span className={p.billingDay ? "text-slate-500" : "text-slate-600"}>
                      {" · vence dia "}{p.billingDay ?? (dueDay || "10")}
                      {!p.billingDay && " (padrão)"}
                    </span>
                  </div>
                  {/* Particularidade combinada com o cliente: aparece inteira,
                      sem truncar — instrução cortada pela metade é pior que
                      instrução nenhuma. */}
                  {p.obs && (
                    <div className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/25 px-2 py-1">
                      <Info className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                      <span className="text-[11px] text-amber-200/90 whitespace-pre-wrap">{p.obs}</span>
                    </div>
                  )}
                </Link>
                {ignorando === p.id ? (
                  /* Ignorar exige dizer POR QUÊ — é a diferença entre "faltou
                     faturar" e "decidimos não faturar" na conferência. */
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    <input
                      value={motivoIgnorar}
                      onChange={(e) => setMotivoIgnorar(e.target.value)}
                      placeholder="Motivo (ex.: cortesia da renovação)"
                      autoFocus
                      className={`${input} w-56 text-xs`}
                    />
                    <button
                      onClick={() => ignorar(p.id)}
                      disabled={faturando || !motivoIgnorar.trim()}
                      className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-600/40 text-slate-200 hover:bg-slate-500/40 disabled:opacity-40"
                    >
                      Ignorar no mês
                    </button>
                    <button onClick={() => { setIgnorando(null); setMotivoIgnorar(""); }} className="text-slate-500 hover:text-white text-[11px]">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm text-amber-400 font-medium">{brlFromCents(p.amountCents)}</span>
                    {/* Falar com o cliente sem sair da conferência: mandar o
                        Pix, avisar da nota. Abre a conversa já no contato
                        financeiro (ou o decisor, quando não há financeiro). */}
                    {p.whatsapp && (
                      <a
                        href={`https://wa.me/${p.whatsapp}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Falar com ${p.contato ?? "o cliente"} no WhatsApp`}
                        className="px-2 py-1 rounded-md text-[11px] font-medium text-green-400 bg-green-500/10 hover:bg-green-500/20 transition-colors"
                      >
                        💬
                      </a>
                    )}
                    {/* Lançar só este contrato — quando o mês não fecha em bloco. */}
                    <button
                      onClick={() => faturar([p.id])}
                      disabled={faturando}
                      title="Lançar a cobrança deste contrato"
                      className="px-2 py-1 rounded-md text-[11px] font-medium bg-white/5 text-slate-400 hover:bg-amber-500/15 hover:text-amber-300 disabled:opacity-40 transition-colors"
                    >
                      Faturar
                    </button>
                    <button
                      onClick={() => { setIgnorando(p.id); setMotivoIgnorar(""); }}
                      disabled={faturando}
                      title="Não faturar este contrato nesta competência (com motivo)"
                      className="px-2 py-1 rounded-md text-[11px] text-slate-600 hover:text-slate-300 hover:bg-white/5 disabled:opacity-40 transition-colors"
                    >
                      Ignorar
                    </button>
                    <Link href={`/empresas/${p.clienteId}#financeiro`} className="text-slate-700 group-hover:text-indigo-400 transition-colors">
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* O que foi decidido NÃO faturar neste mês — visível e com motivo,
            senão a conferência não distingue esquecimento de decisão. */}
        {data.ignorados.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#1e2d45]">
            <button
              onClick={() => setMostrarIgnorados((v) => !v)}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              {`${mostrarIgnorados ? "▾" : "▸"} ${data.ignorados.length} contrato(s) ignorado(s) nesta competência · ${brlFromCents(
                data.ignorados.reduce((n, i) => n + i.amountCents, 0),
              )}`}
            </button>
            {mostrarIgnorados && (
              <div className="mt-2 space-y-1">
                {data.ignorados.map((i) => (
                  <div key={i.skipId} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-white/[0.02]">
                    <div className="min-w-0">
                      <span className="text-xs text-slate-400">{i.cliente}</span>
                      <span className="text-xs text-slate-600"> · {i.label} · {brlFromCents(i.amountCents)}</span>
                      <div className="text-[11px] text-slate-500 truncate">
                        {i.reason ?? "sem motivo"}
                        {i.por && <span className="text-slate-700"> — {i.por}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => reverterIgnorado(i.skipId)}
                      disabled={faturando}
                      className="px-2 py-1 rounded-md text-[11px] text-emerald-400/80 hover:bg-emerald-500/10 disabled:opacity-40 flex-shrink-0"
                    >
                      voltar pra fila
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Vendas fechadas na competência */}
      <div className={card}>
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Vendas fechadas no mês
          </h2>
          <span className="text-xs text-slate-500">
            {data.vendasDoMes.length} venda(s) · {brlFromCents(vendasFaturadasCents)} faturado
            {data.pontualAFaturarCents > 0 && (
              <> · <span className="text-amber-400">{brlFromCents(data.pontualAFaturarCents)} a faturar</span></>
            )}
          </span>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Fechadas nesta competência. Marcar “Faturado” na esteira gera a cobrança e soma em “Já faturado”.
        </p>

        {data.vendasDoMes.length === 0 ? (
          <p className="text-sm text-slate-600 py-4 text-center">Nenhuma venda fechada neste mês.</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {data.vendasDoMes.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.02]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-slate-200 text-sm truncate">{s.title}</p>
                  <p className="text-slate-600 text-[11px] truncate">
                    {s.cliente ?? <span className="text-amber-500">sem cliente vinculado</span>}
                    {" · "}
                    {s.kind === "RECORRENTE" ? "Recorrente" : "Pontual"}
                  </p>
                </div>
                <span className="text-slate-300 text-sm font-medium shrink-0">
                  {brlFromCents(s.amountCents)}
                </span>
                <span className="shrink-0 w-28 text-right">
                  {s.pago ? (
                    <span className="text-[11px] text-emerald-400">✓ Pago</span>
                  ) : s.faturado ? (
                    <span className="text-[11px] text-sky-400">Faturado</span>
                  ) : s.marcadoSemCobranca ? (
                    <span className="text-[11px] text-amber-400" title="Marcado como faturado, mas sem cobrança — falta vincular o cliente">
                      ⚠ sem cobrança
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-600">A faturar</span>
                  )}
                </span>
                <Link
                  href="/financeiro/esteira"
                  className="shrink-0 text-slate-600 hover:text-indigo-400"
                  title="Abrir na esteira"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
