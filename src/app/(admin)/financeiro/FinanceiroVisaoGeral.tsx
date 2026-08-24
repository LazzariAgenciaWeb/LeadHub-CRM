"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Wallet, Repeat, FileText, AlertTriangle, Target, TrendingUp,
  ChevronLeft, ChevronRight, Check, Pencil, ArrowRight, ListChecks,
} from "lucide-react";
import FinanceiroTabs from "./FinanceiroTabs";
import { brlFromCents, CYCLE_LABEL, monthLabel, type Cycle } from "./lib";

export interface VisaoGeralData {
  esteira: { semCliente: number; semContrato: number; semFatura: number; semProducao: number };
  month: string;
  prevMonth: string;
  nextMonth: string;
  isGlobal: boolean;
  canSetTarget: boolean;
  carteira: { clientes: number; contratosAtivos: number; mrrCents: number };
  competencia: {
    previstoCents: number;
    faturadoCents: number;
    faltaFaturarCents: number;
    recebidoCents: number;
    recebidoQtd: number;
    aVencerCents: number;
    atrasadoCents: number;
    atrasadoQtd: number;
  };
  pendentes: {
    id: string; label: string; cliente: string; clienteId: string;
    amountCents: number; cycle: string;
  }[];
  comercial: {
    abertoCents: number; abertoQtd: number;
    ganhoCents: number; ganhoQtd: number;
    perdaCents: number; perdaQtd: number;
    leadsNoMes: number; promovidosNoMes: number;
  };
  meta: { revenueTargetCents: number; newSalesTargetCents: number };
}

const card = "bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5";
const input =
  "bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

/** Percentual seguro: sem meta definida não existe progresso, e sim ausência dele. */
function pct(atual: number, meta: number): number | null {
  if (meta <= 0) return null;
  return Math.round((atual / meta) * 100);
}

function Metric({
  label, value, hint, tone = "slate", Icon,
}: {
  label: string; value: string; hint?: string;
  tone?: "slate" | "green" | "amber" | "red" | "indigo";
  Icon?: typeof Wallet;
}) {
  const toneCls = {
    slate: "text-white",
    green: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
    indigo: "text-indigo-400",
  }[tone];
  return (
    <div className={card}>
      <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wide">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold ${toneCls}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${p}%` }} />
    </div>
  );
}

