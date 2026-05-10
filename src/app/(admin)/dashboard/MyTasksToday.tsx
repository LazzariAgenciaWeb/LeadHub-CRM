"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface MyTask {
  id: string;
  title: string;
  dueAt: string;
  done: boolean;
  notes: string | null;
  source: "MANUAL" | "AUTO_LINK_OPEN";
  lead: {
    id: string;
    name: string | null;
    phone: string;
    pipeline: string | null;
  } | null;
}

const PIPELINE_HREF: Record<string, string> = {
  PROSPECCAO: "/crm/prospeccao",
  LEADS: "/crm/leads",
  OPORTUNIDADES: "/crm/oportunidades",
};

function formatDue(iso: string): { label: string; color: string; isOverdue: boolean } {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (d < startToday) {
    const diffDays = Math.ceil((startToday.getTime() - d.getTime()) / 86400000);
    return { label: `atrasada ${diffDays}d`, color: "text-red-400", isOverdue: true };
  }
  if (d <= endToday) {
    return { label: `hoje ${time}`, color: "text-amber-400", isOverdue: false };
  }
  return { label: `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`, color: "text-slate-400", isOverdue: false };
}

export default function MyTasksToday() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tasks/me?scope=today");
        if (!cancelled && res.ok) setTasks(await res.json());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function toggleDone(task: MyTask) {
    setUpdatingIds((s) => new Set(s).add(task.id));
    // optimistic: remove da lista quando marcada
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: true }),
      });
      if (!res.ok) {
        // rollback
        setTasks((prev) => [...prev, task].sort(
          (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
        ));
      }
    } finally {
      setUpdatingIds((s) => { const next = new Set(s); next.delete(task.id); return next; });
    }
  }

  function leadHref(task: MyTask): string {
    if (!task.lead) return "/crm/leads";
    const base = PIPELINE_HREF[task.lead.pipeline ?? ""] ?? "/crm/leads";
    return `${base}?lead=${task.lead.id}`;
  }

  const overdue = tasks.filter((t) => formatDue(t.dueAt).isOverdue);
  const today = tasks.filter((t) => !formatDue(t.dueAt).isOverdue);
  const hotCount = tasks.filter((t) => t.source === "AUTO_LINK_OPEN").length;

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-white font-bold text-sm flex items-center gap-2">
            ⏰ Minhas tarefas de hoje
          </h2>
          {tasks.length > 0 && (
            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-bold">
              {tasks.length}
            </span>
          )}
          {hotCount > 0 && (
            <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full border border-red-500/40 font-bold animate-pulse">
              🔥 {hotCount} sinal{hotCount > 1 ? "s" : ""} quente{hotCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-600 text-xs text-center py-8">Carregando...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🎉</div>
          <div className="text-slate-400 text-sm font-medium">Tudo em dia!</div>
          <div className="text-slate-600 text-xs mt-1">Nenhuma tarefa pra hoje. Bom trabalho.</div>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {[...overdue, ...today].map((t) => {
            const due = formatDue(t.dueAt);
            const isHot = t.source === "AUTO_LINK_OPEN";
            const isUpdating = updatingIds.has(t.id);
            return (
              <li
                key={t.id}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                  isHot
                    ? "bg-red-500/10 border-red-500/30 hover:border-red-500/50"
                    : due.isOverdue
                    ? "bg-red-500/5 border-red-500/15 hover:border-red-500/30"
                    : "bg-[#0a0f1a] border-[#1e2d45] hover:border-amber-500/30"
                } ${isUpdating ? "opacity-50" : ""}`}
              >
                <button
                  onClick={() => toggleDone(t)}
                  disabled={isUpdating}
                  className={`mt-0.5 w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center text-xs transition-colors ${
                    isHot
                      ? "border-red-400 hover:bg-red-500/20"
                      : "border-slate-600 hover:border-amber-400 hover:bg-amber-500/10"
                  }`}
                  title="Marcar como feita"
                  aria-label="Marcar como feita"
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[13px] leading-tight ${isHot ? "text-red-200 font-medium" : "text-slate-200"}`}>
                      {t.title}
                    </span>
                    {isHot && (
                      <span className="bg-red-500/25 text-red-200 border border-red-500/40 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded">
                        Sinal quente
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[11px] ${due.color}`}>{due.label}</span>
                    {t.lead && (
                      <>
                        <span className="text-slate-700 text-[10px]">·</span>
                        <Link
                          href={leadHref(t)}
                          className="text-indigo-400 hover:text-indigo-300 text-[11px] truncate max-w-[200px] hover:underline"
                        >
                          {t.lead.name ?? t.lead.phone}
                        </Link>
                      </>
                    )}
                  </div>
                </div>

                {t.lead && (
                  <Link
                    href={leadHref(t)}
                    className="text-slate-600 hover:text-white text-xs flex-shrink-0 self-center"
                    title="Abrir lead"
                  >
                    →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
