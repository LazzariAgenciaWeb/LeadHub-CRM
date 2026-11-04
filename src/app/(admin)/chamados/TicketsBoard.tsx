"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Briefcase, ListChecks, Clock, Building2, Lock, Search, List, Columns3, Star,
  MessageSquare, AlertTriangle, Plus, X, UserX, Hourglass,
} from "lucide-react";
import type { TicketStage } from "@/lib/ticket-stage-sync";
import type { ChamadosViewPref } from "@/lib/chamados-view-pref";

/**
 * Tela de Chamados com duas visões (Lista · Kanban), no padrão de Projetos.
 *
 * O que manda é a URGÊNCIA: atrasado → vence hoje → prioridade → prazo mais
 * próximo, inclusive dentro de cada coluna do kanban. Chamado de cliente sem
 * cliente definido ganha selo e filtro próprios — e o servidor não deixa
 * concluir enquanto ele não for definido (lib/ticket-stages + PATCH).
 */

export type BoardTicket = {
  id: string; title: string; status: string; priority: string; category: string | null;
  ticketStage: string | null; type: "SUPPORT" | "INTERNAL"; visibility: string;
  dueDate: string | null; createdAt: string; updatedAt: string;
  assignee: { id: string; name: string } | null;
  setor: { id: string; name: string } | null;
  clientCompany: { id: string; name: string } | null;
  messages: number;
  /** Cliente falou por último (Meu Espaço / link) e ainda não respondemos. */
  clientWaitingSince: string | null;
};

type View = ChamadosViewPref["view"]; type GroupBy = ChamadosViewPref["groupBy"]; type SortBy = ChamadosViewPref["sortBy"];
type Quick = "todos" | "meus" | "atrasados" | "urgentes" | "semResponsavel" | "semCliente" | "aguardando";
type Kind = "all" | "SUPPORT" | "INTERNAL";

const DAY = 86_400_000;
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