function Pendencia({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${n > 0 ? "text-amber-400" : "text-slate-600"}`}>{n}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function FinanceiroVisaoGeral({ data }: { data: VisaoGeralData }) {
  const router = useRouter();
  const { competencia: c, comercial: v, carteira, meta } = data;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fRevenue, setFRevenue] = useState((meta.revenueTargetCents / 100).toFixed(2).replace(".", ","));
  const [fSales, setFSales] = useState((meta.newSalesTargetCents / 100).toFixed(2).replace(".", ","));

  function toCents(s: string) {
    const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  async function saveMeta() {
    setSaving(true);
    const res = await fetch("/api/financeiro/meta", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: data.month,
        revenueTargetCents: toCents(fRevenue),
        newSalesTargetCents: toCents(fSales),
      }),
    });
    setSaving(false);
    if (res.ok) { setEditing(false); router.refresh(); }
  }

  // Realizado do faturamento na competência: o que foi lançado pro mês.
  const pctFaturamento = pct(c.faturadoCents, meta.revenueTargetCents);
  const pctVendas = pct(v.ganhoCents, meta.newSalesTargetCents);

  // Conversões. Coortes diferentes (quem entrou no mês × quem foi promovido no
  // mês), então é indicador de ritmo, não de destino de um mesmo grupo — o
  // rótulo abaixo diz isso explicitamente pra ninguém ler como funil fechado.
  const convLeadOp = v.leadsNoMes > 0 ? Math.round((v.promovidosNoMes / v.leadsNoMes) * 100) : null;
  const decididos = v.ganhoQtd + v.perdaQtd;
  const winRate = decididos > 0 ? Math.round((v.ganhoQtd / decididos) * 100) : null;

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      {/* Cabeçalho + navegação de competência */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-400" />
            Financeiro
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Previsão, cobrança e resultado comercial da competência.
            {data.isGlobal && <span className="ml-1 text-indigo-400">Visão global (todas as carteiras).</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/financeiro?mes=${data.prevMonth}`} className="p-2 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <span className="px-3 py-1.5 text-sm text-white font-medium min-w-[150px] text-center">
            {monthLabel(data.month)}
          </span>
          <Link href={`/financeiro?mes=${data.nextMonth}`} className="p-2 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <FinanceiroTabs />

      {/* Linha 1 — a competência */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric
          Icon={Repeat} label="Previsto no mês" tone="indigo"
          value={brlFromCents(c.previstoCents)}
          hint="Contratos recorrentes que vencem nesta competência"
        />
        <Metric
          Icon={FileText} label="Já faturado" tone="slate"
          value={brlFromCents(c.faturadoCents)}
          hint={`Cobranças lançadas com competência ${data.month}`}
        />
        <Metric
          Icon={AlertTriangle} label="Falta faturar"
          tone={c.faltaFaturarCents > 0 ? "amber" : "green"}
          value={brlFromCents(c.faltaFaturarCents)}
          hint={
            data.pendentes.length > 0
              ? `${data.pendentes.length} contrato(s) sem cobrança no mês`
              : "Nenhum contrato recorrente em aberto"
          }
        />
        <Metric
          Icon={Wallet} label="Recebido" tone="green"
          value={brlFromCents(c.recebidoCents)}
          hint={`${c.recebidoQtd} baixa(s) no mês · ${brlFromCents(c.aVencerCents)} a vencer`}
        />
      </div>

      {/* Atrasados — só aparece quando existe, pra não virar ruído */}
      {c.atrasadoCents > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl px-5 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-300">
            <b>{brlFromCents(c.atrasadoCents)}</b> vencidos e não pagos
            <span className="text-red-400/70"> · {c.atrasadoQtd} cobrança(s)</span>
          </span>
        </div>
      )}

      {/* Meta */}
      <div className={card}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-indigo-400" />
            Meta de {monthLabel(data.month)}
          </h2>
          {data.canSetTarget && !editing && (
            <button onClick={() => setEditing(true)} className="text-slate-400 hover:text-white text-xs flex items-center gap-1">
              <Pencil className="w-3 h-3" /> Definir
            </button>
          )}
        </div>

        {editing ? (
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Meta de faturamento (R$)</span>
              <input className={input} value={fRevenue} onChange={(e) => setFRevenue(e.target.value)} placeholder="0,00" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Meta de vendas novas (R$)</span>
              <input className={input} value={fSales} onChange={(e) => setFSales(e.target.value)} placeholder="0,00" />
            </label>
            <button
              onClick={saveMeta}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> {saving ? "Salvando…" : "Salvar"}
            </button>
            <button onClick={() => setEditing(false)} className="px-3 py-2 text-slate-400 hover:text-white text-sm">
              Cancelar
            </button>
          </div>
        ) : meta.revenueTargetCents === 0 && meta.newSalesTargetCents === 0 ? (
          <p className="text-slate-500 text-sm">
            {data.canSetTarget
              ? "Sem meta definida para este mês."
              : "Meta é definida por agência — entre com a conta da agência para configurar."}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs text-slate-400">Faturamento</span>
                <span className="text-xs text-slate-500">
                  {brlFromCents(c.faturadoCents)} de {brlFromCents(meta.revenueTargetCents)}
                </span>
              </div>
              <Bar value={c.faturadoCents} max={meta.revenueTargetCents} tone="bg-emerald-500" />
              <div className="mt-1.5 text-xs">
                {pctFaturamento === null ? (
                  <span className="text-slate-600">sem meta</span>
                ) : pctFaturamento >= 100 ? (
                  <span className="text-emerald-400 font-medium">Meta batida ({pctFaturamento}%)</span>
                ) : (
                  <span className="text-slate-400">
                    {pctFaturamento}% · faltam{" "}
                    <b className="text-white">{brlFromCents(meta.revenueTargetCents - c.faturadoCents)}</b>
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs text-slate-400">Vendas novas (comercial)</span>
                <span className="text-xs text-slate-500">
                  {brlFromCents(v.ganhoCents)} de {brlFromCents(meta.newSalesTargetCents)}
                </span>
              </div>
              <Bar value={v.ganhoCents} max={meta.newSalesTargetCents} tone="bg-indigo-500" />
              <div className="mt-1.5 text-xs">
                {pctVendas === null ? (
                  <span className="text-slate-600">sem meta</span>
                ) : pctVendas >= 100 ? (
                  <span className="text-indigo-300 font-medium">Meta batida ({pctVendas}%)</span>
                ) : (
                  <span className="text-slate-400">
                    {pctVendas}% · faltam{" "}
                    <b className="text-white">{brlFromCents(meta.newSalesTargetCents - v.ganhoCents)}</b>
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fila de faturamento */}
        <div className={card}>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-white font-semibold text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-400" />
              A faturar neste mês
            </h2>
            <span className="text-xs text-slate-500">
              {carteira.contratosAtivos} contrato(s) ativo(s)
            </span>
          </div>
          <p className="text-xs text-slate-600 mb-4">
            Contratos recorrentes sem cobrança lançada na competência. Lista derivada —
            some sozinha quando a cobrança é criada.
          </p>

          {data.pendentes.length === 0 ? (
            <div className="py-8 text-center text-slate-600 text-sm">
              {carteira.contratosAtivos === 0
                ? "Nenhum contrato recorrente cadastrado ainda."
                : "Tudo faturado nesta competência."}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
              {data.pendentes.map((p) => (
                <Link
                  key={p.id}
                  href={`/empresas/${p.clienteId}#financeiro`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-transparent hover:border-[#1e2d45] transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-white truncate">{p.cliente}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {p.label}
                      <span className="text-slate-600"> · {CYCLE_LABEL[(p.cycle as Cycle)] ?? p.cycle}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm text-amber-400 font-medium">{brlFromCents(p.amountCents)}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-indigo-400 transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Comercial */}
        <div className={card}>
          <h2 className="text-white font-semibold text-sm flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-indigo-400" />
            Comercial
          </h2>

          <div className="grid grid-cols-3 gap-3 mb-5">
            <div>
              <div className="text-xs text-slate-500">Em aberto</div>
              <div className="text-lg font-bold text-white">{brlFromCents(v.abertoCents)}</div>
              <div className="text-[11px] text-slate-600">{v.abertoQtd} oportunidade(s)</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Ganho no mês</div>
              <div className="text-lg font-bold text-emerald-400">{brlFromCents(v.ganhoCents)}</div>
              <div className="text-[11px] text-slate-600">{v.ganhoQtd} venda(s)</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Perdido no mês</div>
              <div className="text-lg font-bold text-red-400/90">{brlFromCents(v.perdaCents)}</div>
              <div className="text-[11px] text-slate-600">{v.perdaQtd} perda(s)</div>
            </div>
          </div>

          <div className="border-t border-[#1e2d45] pt-4 space-y-3">
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-slate-400">Leads → Oportunidades</span>
                <span className="text-white font-medium">
                  {convLeadOp === null ? "—" : `${convLeadOp}%`}
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                {v.promovidosNoMes} promovido(s) no mês · {v.leadsNoMes} lead(s) entraram no funil
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-slate-400">Oportunidades → Venda</span>
                <span className="text-white font-medium">
                  {winRate === null ? "—" : `${winRate}%`}
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                {v.ganhoQtd} ganho(s) de {decididos} decidida(s) no mês
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
              As duas taxas comparam grupos diferentes (quem entrou no mês × quem foi
              decidido no mês). Servem pra ritmo, não pra rastrear uma mesma safra.
            </p>
          </div>
        </div>
      </div>

      {/* Esteira — resumo; o detalhe vive na aba própria */}
      <Link
        href="/financeiro/esteira"
        className={`${card} block hover:border-indigo-500/40 transition-colors`}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-indigo-400" />
            Esteira pós-venda
          </h2>
          <span className="text-xs text-indigo-400 flex items-center gap-1">
            abrir <ArrowRight className="w-3 h-3" />
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Pendencia label="Sem cliente vinculado" n={data.esteira.semCliente} />
          <Pendencia label="Falta contrato" n={data.esteira.semContrato} />
          <Pendencia label="Falta faturar" n={data.esteira.semFatura} />
          <Pendencia label="Falta entregar" n={data.esteira.semProducao} />
        </div>
        <p className="text-[11px] text-slate-600 mt-3">
          Contagem sobre todas as vendas, não só as do mês — pendência antiga continua sendo pendência.
        </p>
      </Link>

      {/* Carteira */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric label="Clientes na carteira" value={String(carteira.clientes)} />
        <Metric label="Contratos recorrentes ativos" value={String(carteira.contratosAtivos)} />
        <Metric
          Icon={Repeat} label="Recorrência (base mensal)" tone="indigo"
          value={brlFromCents(carteira.mrrCents)}
          hint="Valor mensal equivalente — anual e trimestral entram rateados"
        />
      </div>
    </div>
  );
}
