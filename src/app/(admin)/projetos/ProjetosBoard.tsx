"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProjectStatus } from "@/generated/prisma";
import { ExternalLink } from "lucide-react";

type Project = {
  id:              string;
  name:            string;
  type:            string | null;
  status:          ProjectStatus;
  clickupListId:   string;
  startDate:       Date | string | null;
  dueDate:         Date | string | null;
  deliveredAt:     Date | string | null;
  taskCount:       number;
  taskCompleted:   number;
  taskOverdue:     number;
  taskNoDueDate:   number;
  lastSyncedAt:    Date | string | null;
  setor:           { id: string; name: string };
  clientCompany:   { id: string; name: string } | null;
  members:         { user: { id: string; name: string } }[];
};

const COLUMNS: { status: ProjectStatus; label: string; color: string }[] = [
  { status: "PLANEJAMENTO",       label: "Planejamento",       color: "border-slate-500/30 bg-slate-500/5" },
  { status: "EM_ANDAMENTO",       label: "Em andamento",       color: "border-blue-500/30 bg-blue-500/5" },
  { status: "AGUARDANDO_CLIENTE", label: "Aguardando cliente", color: "border-cyan-500/30 bg-cyan-500/5" },
  { status: "PAUSADO",            label: "Pausado",            color: "border-amber-500/30 bg-amber-500/5" },
  { status: "ENTREGUE",           label: "Entregues",          color: "border-emerald-500/30 bg-emerald-500/5" },
  { status: "CANCELADO",          label: "Cancelados",         color: "border-red-500/30 bg-red-500/5" },
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
  const [draggingId, setDraggingId]   = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<ProjectStatus | null>(null);

  function onDragStart(e: React.DragEvent, projectId: string) {
    setDraggingId(projectId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", projectId);
  }

  function onDragEnd() {
    setDraggingId(null);
    setHoverColumn(null);
  }

  function onDragOver(e: React.DragEvent, status: ProjectStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHoverColumn(status);
  }

  async function onDrop(e: React.DragEvent, status: ProjectStatus) {
    e.preventDefault();
    const projectId = e.dataTransfer.getData("text/plain");
    setDraggingId(null);
    setHoverColumn(null);
    if (!projectId) return;
    const proj = projects.find((p) => p.id === projectId);
    if (!proj || proj.status === status) return;
    await fetch(`/api/projetos/${projectId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    });
    startTransition(() => router.refresh());
  }

  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: projects.filter((p) => p.status === col.status),
  }));

  return (
    // Scroll horizontal em qualquer viewport: evita esmagar as 6 colunas em
    // telas pequenas/médias. Cada coluna mantém largura mínima legível e
    // espaçamento confortável entre cards.
    <div className="-mx-6 px-6 overflow-x-auto pb-2">
      <div className="flex gap-4 min-w-max">
        {grouped.map((col) => {
          const isHover = hoverColumn === col.status;
          return (
            <div
              key={col.status}
              onDragOver={(e) => onDragOver(e, col.status)}
              onDragLeave={() => setHoverColumn((h) => h === col.status ? null : h)}
              onDrop={(e) => onDrop(e, col.status)}
              className={`rounded-xl border ${col.color} flex flex-col transition-all w-[280px] flex-shrink-0 ${
                isHover ? "ring-2 ring-fuchsia-500/50 scale-[1.01]" : ""
              }`}
            >
              <div className="px-3 py-2.5 border-b border-[#1e2d45] flex items-center justify-between">
                <span className="text-white text-xs font-semibold">{col.label}</span>
                <span className="text-slate-500 text-[10px]">{col.items.length}</span>
              </div>
              <div className="p-3 space-y-3 min-h-[120px]">
                {col.items.length === 0 ? (
                  <div className="text-slate-700 text-[11px] text-center py-6 italic">
                    {isHover ? "↓ solte aqui" : "vazio"}
                  </div>
                ) : col.items.map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, p.id)}
                    onDragEnd={onDragEnd}
                    className={`cursor-grab active:cursor-grabbing transition-opacity ${
                      draggingId === p.id ? "opacity-40" : ""
                    }`}
                  >
                    <ProjectCard project={p} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const progress = project.taskCount > 0
    ? Math.round((project.taskCompleted / project.taskCount) * 100)
    : 0;

  const dueDate = project.dueDate ? new Date(project.dueDate) : null;
  const now = new Date();
  const finalized = project.status === "ENTREGUE" || project.status === "CANCELADO";
  const waitingClient = project.status === "AGUARDANDO_CLIENTE";
  const isOverdue = dueDate && dueDate < now && !finalized;
  const daysToDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <Link
      href={`/projetos/${project.id}`}
      className="block bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-3 hover:border-[#2d3d59] transition-colors"
    >
      <div className="flex items-start gap-2 mb-2">
        <h3 className="text-white text-xs font-semibold line-clamp-2 flex-1">{project.name}</h3>
        {project.type && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${TYPE_BADGE[project.type] ?? TYPE_BADGE.OUTRO}`}>
            {project.type}
          </span>
        )}
      </div>

      {project.clientCompany && (
        <div className="text-slate-500 text-[10px] mb-1">🏢 {project.clientCompany.name}</div>
      )}

      {/* Setor */}
      <div className="text-slate-400 text-[11px] mb-2 flex items-center gap-1">
        <span className="text-slate-600">📂</span>
        {project.setor.name}
      </div>

      {/* Progresso ClickUp */}
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
          {project.taskNoDueDate > 0 && !waitingClient && (
            <div className="text-amber-400 text-[10px] mt-1" title="-3 pts/dia por membro do projeto até preencher datas no ClickUp">
              ⚠ {project.taskNoDueDate} sem prazo
            </div>
          )}
        </div>
      )}

      {/* Prazo */}
      {dueDate && (
        <div className={`text-[10px] mb-2 ${
          waitingClient ? "text-cyan-400" :
          isOverdue ? "text-red-400" :
          daysToDue !== null && daysToDue <= 3 ? "text-amber-400" :
          "text-slate-500"
        }`}>
          📅 {dueDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
          {waitingClient ? " · pausado pelo cliente" :
           isOverdue ? " (vencido)" :
           daysToDue !== null && daysToDue >= 0 ? ` (em ${daysToDue}d)` : ""}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#1e2d45]">
        {/* Responsáveis */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {project.members.length === 0 ? (
            <span className="text-slate-700 text-[10px] italic">sem responsável</span>
          ) : (
            <>
              {project.members.slice(0, 3).map((m) => (
                <div
                  key={m.user.id}
                  title={m.user.name}
                  className="w-6 h-6 rounded-full bg-[#161f30] border border-[#1e2d45] text-slate-300 text-[9px] flex items-center justify-center font-bold flex-shrink-0"
                >
                  {m.user.name.slice(0, 2).toUpperCase()}
                </div>
              ))}
              {project.members.length > 3 && (
                <span className="text-slate-600 text-[10px]">+{project.members.length - 3}</span>
              )}
            </>
          )}
        </div>

        {/* Link ClickUp */}
        {project.clickupListId && (
          <a
            href={`https://app.clickup.com/${project.clickupListId}/v/li/${project.clickupListId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Abrir lista no ClickUp"
            className="flex-shrink-0 w-6 h-6 rounded bg-[#080b12] hover:bg-[#7B68EE]/20 border border-[#1e2d45] hover:border-[#7B68EE]/40 text-slate-400 hover:text-[#7B68EE] transition-colors flex items-center justify-center"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </Link>
  );
}
