"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { LayoutGrid, List, Network, Columns3, Star, ChevronRight, ChevronDown, Search } from "lucide-react";
import ProjetosBoard from "./ProjetosBoard";
import type { ViewPref } from "@/lib/projetos-view-pref";

/**
 * Tela de Projetos com várias visões (Cards · Lista · Mapa · Kanban).
 *
 * O que manda é o andamento das TAREFAS — o status do projeto é só a pasta.
 * Saúde, próxima entrega e progresso saem das tarefas. Cada usuário escolhe a
 * combinação padrão (visão + agrupar + ordenar) e alterna quando precisar.
 */

export type PVTask = {
  id: string; title: string; status: string; done: boolean; dueDate: string | null;
  stepId: string | null; assigneeId: string | null; assignee: string | null; approvalSentAt: string | null;
};
export type PV = {
  id: string; name: string; type: string | null; status: string;
  setor: { id: string; name: string }; client: { id: string; name: string } | null;
  dueDate: string | null; lastActivity: string;
  memberIds: string[]; members: string[];
  steps: { id: string; name: string }[];
  tasks: PVTask[];
};

type View = ViewPref["view"]; type GroupBy = ViewPref["groupBy"]; type SortBy = ViewPref["sortBy"];
type Quick = "todos" | "meus" | "atraso" | "aguardando";

const DAY = 86_400_000;