// Classes escritas por inteiro (o Tailwind só gera o que aparece literal no código).
const PRIORITY: Record<string, { label: string; rank: number; cls: string; dot: string }> = {
  URGENT: { label: "Urgente", rank: 0, cls: "bg-red-500/15 text-red-300 border-red-500/30",          dot: "bg-red-500" },
  HIGH:   { label: "Alta",    rank: 1, cls: "bg-orange-500/15 text-orange-300 border-orange-500/30", dot: "bg-orange-400" },
  MEDIUM: { label: "Média",   rank: 2, cls: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20", dot: "bg-yellow-400" },
  LOW:    { label: "Baixa",   rank: 3, cls: "bg-slate-500/10 text-slate-400 border-slate-500/20",    dot: "bg-slate-500" },
};
const prio = (p: string) => PRIORITY[p] ?? PRIORITY.MEDIUM;

// Prazo → rótulo, cor do texto e cor da borda do card/linha.
type Due = { label: string; cls: string; bar: string; bucket: number };
function dueOf(iso: string | null, today: number, closed: boolean, now = Date.now()): Due {
  if (closed) return { label: "", cls: "text-slate-600", bar: "border-l-slate-700", bucket: 9 };
  if (!iso) return { label: "sem prazo", cls: "text-slate-600", bar: "border-l-slate-600", bucket: 5 };
  const x = new Date(iso).getTime();
  const fmt = new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (x < now) return { label: `atrasado · ${fmt}`, cls: "text-red-300", bar: "border-l-red-500", bucket: 0 };
  if (x < today + DAY) return { label: "hoje", cls: "text-orange-300", bar: "border-l-orange-400", bucket: 1 };
  if (x < today + 2 * DAY) return { label: "amanhã", cls: "text-amber-300", bar: "border-l-amber-400", bucket: 2 };
  if (x < today + 7 * DAY) return { label: fmt, cls: "text-slate-300", bar: "border-l-sky-500/70", bucket: 3 };
  return { label: fmt, cls: "text-slate-400", bar: "border-l-slate-600", bucket: 4 };
}
const BUCKET_LABEL = ["Atrasados", "Vencem hoje", "Amanhã", "Esta semana", "Mais adiante", "Sem prazo"];

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join("");
function agoLabel(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "agora";
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ontem" : `há ${d} d`;
}

export default function TicketsBoard({
  tickets: initial, stages, pref, currentUserId,
}: {
  tickets: BoardTicket[];
  stages: TicketStage[];
  pref: ChamadosViewPref;
  currentUserId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tickets, setTickets] = useState(initial);
  const [view, setView] = useState<View>(pref.view);
  const [groupBy, setGroupBy] = useState<GroupBy>(pref.groupBy);
  const [sortBy, setSortBy] = useState<SortBy>(pref.sortBy);
  const [saved, setSaved] = useState(pref);
  const [savingPref, setSavingPref] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [quick, setQuick] = useState<Quick>("todos");
  const [showClosed, setShowClosed] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ticketId?: string } | null>(null);

  // Relógio da tela: fixo por render, renovado a cada router.refresh().
  const [{ now, today }] = useState(() => ({ now: Date.now(), today: startOfToday() }));
  const firstStage = stages[0]?.name ?? "Novo";
  const stageOf = (t: BoardTicket) => stages.find((s) => s.name === (t.ticketStage ?? firstStage)) ?? stages[0];
  const isClosed = (t: BoardTicket) => t.status === "RESOLVED" || t.status === "CLOSED" || !!stageOf(t)?.isFinal;
  const noClient = (t: BoardTicket) => t.type === "SUPPORT" && !t.clientCompany;
  const isDefault = saved.view === view && saved.groupBy === groupBy && saved.sortBy === sortBy;

  async function saveDefault() {
    setSavingPref(true);
    const res = await fetch("/api/chamados/view-pref", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view, groupBy, sortBy }),
    }).catch(() => null);
    setSavingPref(false);
    if (res?.ok) setSaved({ view, groupBy, sortBy });
  }

  // Mais urgente primeiro: atrasado → hoje → prioridade → prazo → mais antigo.
  const byUrgency = (a: BoardTicket, b: BoardTicket) => {
    const da = dueOf(a.dueDate, today, isClosed(a), now).bucket, db = dueOf(b.dueDate, today, isClosed(b), now).bucket;
    const ra = da <= 1 ? da : 2, rb = db <= 1 ? db : 2;
    if (ra !== rb) return ra - rb;
    const pr = prio(a.priority).rank - prio(b.priority).rank;
    if (pr) return pr;
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.createdAt.localeCompare(b.createdAt);
  };
  const sorter = (a: BoardTicket, b: BoardTicket) => {
    if (sortBy === "prazo") return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || byUrgency(a, b);
    if (sortBy === "prioridade") return prio(a.priority).rank - prio(b.priority).rank || byUrgency(a, b);
    if (sortBy === "cliente") return (a.clientCompany?.name ?? "").localeCompare(b.clientCompany?.name ?? "", "pt-BR") || byUrgency(a, b);
    if (sortBy === "atividade") return b.updatedAt.localeCompare(a.updatedAt);
    return byUrgency(a, b);
  };

  const matchQuick = (t: BoardTicket, q: Quick) => {
    if (q === "todos") return true;
    if (isClosed(t)) return false;
    if (q === "meus") return t.assignee?.id === currentUserId;
    if (q === "atrasados") return !!t.dueDate && new Date(t.dueDate).getTime() < now;
    if (q === "urgentes") return t.priority === "URGENT" || t.priority === "HIGH";
    if (q === "semResponsavel") return !t.assignee;
    if (q === "semCliente") return noClient(t);
    return !!t.clientWaitingSince;
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, "");
    return tickets
      .filter((t) => {
        if (kind !== "all" && t.type !== kind) return false;
        if (!showClosed && isClosed(t) && view === "lista") return false;
        if (!matchQuick(t, quick)) return false;
        if (!q) return true;
        return [t.title, t.clientCompany?.name, t.category, t.assignee?.name, t.setor?.name, t.id.slice(-6)]
          .some((x) => x?.toLowerCase().includes(q));
      })
      .sort(sorter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, search, kind, quick, showClosed, view, sortBy, today, currentUserId]);

  // Contadores dos atalhos — sobre os abertos do tipo escolhido, sem busca.
  const counts = useMemo(() => {
    const base = tickets.filter((t) => kind === "all" || t.type === kind);
    const n = (q: Quick) => base.filter((t) => matchQuick(t, q)).length;
    return {
      open: base.filter((t) => !isClosed(t)).length, total: base.length,
      meus: n("meus"), atrasados: n("atrasados"), urgentes: n("urgentes"),
      semResponsavel: n("semResponsavel"), semCliente: n("semCliente"), aguardando: n("aguardando"),
      support: tickets.filter((t) => t.type === "SUPPORT").length,
      internal: tickets.filter((t) => t.type === "INTERNAL").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, kind, currentUserId]);

  const groups = useMemo(() => {
    if (groupBy === "nenhum") return [{ key: "all", label: "", color: null as string | null, rows }];
    const map = new Map<string, { key: string; label: string; color: string | null; order: number; rows: BoardTicket[] }>();
    for (const t of rows) {
      let key: string; let label: string; let order = 0; let color: string | null = null;
      if (groupBy === "etapa") {
        const s = stageOf(t);
        key = s?.name ?? "_"; label = s?.name ?? "Sem etapa"; order = s?.order ?? 99; color = s?.color ?? null;
      } else if (groupBy === "prazo") {
        const b = dueOf(t.dueDate, today, isClosed(t), now).bucket;
        key = String(b); label = b === 9 ? "Encerrados" : BUCKET_LABEL[b]; order = b;
      } else if (groupBy === "cliente") {
        // "Sem cliente" no topo: é o que precisa de ação.
        key = t.clientCompany?.id ?? (t.type === "INTERNAL" ? "_interna" : "_sem");
        label = t.clientCompany?.name ?? (t.type === "INTERNAL" ? "Tarefas internas" : "⚠ Sem cliente");
        order = t.clientCompany ? 1 : t.type === "INTERNAL" ? 2 : 0;
      } else {
        key = t.assignee?.id ?? "_sem"; label = t.assignee?.name ?? "Sem responsável"; order = t.assignee ? 1 : 0;
      }
      if (!map.has(key)) map.set(key, { key, label, color, order, rows: [] });
      map.get(key)!.rows.push(t);
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupBy, today]);

  async function moveToStage(ticketId: string, stageName: string) {
    const before = tickets.find((t) => t.id === ticketId);
    if (!before || (before.ticketStage ?? firstStage) === stageName) return;
    const target = stages.find((s) => s.name === stageName);
    // Mesma regra do servidor, antes de mexer no card: evita o vai-e-volta.
    if (target?.isFinal && noClient(before)) {
      setToast({ text: "Defina o cliente antes de concluir este chamado.", ticketId });
      return;
    }
    setMovingId(ticketId);
    setTickets((prev) => prev.map((t) => (t.id === ticketId
      ? { ...t, ticketStage: stageName, status: target?.isFinal ? "RESOLVED" : isClosed(t) ? "IN_PROGRESS" : t.status }
      : t)));
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketStage: stageName }),
    }).catch(() => null);
    setMovingId(null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? before : t)));
      setToast({ text: data?.error ?? "Não foi possível mover o chamado.", ticketId });
      return;
    }
    startTransition(() => router.refresh());
  }

  const sel = "bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col gap-3 px-6 pt-5 pb-3 flex-shrink-0 border-b border-[#1e2d45]">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-white font-bold text-xl">Chamados &amp; Tarefas</h1>
            <p className="text-slate-500 text-sm mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>{counts.open} aberto{counts.open !== 1 ? "s" : ""}</span>
              {counts.semCliente > 0 && (
                <button type="button" onClick={() => setQuick("semCliente")} className="text-amber-300 hover:underline">
                  · {counts.semCliente} sem cliente
                </button>
              )}
              {counts.aguardando > 0 && (
                <button type="button" onClick={() => setQuick("aguardando")} className="text-cyan-300 hover:underline">
                  · {counts.aguardando} esperando resposta
                </button>
              )}
            </p>
          </div>
          <Link href="/chamados/novo"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Novo
          </Link>
        </div>

        {/* Visão + agrupar/ordenar + padrão */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-0.5">
            {([{ v: "lista", label: "Lista", Icon: List }, { v: "kanban", label: "Kanban", Icon: Columns3 }] as const).map(({ v, label, Icon }) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === v ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
          {view === "lista" && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Agrupar
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={sel}>
                <option value="etapa">Etapa</option>
                <option value="prazo">Prazo</option>
                <option value="cliente">Cliente</option>
                <option value="responsavel">Responsável</option>
                <option value="nenhum">Sem agrupar</option>
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Ordenar
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className={sel}>
              <option value="urgencia">Mais urgente primeiro</option>
              <option value="prazo">Prazo</option>
              <option value="prioridade">Prioridade</option>
              <option value="cliente">Cliente</option>
              <option value="atividade">Mexidos por último</option>
            </select>
          </label>
          <button type="button" onClick={saveDefault} disabled={isDefault || savingPref}
            title={isDefault ? "Esta é a sua visão padrão" : "Abrir Chamados sempre assim"}
            className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${isDefault ? "border-amber-500/30 text-amber-300/80 bg-amber-500/5 cursor-default" : "border-[#1e2d45] text-slate-300 hover:text-white hover:border-amber-500/50"}`}>
            <Star className={`w-3.5 h-3.5 ${isDefault ? "fill-amber-300 text-amber-300" : ""}`} />
            {isDefault ? "Visão padrão" : savingPref ? "Salvando…" : "Definir como padrão"}
          </button>
        </div>

        {/* Busca + tipo + atalhos */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar título, cliente, responsável ou #número…"
              className="w-72 max-w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div className="flex items-center bg-[#0f1623] border border-[#1e2d45] rounded-lg p-0.5">
            {([
              { k: "all" as const, label: "Todos", n: tickets.length, Icon: null, on: "bg-white/10 text-white" },
              { k: "SUPPORT" as const, label: "Chamados", n: counts.support, Icon: Briefcase, on: "bg-blue-500/15 text-blue-300" },
              { k: "INTERNAL" as const, label: "Tarefas", n: counts.internal, Icon: ListChecks, on: "bg-emerald-500/15 text-emerald-300" },
            ]).map(({ k, label, n, Icon, on }) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${kind === k ? on : "text-slate-500 hover:text-white"}`}>
                {Icon && <Icon className="w-3 h-3" strokeWidth={2.5} />}
                {label} <span className="text-slate-600 ml-0.5">{n}</span>
              </button>
            ))}
          </div>
          {([
            { k: "todos", label: "Todos" },
            { k: "meus", label: "Meus", n: counts.meus },
            { k: "atrasados", label: "Atrasados", n: counts.atrasados, warn: "red" },
            { k: "urgentes", label: "Urgentes", n: counts.urgentes, warn: "orange" },
            { k: "aguardando", label: "Cliente esperando", n: counts.aguardando, warn: "cyan" },
            { k: "semCliente", label: "Sem cliente", n: counts.semCliente, warn: "amber" },
            { k: "semResponsavel", label: "Sem responsável", n: counts.semResponsavel },
          ] as { k: Quick; label: string; n?: number; warn?: "red" | "orange" | "cyan" | "amber" }[]).map((b) => {
            const hot = b.warn && (b.n ?? 0) > 0 && quick !== b.k;
            const hotCls = { red: "text-red-300", orange: "text-orange-300", cyan: "text-cyan-300", amber: "text-amber-300" }[b.warn ?? "red"];
            return (
              <button key={b.k} type="button" onClick={() => setQuick(b.k)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${quick === b.k ? "border-indigo-500 text-indigo-200 bg-indigo-500/15" : `border-[#1e2d45] hover:text-white ${hot ? hotCls : "text-slate-400"}`}`}>
                {b.label}{b.n !== undefined && <span className="ml-1 opacity-70">{b.n}</span>}
              </button>
            );
          })}
          <label className="flex items-center gap-1.5 text-xs text-slate-500 ml-1 cursor-pointer">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-indigo-500" />
            Mostrar encerrados
          </label>
          <span className="ml-auto text-xs text-slate-600">{rows.length} na tela</span>
        </div>
      </div>

      {/* Corpo */}
      {view === "lista" ? (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {rows.length === 0 ? (
            <p className="text-slate-500 text-sm py-12 text-center">Nenhum chamado com esses filtros.</p>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <section key={g.key}>
                  {g.label && (
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                      {g.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />}
                      {g.label}
                      <span className="text-slate-600 normal-case font-normal">· {g.rows.length}</span>
                    </h2>
                  )}
                  <div className="rounded-xl border border-[#1e2d45] divide-y divide-[#1e2d45] overflow-hidden">
                    {g.rows.map((t) => (
                      <ListRow key={t.id} t={t} stage={stageOf(t)} closed={isClosed(t)} today={today}
                        currentUserId={currentUserId} showStage={groupBy !== "etapa"} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto px-6 pb-6 pt-4">
          <div className="flex gap-3 h-full">
            {stages.map((stage) => {
              const list = rows.filter((t) => stageOf(t)?.name === stage.name);
              // Coluna final recolhida: continua aceitando o card (é assim que se conclui),
              // mas não ocupa a tela com o histórico de resolvidos.
              const collapsed = stage.isFinal && !showClosed;
              return (
                <div key={stage.id}
                  className={`flex flex-col rounded-xl border transition-all ${collapsed ? "w-44 flex-none" : "flex-1 min-w-[250px]"} ${
                    stage.isFinal ? "bg-white/[0.02] border-white/10" : "bg-[#0a0f1a] border-[#1e2d45]"
                  } ${dragOver === stage.name ? "ring-2 ring-white/25" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(stage.name); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault(); setDragOver(null);
                    const id = e.dataTransfer.getData("ticketId");
                    if (id) void moveToStage(id, stage.name);
                  }}
                >
                  <div className="px-3 pt-3 pb-2 flex items-center gap-2 flex-shrink-0" style={{ borderBottom: `2px solid ${stage.color}30` }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span className="text-white font-semibold text-[13px] truncate">{stage.name}</span>
                    <span className="bg-white/10 text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{list.length}</span>
                  </div>
                  {collapsed ? (
                    <div className="flex-1 flex items-center justify-center p-3 text-center text-[11px] text-slate-600">
                      Solte aqui pra concluir
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {list.length === 0 && <div className="text-center py-6 text-slate-700 text-xs">Arraste aqui</div>}
                      {list.map((t) => (
                        <KanbanCard key={t.id} t={t} closed={isClosed(t)} today={today} currentUserId={currentUserId}
                          moving={movingId === t.id} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Aviso (ex.: concluir sem cliente) */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#1a1408] border border-amber-500/40 text-amber-200 text-sm rounded-xl px-4 py-3 shadow-2xl max-w-[calc(100vw-2rem)]">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{toast.text}</span>
          {toast.ticketId && (
            <Link href={`/chamados/${toast.ticketId}?config=1`} className="underline font-medium whitespace-nowrap">Definir cliente</Link>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso" className="text-amber-300/70 hover:text-amber-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Selos comuns (lista e kanban) ───────────────────────────────────────────
function Flags({ t, closed }: { t: BoardTicket; closed: boolean }) {
  const out: ReactNode[] = [];
  if (t.type === "SUPPORT" && !t.clientCompany) {
    out.push(
      <span key="cli" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-amber-500/10 text-amber-300 border-amber-500/30">
        <AlertTriangle className="w-2.5 h-2.5" strokeWidth={2.5} /> Sem cliente
      </span>,
    );
  }
  if (!closed && t.clientWaitingSince) {
    out.push(
      <span key="wait" title={`Cliente escreveu ${agoLabel(t.clientWaitingSince)} e ainda não respondemos`}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border-cyan-500/30">
        <Hourglass className="w-2.5 h-2.5" strokeWidth={2.5} /> Cliente esperando · {agoLabel(t.clientWaitingSince)}
      </span>,
    );
  }
  return <>{out}</>;
}

function Assignee({ t, currentUserId }: { t: BoardTicket; currentUserId: string }) {
  if (!t.assignee) {
    return t.type === "INTERNAL" ? null : (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500" title="Sem responsável">
        <UserX className="w-3 h-3" /> ninguém
      </span>
    );
  }
  const mine = t.assignee.id === currentUserId;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${mine ? "text-indigo-300" : "text-slate-300"}`} title={t.assignee.name}>
      <span className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center ${mine ? "bg-indigo-500/25" : "bg-white/10"}`}>
        {initials(t.assignee.name)}
      </span>
      <span className="truncate max-w-[7rem]">{mine ? "Você" : t.assignee.name.split(" ")[0]}</span>
    </span>
  );
}

// ─── Lista ───────────────────────────────────────────────────────────────────
function ListRow({ t, stage, closed, today, currentUserId, showStage }: {
  t: BoardTicket; stage: TicketStage | undefined; closed: boolean; today: number; currentUserId: string; showStage: boolean;
}) {
  const due = dueOf(t.dueDate, today, closed);
  const p = prio(t.priority);
  return (
    <Link href={`/chamados/${t.id}`}
      className={`grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 items-center px-4 py-3 border-l-4 ${due.bar} bg-[#0a0f1a] hover:bg-[#0d1424] transition-colors ${closed ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {t.type === "INTERNAL"
            ? <ListChecks className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" strokeWidth={2.5} />
            : <Briefcase className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" strokeWidth={2.5} />}
          <span className="text-white text-sm font-medium truncate">{t.title}</span>
          {t.visibility === "RESTRICTED" && <Lock className="w-3 h-3 text-amber-400 flex-shrink-0" aria-label="Restrito" />}
          <span className="text-slate-600 text-[11px] font-mono flex-shrink-0">#{t.id.slice(-6)}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-slate-500">
          {t.clientCompany && (
            <span className="inline-flex items-center gap-1 text-slate-400"><Building2 className="w-3 h-3" />{t.clientCompany.name}</span>
          )}
          {t.category && <span>· {t.category}</span>}
          {t.setor && <span>· {t.setor.name}</span>}
          <Flags t={t} closed={closed} />
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap md:flex-nowrap md:justify-end text-[11px]">
        {showStage && stage && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border whitespace-nowrap"
            style={{ color: stage.color, backgroundColor: stage.color + "1a", borderColor: stage.color + "40" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />{stage.name}
          </span>
        )}
        <span className={`px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap ${p.cls}`}>{p.label}</span>
        {!closed && (
          <span className={`inline-flex items-center gap-1 whitespace-nowrap md:w-28 ${due.cls}`}>
            <Clock className="w-3 h-3" />{due.label}
          </span>
        )}
        <span className="md:w-28"><Assignee t={t} currentUserId={currentUserId} /></span>
        <span className="inline-flex items-center gap-1 text-slate-600 md:w-10 justify-end">
          {t.messages > 0 && <><MessageSquare className="w-3 h-3" />{t.messages}</>}
        </span>
      </div>
    </Link>
  );
}

// ─── Kanban ──────────────────────────────────────────────────────────────────
function KanbanCard({ t, closed, today, currentUserId, moving }: {
  t: BoardTicket; closed: boolean; today: number; currentUserId: string; moving: boolean;
}) {
  const due = dueOf(t.dueDate, today, closed);
  const p = prio(t.priority);
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData("ticketId", t.id)}
      className={`bg-[#0f1623] border border-[#1e2d45] border-l-4 ${due.bar} rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-white/20 transition-all ${moving ? "opacity-40" : ""}`}>
      <div className="flex items-start gap-2 mb-1.5">
        {t.type === "INTERNAL"
          ? <ListChecks className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
          : <Briefcase className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />}
        <Link href={`/chamados/${t.id}`} className="text-white text-[13px] font-semibold leading-snug hover:text-indigo-300 line-clamp-2 flex-1">
          {t.title}
        </Link>
        {t.visibility === "RESTRICTED" && <Lock className="w-3 h-3 text-amber-400 flex-shrink-0 mt-1" aria-label="Restrito" />}
      </div>
      {t.clientCompany && (
        <div className="text-slate-400 text-[11px] mb-1.5 truncate flex items-center gap-1">
          <Building2 className="w-3 h-3 flex-shrink-0" />{t.clientCompany.name}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Flags t={t} closed={closed} />
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${p.cls}`}>{p.label}</span>
        {!closed && t.dueDate && (
          <span className={`text-[10px] font-semibold inline-flex items-center gap-1 ${due.cls}`}>
            <Clock className="w-2.5 h-2.5" />{due.label}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Assignee t={t} currentUserId={currentUserId} />
        {t.messages > 0 && (
          <span className="text-slate-600 text-[10px] inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" />{t.messages}</span>
        )}
      </div>
    </div>
  );
}
