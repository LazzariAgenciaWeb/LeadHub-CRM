"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Award, ChevronLeft, ChevronRight, Plus, Check, Trash2, X, Loader2, Repeat, Package,
  Lock, Unlock, Copy,
} from "lucide-react";
import FinanceiroTabs from "../FinanceiroTabs";
import { brlFromCents, monthLabel } from "../lib";

export interface BonificacaoData {
  month: string;
  prevMonth: string;
  nextMonth: string;
  colaboradores: { id: string; nome: string }[];
  /** Encerramento da competência — presente = mês somente leitura. */
  fechamento: { closedAt: string; closedBy: string | null; totalCents: number; qtd: number } | null;
  /** Lançamentos de contrato no mês anterior, disponíveis pra replicar. */
  replicaveisMesAnterior: number;
  /** Reabrir é desfazer uma conferência — só administrador. */
  podeReabrir: boolean;
  recorrentes: { id: string; clienteId: string; cliente: string; label: string; tipo: string; amountCents: number; faturado: boolean }[];
  /** Serviços/vendas marcados como "não bonifica" — pra reverter sem ir ao cadastro. */
  naoBonificam: {
    id: string; tipo: "contrato" | "venda"; clienteId: string; nome: string;
    amountCents: number;
  }[];
  pontuais: {
    id: string; titulo: string; cliente: string | null; valorCents: number; entregueEm: string;
    responsavelId: string | null; responsavelNome: string | null;
  }[];
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
/** YYYY-MM-DD no fuso do navegador (toISOString usaria UTC e trocaria o dia). */
function dataLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const input =
  "bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

export default function BonificacaoPanel({ data }: { data: BonificacaoData | null }) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  // Resultado de ação que deu certo (ex.: "12 copiados") — separado do erro
  // pra não aparecer no banner vermelho.
  const [aviso, setAviso] = useState("");
  // Pontual com a data de entrega aberta pra edição.
  const [redatando, setRedatando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Origem escolhida pra lançar: qual linha está com o formulário aberto.
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [quem, setQuem] = useState("");
  // Valor do serviço no lançamento inline. Nasce com o valor do cadastro e é
  // editável: dividir o serviço = cada colaborador lançado com a parte dele.
  const [valorServico, setValorServico] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);
  // Serviço avulso: bonificação sem venda nem contrato de origem (um extra
  // combinado por fora). Descrição identifica; valor do serviço é manual.
  const [avulsoAberto, setAvulsoAberto] = useState(false);
  const [avulsoDesc, setAvulsoDesc] = useState("");
  const [avulsoValor, setAvulsoValor] = useState("");
  const [busca, setBusca] = useState("");
  const [mostrarNaoBonificam, setMostrarNaoBonificam] = useState(false);
  // Data do pagamento da bonificação. Agosto sai em setembro: marcar "pago"
  // gravava sempre HOJE, e quem dava baixa com atraso ficava com o pagamento
  // no mês errado. Padrão: 1º dia do mês seguinte à competência — ou hoje, se
  // esse dia ainda não chegou. Editável; vale pro check e pra baixa em lote.
  const [dataPagto, setDataPagto] = useState(() => {
    const hoje = new Date();
    let alvo = hoje;
    if (data) {
      const [y, m] = data.month.split("-").map(Number);
      const mesSeguinte = new Date(y, m, 1); // `m` (1-12) já é o índice do mês seguinte
      if (mesSeguinte <= hoje) alvo = mesSeguinte;
    }
    return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}-${String(alvo.getDate()).padStart(2, "0")}`;
  });
  // Ordem da lista de excluídos: por nome pra achar um cliente específico,
  // por valor pra revisar primeiro o que pesa mais no fechamento.
  const [ordemNaoBonificam, setOrdemNaoBonificam] = useState<"nome" | "valor">("nome");

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
        serviceValueCents: toCents(valorServico),
        ...(colab ? { userId: colab.id } : { name: quem }),
      }),
    });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível lançar.");
      return;
    }
    setAbrindo(null); setQuem(""); setValorServico("");
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

  // Liga/desliga a flag no CADASTRO da origem, sem sair da conferência. Por
  // serviço/venda de propósito: o mesmo cliente tem hospedagem que não
  // bonifica e gestão que bonifica. Desligar tira ESTA origem da lista.
  async function setBonifica(alvo: { tipo: "contrato" | "venda"; id: string; clienteId: string }, flag: boolean) {
    setOcupado(`svc-${alvo.id}`);
    setErro("");
    const url =
      alvo.tipo === "contrato"
        ? `/api/empresas/${alvo.clienteId}/servicos-contratados/${alvo.id}`
        : `/api/financeiro/vendas/${alvo.id}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bonusEligible: flag }),
    });
    setOcupado(null);
    if (!res.ok) { setErro("Não foi possível alterar a bonificação do serviço."); return; }
    router.refresh();
  }

  // Lote sobre o que está VISÍVEL (filtro de tipo + busca): "hospedagem não
  // bonifica" são dezenas de contratos — um clique em vez de um por um.
  async function naoBonificaVisiveis() {
    const n = recorrentesVisiveis.length;
    if (n === 0) return;
    if (!confirm(`Marcar ${n} serviço(s) visível(is) como "não bonifica"?\nEles saem da lista em todos os meses (dá pra reverter na seção do rodapé).`)) return;
    setOcupado("lote");
    setErro("");
    const res = await fetch("/api/financeiro/bonificacao/lote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceIds: recorrentesVisiveis.map((r) => r.id), bonusEligible: false }),
    });
    setOcupado(null);
    if (!res.ok) { setErro("Não foi possível atualizar em lote."); return; }
    router.refresh();
  }

  /**
   * Corrige a data de entrega do pontual direto daqui. Marcar "Entregue" com
   * atraso é rotina — entregue em agosto, registrado em setembro — e é nesta
   * tela que o erro aparece. A API move junto os lançamentos não pagos da
   * venda (ver src/lib/sale-delivery.ts).
   */
  async function redatarEntrega(v: { id: string; titulo: string }, dia: string) {
    setOcupado(`d-${v.id}`); setErro(""); setAviso("");
    const res = await fetch(`/api/financeiro/vendas/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Meio-dia local: fuso não empurra a data pro dia (ou mês) vizinho.
      body: JSON.stringify({ deliveredAt: new Date(`${dia}T12:00:00`).toISOString() }),
    });
    setOcupado(null);
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { setErro(r.error ?? "Não foi possível alterar a data de entrega."); return; }
    setRedatando(null);

    const novoMes = dia.slice(0, 7);
    if (novoMes !== data!.month) {
      const bon = r.bonificacao as { movidos: number; pagosMantidos: number; conflitos: string[] } | undefined;
      const extras: string[] = [];
      if (bon?.movidos) extras.push(`${bon.movidos} lançamento(s) foram junto`);
      if (bon?.pagosMantidos) extras.push(`${bon.pagosMantidos} já pago(s) ficou(aram) em ${monthLabel(data!.month)}`);
      if (bon?.conflitos.length) extras.push(`não movido por já existir lá: ${bon.conflitos.join(", ")}`);
      // A linha some deste mês — sem o aviso, parece que a venda sumiu.
      setAviso(
        `"${v.titulo}" agora está em ${monthLabel(novoMes)}.` + (extras.length ? ` ${extras.join(" · ")}.` : "")
      );
    }
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
    const res = await fetch(`/api/financeiro/bonificacao?id=${id}`, { method: "DELETE" });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível remover.");
      return;
    }
    router.refresh();
  }

  // ── Fechamento da competência ──────────────────────────────────────────
  const fechado = !!data.fechamento;

  // ── Data do pagamento ──────────────────────────────────────────────────
  // (o estado `dataPagto` mora antes do retorno antecipado — regra dos hooks)
  // Meio-dia local: "2026-09-01" puro vira meia-noite UTC e aparece como
  // 31/08 no fuso de Brasília.
  const comoData = (d: string) => `${d}T12:00:00`;
  const pendentesDePagto = data.lancados.filter((b) => !b.pago);

  async function pagarEmLote() {
    if (!dataPagto) { setErro("Informe a data do pagamento."); return; }
    const total = pendentesDePagto.reduce((n, b) => n + b.amountCents, 0);
    if (!confirm(
      `Marcar ${pendentesDePagto.length} lançamento(s) pendente(s) (${brlFromCents(total)}) como pagos em ` +
      `${new Date(comoData(dataPagto)).toLocaleDateString("pt-BR")}?`,
    )) return;
    setOcupado("pagar");
    setErro("");
    const res = await fetch("/api/financeiro/bonificacao/pagar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: data!.month, paidAt: comoData(dataPagto) }),
    });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível dar baixa.");
      return;
    }
    const r = await res.json();
    setAviso(`${r.pagos} lançamento(s) marcado(s) como pagos.`);
    router.refresh();
  }

  async function encerrar() {
    const aberto = porColaborador.reduce((n, c) => n + (c.total - c.pago), 0);
    const semValor = data!.lancados.filter((b) => !b.amountCents).length;
    // Avisa o que costuma passar batido antes de trancar: lançamento ainda
    // sem valor de bonificação vira zero congelado.
    const avisos = [
      semValor > 0 && `${semValor} lançamento(s) ainda SEM valor de bonificação`,
      aberto > 0 && `${brlFromCents(aberto)} ainda não marcado como pago (dá pra marcar depois)`,
    ].filter(Boolean);
    const msg =
      `Encerrar a bonificação de ${monthLabel(data!.month)}?\n\n` +
      `Depois de encerrada não aceita lançamento novo, edição de valor nem exclusão. ` +
      `Marcar como pago continua liberado.` +
      (avisos.length ? `\n\nAtenção:\n• ${avisos.join("\n• ")}` : "");
    if (!confirm(msg)) return;

    setOcupado("fechar");
    setErro("");
    const res = await fetch("/api/financeiro/bonificacao/fechar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: data!.month }),
    });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível encerrar.");
      return;
    }
    router.refresh();
  }

  async function reabrir() {
    if (!confirm(`Reabrir a bonificação de ${monthLabel(data!.month)}? Fica registrado no histórico do financeiro.`)) return;
    setOcupado("fechar");
    setErro("");
    const res = await fetch(`/api/financeiro/bonificacao/fechar?month=${data!.month}`, { method: "DELETE" });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível reabrir.");
      return;
    }
    router.refresh();
  }

  // ── Replicar o mês anterior ────────────────────────────────────────────
  async function replicarAnterior() {
    if (!confirm(
      `Copiar os lançamentos de CONTRATO do mês anterior para ${monthLabel(data!.month)}?\n\n` +
      `Mesmo colaborador, mesmo valor de serviço e de bonificação. Venda pontual e avulso não são ` +
      `copiados (seriam pagamento em dobro). Contrato encerrado ou que não vence neste mês fica de fora.`,
    )) return;

    setOcupado("replicar");
    setErro("");
    const res = await fetch("/api/financeiro/bonificacao/duplicar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: data!.month }),
    });
    setOcupado(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível replicar.");
      return;
    }
    const r = await res.json();
    const partes = [
      `${r.copiados} lançamento(s) copiado(s) · ${brlFromCents(r.totalCents)}`,
      r.jaExistia > 0 && `${r.jaExistia} já existia(m) neste mês`,
      r.foraDoMes > 0 && `${r.foraDoMes} de contrato que não vale neste mês`,
    ].filter(Boolean);
    setAviso(partes.join(" · "));
    router.refresh();
  }

  // Totais por colaborador. `entregue` (soma do VALOR DE SERVIÇO lançado) é o
  // número da meta — a % sobre o salário sai da faixa em que ele fecha o mês.
  // `total`/`pago` seguem sendo a bonificação em si.
  const porColaborador = (() => {
    const m = new Map<string, { total: number; pago: number; entregue: number; pagoEm: string | null }>();
    for (const b of data.lancados) {
      const cur = m.get(b.nome) ?? { total: 0, pago: 0, entregue: 0, pagoEm: null as string | null };
      cur.total += b.amountCents;
      cur.entregue += b.serviceValueCents;
      if (b.pago) {
        cur.pago += b.amountCents;
        // Guarda o pagamento mais recente: se saiu em parcelas, o que interessa
        // saber de relance é quando foi a última.
        if (!cur.pagoEm || (b.pagoEm && b.pagoEm > cur.pagoEm)) cur.pagoEm = b.pagoEm;
      }
      m.set(b.nome, cur);
    }
    return [...m].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.entregue - a.entregue);
  })();

  // Faixas da meta de entrega (valor de serviço no mês). A régua visual vai
  // até 10k — dali pra cima o quadro fica cheio, faixa máxima.
  const FAIXAS = [
    { ate: 300_000, rotulo: "até R$ 3 mil", fill: "bg-amber-500/25", borda: "border-amber-500/30", texto: "text-amber-400" },
    { ate: 700_000, rotulo: "R$ 3–7 mil", fill: "bg-sky-500/25", borda: "border-sky-500/30", texto: "text-sky-400" },
    { ate: Infinity, rotulo: "R$ 7–10 mil+", fill: "bg-emerald-500/25", borda: "border-emerald-500/30", texto: "text-emerald-400" },
  ];
  const faixaDe = (entregueCents: number) =>
    FAIXAS[entregueCents <= 300_000 ? 0 : entregueCents <= 700_000 ? 1 : 2];

  const totalMes = porColaborador.reduce((s, c) => s + c.total, 0);
  const totalPago = porColaborador.reduce((s, c) => s + c.pago, 0);

  const tipos = [...new Set(data.recorrentes.map((r) => r.tipo))].sort();
  const casaBusca = (texto: string) =>
    !busca.trim() || texto.toLowerCase().includes(busca.trim().toLowerCase());
  const recorrentesVisiveis = data.recorrentes.filter(
    (r) => (!filtroTipo || r.tipo === filtroTipo) && casaBusca(`${r.cliente} ${r.label}`),
  );

  // Lançamentos por origem, mostrados na própria linha pra você ver quem já
  // recebeu sem descer até a lista.
  //
  // Qualquer origem aceita VÁRIOS colaboradores — o valor do serviço pode ser
  // dividido entre quem trabalhou nele. A trava contra pagar duas vezes é por
  // (origem, colaborador, mês), no servidor: a mesma pessoa não entra duas
  // vezes na mesma origem.
  const lancadosPorOrigem = new Map<string, { id: string; nome: string; amountCents: number; serviceValueCents: number; pago: boolean; pagoEm: string | null }[]>();
  for (const b of data.lancados) {
    const chave = `${b.origem.tipo}:${b.origem.id}`;
    const lista = lancadosPorOrigem.get(chave) ?? [];
    lista.push({ id: b.id, nome: b.nome, amountCents: b.amountCents, serviceValueCents: b.serviceValueCents, pago: b.pago, pagoEm: b.pagoEm });
    lancadosPorOrigem.set(chave, lista);
  }

  function JaLancados({ chave }: { chave: string }) {
    const lista = lancadosPorOrigem.get(chave);
    if (!lista?.length) return null;
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {lista.map((l) => (
          <span
            key={l.id}
            className={`text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
              l.pago ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
            }`}
          >
            {l.nome} · serviço {brlFromCents(l.serviceValueCents)} · bonif. {brlFromCents(l.amountCents)}
            {l.pagoEm && ` · pago ${mesCurto(l.pagoEm)}`}
            {/* Desfazer sem descer até a lista — mas só enquanto não foi pago:
                lançamento pago é histórico, apaga-se lá em cima, com intenção. */}
            {!l.pago && !fechado && (
              <button
                onClick={() => remover(l.id)}
                disabled={ocupado === l.id}
                title="Remover este lançamento"
                className="hover:text-red-400 disabled:opacity-40"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        ))}
      </div>
    );
  }

  // Função que devolve JSX, NÃO um componente aninhado: componente definido
  // dentro do render é um tipo novo a cada tecla digitada — o React remontava
  // o input e o foco sumia no meio da digitação do valor.
  function formLancar(origem: { saleId?: string; clientServiceId?: string }, chave: string, valorPadraoCents: number, presetQuem?: string | null) {
    // Competência encerrada não aceita lançamento novo — o botão some em vez
    // de abrir um formulário que a API vai recusar.
    if (fechado) return null;
    if (abrindo !== chave) {
      return (
        <button
          onClick={() => {
            // Responsável definido na esteira já vem selecionado — o
            // fechamento vira conferência, não investigação.
            setAbrindo(chave); setQuem(presetQuem ?? ""); setErro("");
            // Pré-preenche com o valor do cadastro; editar = lançar só a parte
            // deste colaborador quando o serviço é dividido.
            setValorServico(valorPadraoCents ? (valorPadraoCents / 100).toFixed(2).replace(".", ",") : "");
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-xs hover:bg-indigo-500/20 flex-shrink-0"
        >
          <Plus className="w-3 h-3" /> Bonificar
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        {/* Colaborador + a parte do serviço que é dele. A bonificação em si
            você calcula depois e digita na lista de lançamentos. */}
        <select value={quem} onChange={(e) => setQuem(e.target.value)} className={input}>
          <option value="">Colaborador…</option>
          {data!.colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">serviço R$</span>
          <input
            value={valorServico}
            onChange={(e) => setValorServico(e.target.value)}
            placeholder="0,00"
            className={input + " w-24 text-right"}
          />
        </label>
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

      {aviso && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-4 py-3 text-sm text-emerald-300 flex items-center justify-between gap-3">
          {aviso}
          <button onClick={() => setAviso("")}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {erro && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-lg px-4 py-3 text-sm text-red-300 flex items-center justify-between">
          {erro}
          <button onClick={() => setErro("")}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Situação da competência. Encerrada = somente leitura (baixa de
          pagamento continua livre). Aberta = dá pra replicar o mês anterior e,
          ao terminar a conferência, encerrar. */}
      {fechado ? (
        <div className="bg-slate-500/10 border border-slate-500/30 rounded-xl px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-slate-200 flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400" />
            <span>
              <b>Competência encerrada</b>
              <span className="text-slate-400">
                {" em "}{new Date(data.fechamento!.closedAt).toLocaleDateString("pt-BR")}
                {data.fechamento!.closedBy && ` por ${data.fechamento!.closedBy}`}
                {" · "}{data.fechamento!.qtd} lançamento(s) · {brlFromCents(data.fechamento!.totalCents)}
              </span>
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500">Somente leitura — marcar como pago segue liberado.</span>
            {data.podeReabrir && (
              <button
                onClick={reabrir}
                disabled={ocupado === "fechar"}
                className="px-2.5 py-1.5 rounded-lg border border-slate-500/40 text-slate-300 hover:text-white hover:border-slate-400 text-xs disabled:opacity-40 flex items-center gap-1.5"
              >
                <Unlock className="w-3 h-3" /> Reabrir
              </button>
            )}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {data.replicaveisMesAnterior > 0 && (
            <button
              onClick={replicarAnterior}
              disabled={ocupado === "replicar"}
              title="Copia os lançamentos de contrato do mês anterior — mesmo colaborador e valor"
              className="px-3 py-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-sm flex items-center gap-1.5 disabled:opacity-40"
            >
              {ocupado === "replicar" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
              Replicar mês anterior ({data.replicaveisMesAnterior})
            </button>
          )}
          <button
            onClick={encerrar}
            disabled={ocupado === "fechar" || data.lancados.length === 0}
            title={data.lancados.length === 0 ? "Nada lançado pra encerrar" : "Trava a competência contra lançamento e edição"}
            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm flex items-center gap-1.5 disabled:opacity-40"
          >
            <Lock className="w-3.5 h-3.5" /> Encerrar competência
          </button>
        </div>
      )}

      {/* Fechamento do mês — meta de ENTREGA por colaborador. O fundo do
          quadro enche com o valor de serviço lançado e muda de cor ao cruzar
          a faixa (0–3k âmbar, 3–7k azul, 7–10k+ verde); a % sobre o salário
          sai da faixa em que a pessoa fecha o mês. */}
      <div className={card}>
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-white font-semibold text-sm">Meta de entrega — {monthLabel(data.month)}</h2>
          <span className="text-sm">
            <b className="text-amber-400">{brlFromCents(totalMes - totalPago)}</b>
            <span className="text-slate-600"> de bonificação em aberto · {brlFromCents(totalPago)} pago</span>
          </span>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Soma do <b className="text-slate-500">valor de serviço</b> lançado pra cada colaborador.
          Faixas: até R$ 3 mil · R$ 3–7 mil · R$ 7–10 mil ou mais.
        </p>
        {porColaborador.length === 0 ? (
          <p className="text-slate-600 text-sm py-3">Nada lançado nesta competência ainda.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {porColaborador.map((c) => {
              const fx = faixaDe(c.entregue);
              // Régua visual até 10k; dali pra cima o quadro está cheio.
              const pctMeta = Math.min(100, Math.round((c.entregue / 1_000_000) * 100));
              return (
                <div key={c.nome} className={`relative overflow-hidden rounded-lg border ${fx.borda} bg-white/[0.02]`}>
                  {/* O preenchimento é o gráfico: sobe com a entrega do mês. */}
                  <div
                    className={`absolute inset-y-0 left-0 ${fx.fill} transition-all duration-500`}
                    style={{ width: `${pctMeta}%` }}
                  />
                  {/* Marcas das viradas de faixa (3k e 7k na régua de 10k). */}
                  <div className="absolute inset-y-0 w-px bg-white/10" style={{ left: "30%" }} />
                  <div className="absolute inset-y-0 w-px bg-white/10" style={{ left: "70%" }} />
                  <div className="relative px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-white">{c.nome}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded bg-black/30 ${fx.texto}`}>{fx.rotulo}</span>
                    </div>
                    <div className={`text-lg font-bold ${fx.texto}`}>{brlFromCents(c.entregue)}</div>
                    <div className="text-[11px] text-slate-400">
                      entregue na meta · bonif. {brlFromCents(c.total)}
                      {c.pago > 0 && (
                        <span className="text-emerald-400/80">
                          {" · "}{brlFromCents(c.pago)} pago{c.pagoEm && ` (${mesCurto(c.pagoEm)})`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lançamentos */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-white font-semibold text-sm">Lançamentos ({data.lancados.length})</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Data do pagamento: usada no check "pago" de cada linha e na
                baixa em lote. Funciona com a competência encerrada. */}
            {data.lancados.length > 0 && (
              <label className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500">pago em</span>
                <input
                  type="date"
                  value={dataPagto}
                  onChange={(e) => setDataPagto(e.target.value)}
                  className={input + " w-[140px] text-xs"}
                />
              </label>
            )}
            {pendentesDePagto.length > 0 && (
              <button
                onClick={pagarEmLote}
                disabled={ocupado === "pagar" || !dataPagto}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/20 disabled:opacity-40"
              >
                {ocupado === "pagar" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Marcar {pendentesDePagto.length} pendente(s) como pagos
              </button>
            )}
            {!avulsoAberto && !fechado && (
              <button
                onClick={() => { setAvulsoAberto(true); setQuem(""); setErro(""); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-xs hover:bg-indigo-500/20"
              >
                <Plus className="w-3 h-3" /> Lançar avulso
              </button>
            )}
          </div>
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
                  {/* Editável: a parte do serviço que é deste colaborador —
                      ajusta aqui quando a divisão muda depois do lançamento. */}
                  <label className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">serviço</span>
                    <input
                      defaultValue={b.serviceValueCents ? (b.serviceValueCents / 100).toFixed(2).replace(".", ",") : ""}
                      onBlur={(e) => {
                        const novo = toCents(e.target.value);
                        if (novo !== b.serviceValueCents) alterar(b.id, { serviceValueCents: novo });
                      }}
                      placeholder="0,00"
                      disabled={fechado}
                      className={input + " w-24 text-right text-slate-300 disabled:opacity-60 disabled:cursor-not-allowed"}
                    />
                  </label>
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
                      disabled={fechado}
                      className={input + ` w-24 text-right disabled:opacity-60 disabled:cursor-not-allowed ${b.pago ? "text-emerald-400" : "text-amber-400"}`}
                    />
                  </label>
                  {/* Pago: a data vira campo editável, pra corrigir quando a
                      baixa foi dada depois do pagamento real. */}
                  {b.pago && b.pagoEm && (
                    <input
                      type="date"
                      key={b.pagoEm}
                      defaultValue={b.pagoEm.slice(0, 10)}
                      onBlur={(e) => {
                        if (e.target.value && e.target.value !== b.pagoEm!.slice(0, 10)) {
                          alterar(b.id, { paidAt: comoData(e.target.value) });
                        }
                      }}
                      title="Data em que a bonificação foi paga"
                      className={input + " w-[132px] text-emerald-400 text-xs"}
                    />
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={b.pago}
                      // Marcar usa a data do campo "Data do pagamento" do
                      // cabeçalho, não o dia de hoje.
                      onChange={(e) =>
                        alterar(b.id, e.target.checked ? { paid: true, paidAt: comoData(dataPagto) } : { paid: false })
                      }
                      className="accent-emerald-500"
                    />
                    pago
                  </label>
                  {!fechado && (
                    <button onClick={() => remover(b.id)} className="text-slate-600 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
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
          Bonifica quando está faturado e o cliente ativo — entregue ou não. Serviço que não
          bonifica (ex.: hospedagem): use o &ldquo;não bonifica&rdquo; na linha e ele sai da lista
          em todos os meses.
        </p>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente ou serviço…"
          className={input + " w-full mb-3"}
        />
        {/* Só com filtro/busca ativos — em lote sobre a lista inteira seria
            fácil demais de disparar sem querer. */}
        {(filtroTipo || busca.trim()) && recorrentesVisiveis.length > 0 && (
          <button
            onClick={naoBonificaVisiveis}
            disabled={ocupado === "lote"}
            className="mb-3 px-2.5 py-1.5 rounded-lg text-[11px] border border-red-500/25 text-red-300/90 hover:bg-red-500/10 disabled:opacity-40 flex items-center gap-1.5"
          >
            {ocupado === "lote" && <Loader2 className="w-3 h-3 animate-spin" />}
            Marcar os {recorrentesVisiveis.length} visíveis como &ldquo;não bonifica&rdquo;
          </button>
        )}
        {recorrentesVisiveis.length === 0 && (
          <p className="text-slate-600 text-sm py-3">
            {busca.trim() ? "Nenhum contrato bate com a busca." : "Nenhum contrato bonificável neste mês."}
          </p>
        )}
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
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Tira ESTE serviço do fechamento em todos os meses — a
                    hospedagem que era ignorada à mão repetidamente. */}
                {abrindo !== `c-${r.id}` && (
                  <button
                    onClick={() => setBonifica({ tipo: "contrato", id: r.id, clienteId: r.clienteId }, false)}
                    disabled={ocupado === `svc-${r.id}`}
                    title="Este serviço não gera bonificação — remover da lista em todos os meses"
                    className="px-2 py-1 rounded-md text-[11px] text-slate-600 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                  >
                    {ocupado === `svc-${r.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : "não bonifica"}
                  </button>
                )}
                {formLancar({ clientServiceId: r.id }, `c-${r.id}`, r.amountCents)}
              </div>
            </div>
          ))}
        </div>

        {/* Caminho de volta: sem isto, "marquei sem querer" só se resolvia no
            cadastro do serviço dentro da empresa. */}
        {data.naoBonificam.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#1e2d45]">
            <button
              onClick={() => setMostrarNaoBonificam((v) => !v)}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              {`${mostrarNaoBonificam ? "▾" : "▸"} ${data.naoBonificam.length} serviço(s) marcado(s) como "não bonifica"`}
            </button>
            {mostrarNaoBonificam && (() => {
              const visiveis = [...data.naoBonificam.filter((s) => casaBusca(s.nome))].sort((a, b) =>
                ordemNaoBonificam === "valor"
                  ? b.amountCents - a.amountCents
                  : a.nome.localeCompare(b.nome),
              );
              const total = visiveis.reduce((n, s) => n + s.amountCents, 0);
              return (
                <div className="mt-2">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-slate-600">ordenar por</span>
                      {(["nome", "valor"] as const).map((o) => (
                        <button
                          key={o}
                          onClick={() => setOrdemNaoBonificam(o)}
                          className={`px-1.5 py-0.5 rounded text-[11px] border ${
                            ordemNaoBonificam === o
                              ? "border-indigo-500/40 bg-indigo-500/10 text-white"
                              : "border-[#1e2d45] text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {o === "nome" ? "nome" : "maior valor"}
                        </button>
                      ))}
                    </div>
                    {/* Soma do que está fora do fechamento: ajuda a enxergar o
                        peso do que foi excluído antes de revisar. */}
                    <span className="text-[11px] text-slate-600">
                      {visiveis.length} item(ns) · <b className="text-slate-400">{brlFromCents(total)}</b>
                    </span>
                  </div>
                  <div className="space-y-1">
                    {visiveis.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-white/[0.02]">
                        <span className="text-xs text-slate-500 truncate">{s.nome}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-slate-400 font-medium">{brlFromCents(s.amountCents)}</span>
                          <button
                            onClick={() => setBonifica(s, true)}
                            disabled={ocupado === `svc-${s.id}`}
                            className="px-2 py-1 rounded-md text-[11px] text-emerald-400/80 hover:bg-emerald-500/10 disabled:opacity-40"
                          >
                            {ocupado === `svc-${s.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : "voltar a bonificar"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
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
                    vendido por {brlFromCents(v.valorCents)} ·{" "}
                    {redatando === v.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        entregue em
                        <input
                          type="date"
                          autoFocus
                          defaultValue={dataLocal(v.entregueEm)}
                          max={dataLocal(new Date().toISOString())}
                          disabled={ocupado === `d-${v.id}`}
                          onChange={(e) => e.target.value && redatarEntrega(v, e.target.value)}
                          className="bg-[#161f30] border border-emerald-500/30 rounded px-1.5 py-0.5 text-[11px] text-emerald-300 focus:outline-none"
                        />
                        {ocupado === `d-${v.id}`
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <button onClick={() => setRedatando(null)} className="text-slate-500 hover:text-white">cancelar</button>}
                      </span>
                    ) : (
                      <button
                        onClick={() => { setRedatando(v.id); setErro(""); setAviso(""); }}
                        title="Corrigir a data de entrega — muda o mês em que entra na bonificação"
                        className="underline decoration-dotted underline-offset-2 hover:text-emerald-300"
                      >
                        entregue {new Date(v.entregueEm).toLocaleDateString("pt-BR")}
                      </button>
                    )}
                    {v.responsavelNome && (
                      <span className="text-indigo-400/80"> · resp.: {v.responsavelNome}</span>
                    )}
                  </div>
                  <JaLancados chave={`venda:${v.id}`} />
                </div>
    
                <div className="flex items-center gap-2 flex-shrink-0">
                  {abrindo !== `v-${v.id}` && (
                    <button
                      onClick={() => setBonifica({ tipo: "venda", id: v.id, clienteId: "" }, false)}
                      disabled={ocupado === `svc-${v.id}`}
                      title="Esta venda não gera bonificação — remover da lista"
                      className="px-2 py-1 rounded-md text-[11px] text-slate-600 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                    >
                      {ocupado === `svc-${v.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : "não bonifica"}
                    </button>
                  )}
                  {formLancar({ saleId: v.id }, `v-${v.id}`, v.valorCents, v.responsavelId)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