// Classes escritas por inteiro (o Tailwind só gera o que aparece literal no código).
const SEG: Record<string, { label: string; cls: string; bar: string; dot: string }> = {
  SITE:     { label: "Site",     cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",             bar: "border-l-sky-400",     dot: "bg-sky-400" },
  MIDIA:    { label: "Mídia",    cls: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30", bar: "border-l-fuchsia-400", dot: "bg-fuchsia-400" },
  CAMPANHA: { label: "Campanha", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",       bar: "border-l-amber-400",   dot: "bg-amber-400" },
  OUTRO:    { label: "Outro",    cls: "bg-slate-500/15 text-slate-300 border-slate-500/30",       bar: "border-l-slate-400",   dot: "bg-slate-400" },
};
const segOf = (t: string | null) => SEG[t ?? ""] ?? { label: "Sem segmento", cls: "bg-slate-500/10 text-slate-400 border-slate-600/30", bar: "border-l-slate-600", dot: "bg-slate-600" };

const TST: Record<string, { label: string; dot: string; cls: string }> = {
  NOVA:               { label: "Nova",               dot: "bg-slate-400",   cls: "text-slate-300" },
  EM_PRODUCAO:        { label: "Em produção",        dot: "bg-blue-400",    cls: "text-blue-300" },
  AGUARDANDO_CLIENTE: { label: "Aguardando cliente", dot: "bg-cyan-400",    cls: "text-cyan-300" },
  APROVADO:           { label: "Aprovado",           dot: "bg-emerald-400", cls: "text-emerald-300" },
};
const tst = (s: string) => TST[s] ?? TST.NOVA;

const HEALTH = {
  red:    { dot: "bg-red-500",     label: "Atrasado" },
  yellow: { dot: "bg-amber-400",   label: "Atenção" },
  green:  { dot: "bg-emerald-500", label: "Em dia" },
  none:   { dot: "bg-slate-600",   label: "Sem tarefas abertas" },
} as const;

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

type Sum = {
  total: number; done: number; open: number; overdue: number; soon: number;
  awaiting: number; stale: number; next: string | null; health: keyof typeof HEALTH;
};

function summarize(p: PV, today: number): Sum {
  const open = p.tasks.filter((t) => !t.done);
  const ts = (d: string | null) => (d ? new Date(d).getTime() : NaN);
  const overdue = open.filter((t) => ts(t.dueDate) < today).length;
  const soon = open.filter((t) => { const x = ts(t.dueDate); return x >= today && x < today + 3 * DAY; }).length;
  const awaitingT = open.filter((t) => t.status === "AGUARDANDO_CLIENTE");
  // Aprovação parada: enviada há 3+ dias e o cliente ainda não respondeu.
  const stale = awaitingT.filter((t) => t.approvalSentAt && Date.now() - ts(t.approvalSentAt) > 3 * DAY).length;
  const dues = open.map((t) => t.dueDate).filter((d): d is string => !!d).sort();
  const closed = p.status === "ENTREGUE" || p.status === "CANCELADO";
  const next = dues[0] ?? (closed ? null : p.dueDate);
  const health: Sum["health"] =
    closed || open.length === 0 ? "none" : overdue > 0 ? "red" : soon > 0 || stale > 0 ? "yellow" : "green";
  return { total: p.tasks.length, done: p.tasks.length - open.length, open: open.length, overdue, soon, awaiting: awaitingT.length, stale, next, health };
}

const BUCKETS = ["Atrasado", "Hoje", "Esta semana", "Próximas semanas", "Mais adiante", "Sem prazo"] as const;
function bucketOf(next: string | null, today: number): (typeof BUCKETS)[number] {
  if (!next) return "Sem prazo";
  const x = new Date(next).getTime();
  if (x < today) return "Atrasado";
  if (x < today + DAY) return "Hoje";
  if (x < today + 7 * DAY) return "Esta semana";
  if (x < today + 30 * DAY) return "Próximas semanas";
  return "Mais adiante";
}

const fmtD = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
function dueLabel(iso: string | null, today: number): { text: string; cls: string } {
  if (!iso) return { text: "sem prazo", cls: "text-slate-600" };
  const x = new Date(iso).getTime();
  const d = Math.round((x - today) / DAY);
  if (x < today) return { text: `${fmtD(iso)} · atrasado`, cls: "text-red-300" };
  if (d === 0) return { text: "hoje", cls: "text-amber-300" };
  if (d === 1) return { text: "amanhã", cls: "text-amber-300" };
  if (d < 7) return { text: `${fmtD(iso)} · em ${d} dias`, cls: "text-slate-300" };
  return { text: fmtD(iso), cls: "text-slate-400" };
}
function agoLabel(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} d`;
}
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join("");

const taskHref = (pid: string, tid: string) => `/projetos/${pid}?tarefa=${tid}`;

// Etapas + "Sem etapa" (tarefas soltas / a organizar), cada uma com suas tarefas.
function stepsWithTasks(p: PV) {
  const known = new Set(p.steps.map((s) => s.id));
  const list = p.steps.map((s) => ({ id: s.id, name: s.name, tasks: p.tasks.filter((t) => t.stepId === s.id) }));
  const loose = p.tasks.filter((t) => !t.stepId || !known.has(t.stepId));
  if (loose.length) list.push({ id: `${p.id}:sem`, name: "Sem etapa", tasks: loose });
  return list;
}

export default function ProjetosViews({
  items, pref, currentUserId, kanban,
}: {
  items: PV[];
  pref: ViewPref;
  currentUserId: string;
  kanban: { projects: any[]; isSuperAdmin: boolean; companies: { id: string; name: string }[]; filterCompanyId: string };
}) {
  const [view, setView] = useState<View>(pref.view);
  const [groupBy, setGroupBy] = useState<GroupBy>(pref.groupBy);
  const [sortBy, setSortBy] = useState<SortBy>(pref.sortBy);
  const [saved, setSaved] = useState<ViewPref>(pref);
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<Quick>("todos");
  const [showClosed, setShowClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = startOfToday();
  const isDefault = saved.view === view && saved.groupBy === groupBy && saved.sortBy === sortBy;

  async function saveDefault() {
    setSaving(true);
    const res = await fetch("/api/projetos/view-pref", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view, groupBy, sortBy }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) setSaved({ view, groupBy, sortBy });
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .map((p) => ({ p, s: summarize(p, today) }))
      .filter(({ p, s }) => {
        if (!showClosed && (p.status === "ENTREGUE" || p.status === "CANCELADO")) return false;
        if (quick === "meus" && !(p.memberIds.includes(currentUserId) || p.tasks.some((t) => !t.done && t.assigneeId === currentUserId))) return false;
        if (quick === "atraso" && s.overdue === 0) return false;
        if (quick === "aguardando" && s.awaiting === 0) return false;
        if (!q) return true;
        return [p.name, p.client?.name, p.setor.name, segOf(p.type).label, ...p.tasks.map((t) => t.title)]
          .some((x) => x?.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (sortBy === "nome") return a.p.name.localeCompare(b.p.name, "pt-BR");
        if (sortBy === "cliente") return (a.p.client?.name ?? "~").localeCompare(b.p.client?.name ?? "~", "pt-BR") || a.p.name.localeCompare(b.p.name, "pt-BR");
        if (sortBy === "progresso") return (a.s.total ? a.s.done / a.s.total : 1) - (b.s.total ? b.s.done / b.s.total : 1);
        if (sortBy === "atividade") return b.p.lastActivity.localeCompare(a.p.lastActivity);
        return (a.s.next ?? "9999").localeCompare(b.s.next ?? "9999"); // entrega
      });
  }, [items, search, quick, showClosed, sortBy, currentUserId, today]);

  const groups = useMemo(() => {
    if (groupBy === "nenhum") return [{ key: "all", label: "", rows }];
    const map = new Map<string, { key: string; label: string; order: number; rows: typeof rows }>();
    for (const r of rows) {
      let key: string; let label: string; let order = 0;
      if (groupBy === "segmento") { key = r.p.type ?? "_"; label = segOf(r.p.type).label; order = ["SITE", "MIDIA", "CAMPANHA", "OUTRO"].indexOf(key) + 1 || 99; }
      else if (groupBy === "setor") { key = r.p.setor.id; label = r.p.setor.name; }
      else if (groupBy === "cliente") { key = r.p.client?.id ?? "_"; label = r.p.client?.name ?? "Sem cliente"; order = r.p.client ? 0 : 99; }
      else { label = bucketOf(r.s.next, today); key = label; order = BUCKETS.indexOf(label as (typeof BUCKETS)[number]); }
      if (!map.has(key)) map.set(key, { key, label, order, rows: [] });
      map.get(key)!.rows.push(r);
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "pt-BR"));
  }, [rows, groupBy, today]);

  const counts = useMemo(() => {
    const all = items.map((p) => ({ p, s: summarize(p, today) })).filter(({ p }) => showClosed || (p.status !== "ENTREGUE" && p.status !== "CANCELADO"));
    return {
      meus: all.filter(({ p }) => p.memberIds.includes(currentUserId) || p.tasks.some((t) => !t.done && t.assigneeId === currentUserId)).length,
      atraso: all.filter(({ s }) => s.overdue > 0).length,
      aguardando: all.filter(({ s }) => s.awaiting > 0).length,
    };
  }, [items, showClosed, currentUserId, today]);

  const VIEW_BTNS: { v: View; label: string; Icon: typeof List }[] = [
    { v: "cards", label: "Cards", Icon: LayoutGrid },
    { v: "lista", label: "Lista", Icon: List },
    { v: "mapa", label: "Mapa", Icon: Network },
    { v: "kanban", label: "Kanban", Icon: Columns3 },
  ];
  const sel = "bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500";

  return (
    <>
      {/* Visão + padrão */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-0.5">
          {VIEW_BTNS.map(({ v, label, Icon }) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === v ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        {view !== "kanban" && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Agrupar
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={sel}>
                <option value="segmento">Segmento</option>
                <option value="setor">Setor</option>
                <option value="cliente">Cliente</option>
                <option value="prazo">Prazo</option>
                <option value="nenhum">Sem agrupar</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Ordenar
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className={sel}>
                <option value="entrega">Próxima entrega</option>
                <option value="nome">Nome</option>
                <option value="cliente">Cliente</option>
                <option value="progresso">Menos avançados</option>
                <option value="atividade">Mexidos por último</option>
              </select>
            </label>
          </>
        )}
        <button type="button" onClick={saveDefault} disabled={isDefault || saving}
          title={isDefault ? "Esta é a sua visão padrão" : "Abrir Projetos sempre assim"}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${isDefault ? "border-amber-500/30 text-amber-300/80 bg-amber-500/5 cursor-default" : "border-[#1e2d45] text-slate-300 hover:text-white hover:border-amber-500/50"}`}>
          <Star className={`w-3.5 h-3.5 ${isDefault ? "fill-amber-300 text-amber-300" : ""}`} />
          {isDefault ? "Visão padrão" : saving ? "Salvando…" : "Definir como padrão"}
        </button>
      </div>

      {view === "kanban" ? (
        <ProjetosBoard {...kanban} currentUserId={currentUserId} />
      ) : (
        <>
          {/* Busca + atalhos */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar projeto, cliente ou tarefa…"
                className="w-72 max-w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
            </div>
            {([
              { k: "todos", label: "Todos" },
              { k: "meus", label: "Meus", n: counts.meus },
              { k: "atraso", label: "Com atraso", n: counts.atraso },
              { k: "aguardando", label: "Aguardando cliente", n: counts.aguardando },
            ] as { k: Quick; label: string; n?: number }[]).map((b) => (
              <button key={b.k} type="button" onClick={() => setQuick(b.k)}
                className={`px-2.5 py-1 rounded-full text-xs border ${quick === b.k ? "border-indigo-500 text-indigo-200 bg-indigo-500/15" : "border-[#1e2d45] text-slate-400 hover:text-white"}`}>
                {b.label}{b.n !== undefined && <span className="ml-1 opacity-70">{b.n}</span>}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-xs text-slate-500 ml-1 cursor-pointer">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-indigo-500" />
              Entregues e cancelados
            </label>
            <span className="ml-auto text-xs text-slate-600">{rows.length} projeto{rows.length === 1 ? "" : "s"}</span>
          </div>

          {rows.length === 0 ? (
            <p className="text-slate-500 text-sm py-10 text-center">Nenhum projeto com esses filtros.</p>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <section key={g.key}>
                  {g.label && (
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                      {groupBy === "segmento" && <span className={`w-2 h-2 rounded-full ${segOf(g.key === "_" ? null : g.key).dot}`} />}
                      {g.label}
                      <span className="text-slate-600 normal-case font-normal">· {g.rows.length}</span>
                    </h2>
                  )}
                  {view === "cards" && <CardsView rows={g.rows} today={today} />}
                  {view === "lista" && <ListaView rows={g.rows} today={today} />}
                  {view === "mapa" && <MapaView rows={g.rows} today={today} />}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

type Row = { p: PV; s: Sum };

function Progress({ s }: { s: Sum }) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-[#1e2d45] overflow-hidden">
        <div className="h-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-slate-500 tabular-nums shrink-0">{s.done}/{s.total}</span>
    </div>
  );
}

function Badges({ s }: { s: Sum }) {
  return (
    <>
      {s.overdue > 0 && <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 text-[10px] font-semibold">{s.overdue} atrasada{s.overdue > 1 ? "s" : ""}</span>}
      {s.awaiting > 0 && (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.stale ? "bg-amber-500/15 text-amber-300" : "bg-cyan-500/15 text-cyan-300"}`}
          title={s.stale ? `${s.stale} sem resposta há 3+ dias` : undefined}>
          {s.awaiting} c/ cliente{s.stale ? " · parada" : ""}
        </span>
      )}
    </>
  );
}

// ─── Cards ───────────────────────────────────────────────────────────────────
function CardsView({ rows, today }: { rows: Row[]; today: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {rows.map(({ p, s }) => {
        const seg = segOf(p.type);
        const due = dueLabel(s.next, today);
        return (
          <Link key={p.id} href={`/projetos/${p.id}`}
            className={`group block rounded-xl border border-[#1e2d45] border-l-4 ${seg.bar} bg-[#0a0f1a] hover:bg-[#0d1424] hover:border-indigo-500/40 transition-colors p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${HEALTH[s.health].dot}`} title={HEALTH[s.health].label} />
              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${seg.cls}`}>{seg.label}</span>
              <span className="text-[11px] text-slate-500 truncate">{p.setor.name}</span>
            </div>
            <div className="text-white text-sm font-semibold leading-snug group-hover:text-indigo-200 line-clamp-2">{p.name}</div>
            <div className="text-xs text-slate-400 mt-0.5 truncate">{p.client?.name ?? "Sem cliente"}</div>
            <div className="mt-3"><Progress s={s} /></div>
            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap text-[11px]">
              <span className="text-slate-500">Próxima entrega:</span>
              <span className={due.cls}>{due.text}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <Badges s={s} />
              <span className="ml-auto flex -space-x-1.5">
                {p.members.slice(0, 4).map((m) => (
                  <span key={m} title={m} className="w-6 h-6 rounded-full bg-indigo-500/20 border border-[#0a0f1a] text-[9px] font-bold text-indigo-200 flex items-center justify-center">{initials(m)}</span>
                ))}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Lista (expande etapas → tarefas) ────────────────────────────────────────
function TaskLine({ pid, t, today }: { pid: string; t: PVTask; today: number }) {
  const st = tst(t.status);
  const due = dueLabel(t.done ? null : t.dueDate, today);
  return (
    <Link href={taskHref(pid, t.id)}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#111a2b] text-xs ${t.done ? "opacity-50" : ""}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} title={st.label} />
      <span className={`flex-1 min-w-0 truncate ${t.done ? "line-through text-slate-500" : "text-slate-200"}`}>{t.title}</span>
      <span className={`hidden sm:inline shrink-0 ${st.cls}`}>{st.label}</span>
      <span className="w-24 shrink-0 truncate text-slate-500 text-right">{t.assignee ?? "—"}</span>
      {!t.done && <span className={`w-28 shrink-0 text-right ${due.cls}`}>{due.text}</span>}
    </Link>
  );
}

function StepBlock({ pid, step, today }: { pid: string; step: { id: string; name: string; tasks: PVTask[] }; today: number }) {
  const [open, setOpen] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const openT = step.tasks.filter((t) => !t.done);
  const doneT = step.tasks.filter((t) => t.done);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white py-1">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {step.name}
        <span className="text-slate-600 font-normal">{doneT.length}/{step.tasks.length}</span>
      </button>
      {open && (
        <div className="ml-4 border-l border-[#1e2d45] pl-2">
          {openT.map((t) => <TaskLine key={t.id} pid={pid} t={t} today={today} />)}
          {openT.length === 0 && <p className="text-[11px] text-slate-600 px-2 py-1">{step.tasks.length ? "tudo concluído ✓" : "sem tarefas"}</p>}
          {doneT.length > 0 && (
            <button type="button" onClick={() => setShowDone((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1">
              {showDone ? "ocultar concluídas" : `mostrar ${doneT.length} concluída${doneT.length > 1 ? "s" : ""}`}
            </button>
          )}
          {showDone && doneT.map((t) => <TaskLine key={t.id} pid={pid} t={t} today={today} />)}
        </div>
      )}
    </div>
  );
}

function ListaView({ rows, today }: { rows: Row[]; today: number }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="rounded-xl border border-[#1e2d45] bg-[#0a0f1a] divide-y divide-[#1e2d45] overflow-hidden">
      {rows.map(({ p, s }) => {
        const seg = segOf(p.type);
        const due = dueLabel(s.next, today);
        const isOpen = open.has(p.id);
        return (
          <div key={p.id}>
            <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#0d1424]">
              <button type="button" onClick={() => toggle(p.id)} className="text-slate-500 hover:text-white shrink-0" aria-label={isOpen ? "Recolher" : "Expandir"}>
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${HEALTH[s.health].dot}`} title={HEALTH[s.health].label} />
              <button type="button" onClick={() => toggle(p.id)} className="flex-1 min-w-0 text-left">
                <div className="text-sm text-white font-medium truncate">{p.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{p.client?.name ?? "Sem cliente"} · {p.setor.name}</div>
              </button>
              <span className={`hidden md:inline px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${seg.cls}`}>{seg.label}</span>
              <div className="hidden md:block w-36 shrink-0"><Progress s={s} /></div>
              <span className={`hidden sm:block w-32 shrink-0 text-xs text-right ${due.cls}`}>{due.text}</span>
              <div className="hidden lg:flex items-center gap-1 w-44 shrink-0 justify-end"><Badges s={s} /></div>
              <span className="hidden xl:block w-16 shrink-0 text-[11px] text-slate-600 text-right">{agoLabel(p.lastActivity)}</span>
              <Link href={`/projetos/${p.id}`} className="text-[11px] text-indigo-300 hover:text-indigo-200 shrink-0">Abrir →</Link>
            </div>
            {isOpen && (
              <div className="px-10 pb-3 pt-1 bg-[#080c14] space-y-1">
                {stepsWithTasks(p).map((st) => <StepBlock key={st.id} pid={p.id} step={st} today={today} />)}
                {p.tasks.length === 0 && <p className="text-xs text-slate-600 py-1">Nenhuma tarefa ainda.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Mapa mental: projeto → etapas → tarefas ─────────────────────────────────
const MAP_CSS = `
.mm{overflow-x:auto;padding:4px 2px 8px}
.mm-row{display:flex;align-items:center}
.mm-kids{position:relative;display:flex;flex-direction:column;justify-content:center;margin-left:28px}
.mm-kids::before{content:"";position:absolute;left:-28px;top:50%;width:28px;border-top:1px solid #2a3b57}
.mm-kid{position:relative;display:flex;align-items:center;padding:3px 0 3px 18px}
.mm-kid::before{content:"";position:absolute;left:0;top:50%;width:18px;border-top:1px solid #2a3b57}
.mm-kid::after{content:"";position:absolute;left:0;top:0;bottom:0;border-left:1px solid #2a3b57}
.mm-kid:first-child::after{top:50%}
.mm-kid:last-child::after{bottom:50%}
.mm-kid:only-child::after{display:none}
`;

function Branch({ node, open, kids }: { node: ReactNode; open: boolean; kids: ReactNode[] }) {
  return (
    <div className="mm-row">
      {node}
      {open && kids.length > 0 && (
        <div className="mm-kids">
          {kids.map((k, i) => <div key={i} className="mm-kid">{k}</div>)}
        </div>
      )}
    </div>
  );
}

function MapaView({ rows, today }: { rows: Row[]; today: number }) {
  const [openP, setOpenP] = useState<Set<string>>(new Set());
  const [openS, setOpenS] = useState<Set<string>>(new Set());
  const flip = (set: typeof setOpenP, id: string) => set((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOpen = rows.length > 0 && rows.every(({ p }) => openP.has(p.id));
  function toggleAll() {
    if (allOpen) { setOpenP(new Set()); setOpenS(new Set()); return; }
    setOpenP(new Set(rows.map(({ p }) => p.id)));
    setOpenS(new Set(rows.flatMap(({ p }) => stepsWithTasks(p).map((s) => s.id))));
  }
  const MAX = 12;
  return (
    <div className="rounded-xl border border-[#1e2d45] bg-[#0a0f1a] p-3">
      <style>{MAP_CSS}</style>
      <div className="flex justify-end mb-1">
        <button type="button" onClick={toggleAll} className="text-[11px] text-slate-400 hover:text-white">{allOpen ? "Recolher tudo" : "Expandir tudo"}</button>
      </div>
      <div className="mm space-y-2">
        {rows.map(({ p, s }) => {
          const seg = segOf(p.type);
          const steps = stepsWithTasks(p);
          const pOpen = openP.has(p.id);
          return (
            <Branch
              key={p.id}
              open={pOpen}
              node={
                <button type="button" onClick={() => flip(setOpenP, p.id)}
                  className={`shrink-0 w-64 text-left rounded-xl border border-[#1e2d45] border-l-4 ${seg.bar} bg-[#0f1623] hover:border-indigo-500/50 px-3 py-2`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${HEALTH[s.health].dot}`} />
                    <span className="text-sm text-white font-semibold truncate flex-1">{p.name}</span>
                    {steps.length > 0 && (pOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />)}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{p.client?.name ?? "Sem cliente"} · {s.done}/{s.total}</div>
                </button>
              }
              kids={steps.map((st) => {
                const sOpen = openS.has(st.id);
                const openT = st.tasks.filter((t) => !t.done);
                const doneN = st.tasks.length - openT.length;
                return (
                  <Branch
                    key={st.id}
                    open={sOpen}
                    node={
                      <button type="button" onClick={() => flip(setOpenS, st.id)}
                        className="shrink-0 w-52 text-left rounded-lg border border-[#22324d] bg-[#0c1320] hover:border-indigo-500/50 px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-200 font-medium truncate flex-1">{st.name}</span>
                          {st.tasks.length > 0 && (sOpen ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />)}
                        </div>
                        <div className="text-[10px] text-slate-500">{doneN}/{st.tasks.length} concluídas{openT.some((t) => t.dueDate && new Date(t.dueDate).getTime() < today) ? " · ⚠ atraso" : ""}</div>
                      </button>
                    }
                    kids={[
                      ...openT.slice(0, MAX).map((t) => {
                        const stt = tst(t.status);
                        const due = dueLabel(t.dueDate, today);
                        return (
                          <Link key={t.id} href={taskHref(p.id, t.id)}
                            className="shrink-0 w-60 rounded-md border border-[#1b2940] bg-[#0a1019] hover:border-indigo-500/50 px-2 py-1 block">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stt.dot}`} title={stt.label} />
                              <span className="text-[11px] text-slate-200 truncate">{t.title}</span>
                            </div>
                            <div className="text-[10px] flex gap-1.5">
                              <span className={due.cls}>{due.text}</span>
                              {t.assignee && <span className="text-slate-500 truncate">· {t.assignee}</span>}
                            </div>
                          </Link>
                        );
                      }),
                      ...(openT.length > MAX ? [<span key="mais" className="text-[10px] text-slate-500">+{openT.length - MAX} tarefas</span>] : []),
                      ...(doneN > 0 ? [<span key="done" className="text-[10px] text-emerald-400/70">✓ {doneN} concluída{doneN > 1 ? "s" : ""}</span>] : []),
                    ]}
                  />
                );
              })}
            />
          );
        })}
      </div>
    </div>
  );
}
