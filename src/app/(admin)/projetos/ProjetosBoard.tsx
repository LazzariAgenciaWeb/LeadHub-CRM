"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProjectStatus } from "@/generated/prisma";
import { useTransition, useState } from "react";

type Project = {
  id:              string;
  name:            string;
  type:            string | null;
  status:          ProjectStatus;
  startDate:       Date | string | null;
  dueDate:         Date | string | null;
  deliveredAt:     Date | string | null;
  taskCount:       number;
  taskCompleted:   number;
  taskOverdue:     number;
  lastSyncedAt:    Date | string | null;
  setor:           { id: string; name: string };
  clientCompany:   { id: string; name: string } | null;
  members:         { user: { id: string; name: string } }[];
};

const COLUMNS: { status: ProjectStatus; label: string; color: string }[] = [
  { status: "PLANEJAMENTO", label: "Planejamento", color: "border-slate-500/30 bg-slate-500/5" },
  { status: "EM_ANDAMENTO", label: "Em andamento", color: "border-blue-500/30 bg-blue-500/5" },
  { status: "PAUSADO",      label: "Pausado",      color: "border-amber-500/30 bg-amber-500/5" },
  { status: "ENTREGUE",     label: "Entregues",    color: "border-emerald-500/30 bg-emerald-500/5" },
  { status: "CANCELADO",    label: "Cancelados",   color: "border-red-500/30 bg-red-500/5" },
];

const TYPE_BADGE: Record<string, string> = {
  SITE:     "bg-blue-500/20 text-blue-300",
  MIDIA:    "bg-pink-500/20 text-pink-300",
  CAMPANHA: "bg-orange-500/20 text-orange-300",
  OUTRO:    "bg-slate-500/20 text-slate-300",
};

export default function ProjetosBoard({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [_, startTransition] = useTransition();
  const [moving, setMoving] = useState<string | null>(null);

  function moveTo(projectId: string, status: ProjectStatus) {
    setMoving(projectId);
    fetch(`/api/projetos/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    }).then(() => {
      startTransition(() => router.refresh());
    }).finally(() => setMoving(null));
  }

  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: projects.filter((p) => p.status === col.status),
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
      {grouped.map((col) => (
        <div key={col.status} className={`rounded-xl border ${col.color} flex flex-col`}>
          <div className="px-3 py-2.5 border-b border-[#1e2d45] flex items-center justify-between">
            <span className="text-white text-xs font-semibold">{col.label}</span>
            <span className="text-slate-500 text-[10px]">{col.items.length}</span>
          </div>
          <div className="p-2 space-y-2 min-h-[100px]">
            {col.items.length === 0 ? (
              <div className="text-slate-700 text-[11px] text-center py-6">vazio</div>
            ) : col.items.map((p) => (
              <ProjectCard key={p.id} project={p} onMove={moveTo} moving={moving === p.id} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectCard({
  project, onMove, moving,
}: {
  project: Project;
  onMove: (id: string, status: ProjectStatus) => void;
  moving: boolean;
}) {
  const progress = project.taskCount > 0
    ? Math.round((project.taskCompleted / project.taskCount) * 100)
    : 0;

  const dueDate = project.dueDate ? new Date(project.dueDate) : null;
  const now = new Date();
  const isOverdue = dueDate && dueDate < now && project.status !== "ENTREGUE" && project.status !== "CANCELADO";
  const daysToDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className={`bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-3 hover:border-[#2d3d59] transition-colors ${moving ? "opacity-50" : ""}`}>
      <Link href={`/projetos/${project.id}`} className="block mb-2">
        <div className="flex items-start gap-2 mb-1.5">
          <h3 className="text-white text-xs font-semibold line-clamp-2 flex-1">{project.name}</h3>
          {project.type && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${TYPE_BADGE[project.type] ?? TYPE_BADGE.OUTRO}`}>
              {project.type}
            </span>
          )}
        </div>
        {project.clientCompany && (
          <div className="text-slate-500 text-[10px] mb-1.5">🏢 {project.clientCompany.name}</div>
        )}
        <div className="text-slate-600 text-[10px]">{project.setor.name}</div>
      </Link>

      {/* Progresso */}
      {project.taskCount > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[10px] mb-0.5">
            <span className="text-slate-500">{project.taskCompleted}/{project.taskCount} tarefas</span>
            <span className="text-slate-400 font-medium">{progress}%</span>
          </div>
          <div className="h-1 bg-[#080b12] rounded-full overflow-hidden">
            <div
              className={`h-full ${progress === 100 ? "bg-emerald-500" : "bg-indigo-500"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {project.taskOverdue > 0 && (
            <div className="text-red-400 text-[10px] mt-1">⚠ {project.taskOverdue} atrasadas</div>
          )}
        </div>
      )}

      {/* Prazo */}
      {dueDate && (
        <div className={`text-[10px] mb-2 ${
          isOverdue ? "text-red-400" :
          daysToDue !== null && daysToDue <= 3 ? "text-amber-400" :
          "text-slate-500"
        }`}>
          📅 {dueDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
          {isOverdue ? " (vencido)" :
           daysToDue !== null && daysToDue >= 0 ? ` (em ${daysToDue}d)` : ""}
        </div>
      )}

      {/* Membros */}
      {project.members.length > 0 && (
        <div className="flex gap-1 mb-2">
          {project.members.slice(0, 4).map((m) => (
            <div
              key={m.user.id}
              title={m.user.name}
              className="w-5 h-5 rounded-full bg-[#161f30] border border-[#1e2d45] text-slate-400 text-[9px] flex items-center justify-center font-bold"
            >
              {m.user.name.slice(0, 2).toUpperCase()}
            </div>
          ))}
          {project.members.length > 4 && (
            <span className="text-slate-600 text-[10px] self-center">+{project.members.length - 4}</span>
          )}
        </div>
      )}

      {/* Botões mover */}
      <div className="flex gap-1 flex-wrap">
        {COLUMNS.filter((c) => c.status !== project.status).map((c) => (
          <button
            key={c.status}
            onClick={() => onMove(project.id, c.status)}
            disabled={moving}
            className="text-[9px] px-1.5 py-0.5 rounded bg-[#080b12] hover:bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            → {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
