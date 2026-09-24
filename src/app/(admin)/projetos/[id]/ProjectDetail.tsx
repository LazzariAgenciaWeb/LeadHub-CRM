"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Trash2, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pencil, Plus, Link2, X, Check, Lock, Eye, EyeOff, RotateCcw, Clock, MessageSquare } from "lucide-react";
import { ProjectStatus } from "@/generated/prisma";
import { formatBrazilDateTime, formatBrazilDate } from "@/lib/datetime";
import IncidentReporter from "./IncidentReporter";
import VisibilityControl from "@/components/VisibilityControl";
import ProjectServiceSelector from "./ProjectServiceSelector";
import ProjectServicesEditor from "./ProjectServicesEditor";
import ProjectInbox from "./ProjectInbox";
import ProjectMateriais from "./ProjectMateriais";
import AttachmentsPanel from "@/components/attachments/AttachmentsPanel";
import { DescricaoEditor } from "@/components/DescricaoRich";

type Project = {
  id:                  string;
  name:                string;
  description:         string | null;
  type:                string | null;
  clickupListId:       string | null;
  visibility:          string;
  status:              ProjectStatus;
  startDate:           Date | string | null;
  dueDate:             Date | string | null;
  deliveredAt:         Date | string | null;
  taskCount:           number;
  taskCompleted:       number;
  taskOverdue:         number;
  taskNoDueDate:       number;
  lastSyncedAt:        Date | string | null;
  clientExpectedAt:    Date | string | null;
  clientLastContactAt: Date | string | null;
  setor:               { id: string; name: string };
  clientCompany:       { id: string; name: string } | null;
  members:             { user: { id: string; name: string; email: string } }[];
};

const STATUS_LABEL: Record<ProjectStatus, { label: string; color: string; activeColor: string; ringColor: string }> = {
  PLANEJAMENTO:       { label: "Planejamento",       color: "bg-slate-500/20 text-slate-300", activeColor: "bg-slate-500/40 text-slate-100",   ringColor: "ring-slate-400/50" },
  EM_ANDAMENTO:       { label: "Em andamento",       color: "bg-blue-500/20 text-blue-300",    activeColor: "bg-blue-500/40 text-blue-50",      ringColor: "ring-blue-400/60" },
  AGUARDANDO_CLIENTE: { label: "Aguardando cliente", color: "bg-cyan-500/20 text-cyan-300",    activeColor: "bg-cyan-500/40 text-cyan-50",      ringColor: "ring-cyan-400/60" },
  PAUSADO:            { label: "Pausado",            color: "bg-amber-500/20 text-amber-300",  activeColor: "bg-amber-500/40 text-amber-50",    ringColor: "ring-amber-400/60" },
  ENTREGUE:           { label: "Entregue",           color: "bg-emerald-500/20 text-emerald-300", activeColor: "bg-emerald-500/40 text-emerald-50", ringColor: "ring-emerald-400/60" },
  CANCELADO:          { label: "Cancelado",          color: "bg-red-500/20 text-red-300",      activeColor: "bg-red-500/40 text-red-50",        ringColor: "ring-red-400/60" },
};

const ACTIVITY_META: Record<string, { icon: string; text: string; color: string }> = {
  TASK_CREATED:    { icon: "✨", text: "Criada:",            color: "text-cyan-300"    },
  TASK_UPDATED:    { icon: "📝", text: "Atualizada:",        color: "text-amber-300"   },
  TASK_COMPLETED:  { icon: "✅", text: "Concluída:",         color: "text-emerald-300" },
  CLIENT_FOLLOWUP: { icon: "📨", text: "Cobrança ao cliente", color: "text-fuchsia-300" },
  INCIDENT:        { icon: "⚠️", text: "Incidente:",          color: "text-red-400"     },
};

// Ordem sequencial pra navegação com setas
const STATUS_ORDER: ProjectStatus[] = [
  "PLANEJAMENTO",
  "EM_ANDAMENTO",
  "AGUARDANDO_CLIENTE",
  "PAUSADO",
  "ENTREGUE",
  "CANCELADO",
];

type Activity = {
  id:          string;
  type:        string;     // TASK_CREATED | TASK_UPDATED | TASK_COMPLETED | CLIENT_FOLLOWUP
  taskName:    string;
  taskId:      string;
  description: string | null;
  authorName:  string | null;
  createdAt:   Date | string;
};

type OpenTask = {
  id:         string;
  taskId:     string;       // ID no ClickUp (pra deep-link)
  name:       string;
  statusName: string | null;
  dueDate:    number | null; // epoch ms
};

type ChecklistItem = { text: string; done: boolean; doneAt: string | null };
type InternalTask = {
  id:           string;
  title:        string;
  description:  string | null;
  stage:        string | null; // etapa/fase (rótulo)
  projectServiceId: string | null; // serviço da sequência ao qual pertence
  checklist:    ChecklistItem[]; // sub-passos
  comments:     { text: string; at: string; by?: "client"; vis?: boolean }[]; // atualizações datadas (vis:false = interno)
  done:         boolean;
  priority:     string;
  startDate:    string | null; // ISO — início
  dueDate:      string | null; // ISO — fim/prazo
  createdAt:    string; // ISO — abertura
  updatedAt:    string; // ISO — última atualização
  clickupTaskId: string | null; // vínculo ClickUp (se importada)
  status:       string;  // NOVA | EM_PRODUCAO | AGUARDANDO_CLIENTE | APROVADO
  awaitingClient: boolean; // derivado do status
  visibleToClient: boolean; // aparece pro cliente no painel
  ignored:      boolean; // veio do ClickUp mas foi descartada — fora da fila
  assigneeId:   string | null;
  assigneeName: string | null;
  materials: { id: string; kind: string; title: string; url: string | null }[]; // links/anexos da tarefa
};

type Chamado = {
  id:           string;
  title:        string;
  status:       string;
  priority:     string;
  dueDate:      string | null; // ISO
  assigneeName: string | null;
};

const PRIORITY_PILL: Record<string, { label: string; cls: string }> = {
  LOW:    { label: "🟢 Baixa",   cls: "text-emerald-300" },
  MEDIUM: { label: "🟡 Média",   cls: "text-amber-300"   },
  HIGH:   { label: "🟠 Alta",    cls: "text-orange-300"  },
  URGENT: { label: "🔴 Urgente", cls: "text-red-300"     },
};

// Cores das etapas — cada uma ganha a linha inteira tingida, pra separar os
// blocos de relance. Cicla quando passa de 6 etapas.
const STAGE_TONES = [
  { bg: "bg-indigo-500/10",  border: "border-l-indigo-500",  text: "text-indigo-200",  bar: "bg-indigo-500"  },
  { bg: "bg-cyan-500/10",    border: "border-l-cyan-500",    text: "text-cyan-200",    bar: "bg-cyan-500"    },
  { bg: "bg-fuchsia-500/10", border: "border-l-fuchsia-500", text: "text-fuchsia-200", bar: "bg-fuchsia-500" },
  { bg: "bg-amber-500/10",   border: "border-l-amber-500",   text: "text-amber-200",   bar: "bg-amber-500"   },
  { bg: "bg-emerald-500/10", border: "border-l-emerald-500", text: "text-emerald-200", bar: "bg-emerald-500" },
  { bg: "bg-rose-500/10",    border: "border-l-rose-500",    text: "text-rose-200",    bar: "bg-rose-500"    },
];

// Status da tarefa interna — fonte única do andamento (deriva concluída e
// aguardando-cliente no backend).
const TASK_STATUS: { id: string; label: string; badge: string; dot: string }[] = [
  { id: "NOVA",               label: "Nova",               badge: "bg-slate-500/15 text-slate-300 border-slate-500/30",     dot: "bg-slate-400"   },
  { id: "EM_PRODUCAO",        label: "Em produção",        badge: "bg-blue-500/15 text-blue-300 border-blue-500/30",        dot: "bg-blue-400"    },
  { id: "AGUARDANDO_CLIENTE", label: "Aguardando cliente", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",     dot: "bg-amber-400"   },
  { id: "APROVADO",           label: "Aprovado",           badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400" },
];
const statusOf = (id: string) => TASK_STATUS.find((s) => s.id === id) ?? TASK_STATUS[0];

const TICKET_STATUS_LABEL: Record<string, string> = {
  OPEN: "Aberto", IN_PROGRESS: "Em andamento", RESOLVED: "Resolvido", CLOSED: "Fechado",
};

export default function ProjectDetail({
  project, availableUsers, companyUsers, accessUserIds, activities, clientCompanies, openTasks, internalTasks, chamados,
  catalogServices, serviceSteps, currentServiceId, materials, publicToken,
}: {
  project: Project;
  availableUsers: { id: string; name: string }[];
  companyUsers: { id: string; name: string }[];
  accessUserIds: string[];
  activities: Activity[];
  clientCompanies: { id: string; name: string }[];
  openTasks: OpenTask[];
  internalTasks: InternalTask[];
  chamados: Chamado[];
  catalogServices: { id: string; name: string }[];
  serviceSteps: { id: string; name: string; order: number; taskCount: number; doneCount: number; visibleToClient: boolean }[];
  currentServiceId: string | null;
  materials: { id: string; kind: string; taskId: string | null; stage: string | null; title: string; docHtml: string | null; url: string | null; ata: string | null; featured: boolean; visibleToClient: boolean }[];
  publicToken: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  // Colapsáveis do rodapé — reduzem a percepção de "muita coisa" na página.
  // Chamados abre por padrão só quando tem pouca coisa; histórico começa fechado.
  const [chamadosOpen, setChamadosOpen] = useState(false);
  const [historicoOpen, setHistoricoOpen] = useState(false);

  // ClickUp: quais tarefas já foram importadas como interna (pra não duplicar).
  const importedClickupIds = new Set(internalTasks.map((t) => t.clickupTaskId).filter((x): x is string => !!x));
  const [importing, setImporting] = useState<string | null>(null);
  async function importFromClickup(taskId: string) {
    setImporting(taskId);
    await fetch(`/api/projetos/${project.id}/tasks/import-clickup`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ taskId }),
    }).catch(() => {});
    setImporting(null);
    router.refresh();
  }

  // Importação em massa do ClickUp — seleciona várias tarefas abertas e importa.
  const importableIds = openTasks.map((t) => t.taskId).filter((tid) => !importedClickupIds.has(tid));
  const [importSel, setImportSel] = useState<Set<string>>(new Set());
  const [bulkImporting, setBulkImporting] = useState(false);
  function toggleImportSel(taskId: string) {
    setImportSel((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }
  async function importBulk() {
    if (importSel.size === 0) return;
    setBulkImporting(true);
    await fetch(`/api/projetos/${project.id}/tasks/import-clickup`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ taskIds: Array.from(importSel) }),
    }).catch(() => {});
    setBulkImporting(false);
    setImportSel(new Set());
    router.refresh();
  }

  const [form, setForm] = useState({
    name:        project.name,
    description: project.description ?? "",
    dueDate:     project.dueDate     ? new Date(project.dueDate).toISOString().slice(0, 10) : "",
    startDate:   project.startDate   ? new Date(project.startDate).toISOString().slice(0, 10) : "",
    status:      project.status,
  });
  const [memberIds, setMemberIds] = useState(project.members.map((m) => m.user.id));

  async function save() {
    setSaving(true);
    await fetch(`/api/projetos/${project.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ...form, memberIds }),
    });
    setSaving(false);
    router.refresh();
  }

  async function changeStatus(status: ProjectStatus) {
    setSaving(true);
    await fetch(`/api/projetos/${project.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    });
    setSaving(false);
    router.refresh();
  }

  async function deleteProject() {
    if (!confirm("Excluir o projeto? Os pontos atrelados serão revertidos.")) return;
    await fetch(`/api/projetos/${project.id}`, { method: "DELETE" });
    router.push("/projetos");
  }

  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  async function syncNow() {
    setSaving(true);
    setSyncMsg(null);
    try {
      const res  = await fetch(`/api/projetos/${project.id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSyncMsg(`❌ ${data.error ?? "Erro ao sincronizar"}`);
      } else {
        const a = data.activities ?? {};
        const summary = [
          `${data.tasksFound} tarefas encontradas`,
          a.created   ? `${a.created} criadas`     : null,
          a.updated   ? `${a.updated} atualizadas` : null,
          a.completed ? `${a.completed} concluídas`: null,
        ].filter(Boolean).join(" · ");
        setSyncMsg(`✓ ${summary}`);
        router.refresh();
      }
    } catch (err: any) {
      setSyncMsg(`❌ ${err?.message ?? "Erro de rede"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSyncMsg(null), 6000);
    }
  }

  const progress = project.taskCount > 0 ? Math.round((project.taskCompleted / project.taskCount) * 100) : 0;
  const dueDate = project.dueDate ? new Date(project.dueDate) : null;
  const isOverdue = dueDate && dueDate < new Date() && project.status !== "ENTREGUE";

  function toggleMember(uid: string) {
    setMemberIds((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/projetos" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar pra projetos
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            onBlur={save}
            className="text-white font-bold text-xl bg-transparent border-0 focus:outline-none focus:bg-[#0a0f1a] rounded px-1 -mx-1 w-full"
          />
          <div className="flex items-center gap-2 mt-1">
            <span className="text-slate-500 text-xs">{project.setor.name}</span>
            {project.clientCompany && <>
              <span className="text-slate-700">·</span>
              <span className="text-slate-500 text-xs">🏢 {project.clientCompany.name}</span>
            </>}
            {project.type && <>
              <span className="text-slate-700">·</span>
              <span className="text-slate-500 text-xs">{project.type}</span>
            </>}
          </div>
        </div>
        <button
          onClick={deleteProject}
          className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"
          title="Excluir"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div>
        {/* Coluna principal — full width; toda a config foi pro modal (botão abaixo) */}
        <div className="space-y-5">
          <div className="flex justify-end">
            <button onClick={() => setConfigOpen(true)} className="text-xs px-3 py-1.5 rounded-lg border border-[#1e2d45] text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors">
              ⚙ Configurar projeto
            </button>
          </div>
          {/* Status — pipeline horizontal com navegação */}
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-500 text-xs uppercase tracking-wider">Status</span>
            </div>

            <StatusPipeline
              current={project.status}
              onChange={changeStatus}
              disabled={saving}
            />

            {project.deliveredAt && (
              <div className="mt-3 text-emerald-300 text-xs">
                ✓ Entregue em {formatBrazilDateTime(project.deliveredAt)}
              </div>
            )}
            {project.status === "AGUARDANDO_CLIENTE" && (
              <FollowupBlock project={project} />
            )}
          </div>

          {/* Progresso ClickUp — só quando há lista vinculada */}
          {project.clickupListId && (
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-white text-sm font-semibold">Progresso (ClickUp)</span>
                <p className="text-slate-500 text-xs mt-0.5">
                  {project.lastSyncedAt
                    ? `Última sync: ${formatBrazilDateTime(project.lastSyncedAt)}`
                    : "Aguardando primeira sincronização"}
                </p>
              </div>
              <button
                onClick={syncNow}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded bg-[#080b12] hover:bg-[#161f30] border border-[#1e2d45] text-slate-300 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${saving ? "animate-spin" : ""}`} /> Sync
              </button>
            </div>
            {syncMsg && (
              <div className={`text-[11px] mb-2 px-2 py-1 rounded border ${
                syncMsg.startsWith("✓")
                  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                  : "text-red-300 bg-red-500/10 border-red-500/30"
              }`}>
                {syncMsg}
              </div>
            )}
            {project.taskCount > 0 ? (
              <>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400">{project.taskCompleted} de {project.taskCount} tarefas</span>
                  <span className="text-white font-semibold">{progress}%</span>
                </div>
                <div className="h-2 bg-[#080b12] rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full ${progress === 100 ? "bg-emerald-500" : "bg-indigo-500"}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {project.taskOverdue > 0 && (
                  <div className="text-red-400 text-xs">⚠ {project.taskOverdue} tarefas atrasadas</div>
                )}
                {project.taskNoDueDate > 0 && (
                  <div className="text-amber-400 text-xs mt-1">
                    ⚠ {project.taskNoDueDate} tarefas sem prazo no ClickUp · -3 pts/dia por membro do projeto
                  </div>
                )}

                {/* Lista de importação manual removida: o espelho automático do
                    ClickUp + a Caixa de entrada abaixo já trazem tudo. */}
              </>
            ) : (
              <p className="text-slate-600 text-xs">Sem dados ainda. Clique em Sync.</p>
            )}
            <a
              href={`https://app.clickup.com/${project.clickupListId}/v/li/${project.clickupListId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200 text-xs mt-3"
            >
              Abrir no ClickUp <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          )}

          {/* KPIs do projeto */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-indigo-300 tabular-nums leading-none">{serviceSteps.length}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">Serviços</div>
            </div>
            <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-white tabular-nums leading-none">{internalTasks.filter((t) => !t.ignored).length}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">Tarefas</div>
            </div>
            <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-amber-300 tabular-nums leading-none">{internalTasks.filter((t) => !t.done && !t.ignored).length}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">Em andamento</div>
            </div>
            <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-emerald-300 tabular-nums leading-none">{internalTasks.filter((t) => t.visibleToClient && !t.ignored).length}</div>
              <div className="text-[11px] text-slate-500 mt-1.5">Visíveis ao cliente</div>
            </div>
          </div>

          {/* Tarefas do projeto (LeadHub + ClickUp) — a Caixa de entrada virou
              a aba "A organizar" lá dentro, pra não repetir as mesmas tarefas. */}
          <ProjectTasksCard
            projectId={project.id}
            availableUsers={availableUsers}
            internalTasks={internalTasks}
            hasClickup={!!project.clickupListId}
            serviceSteps={serviceSteps}
          />

          {/* Materiais, anexos, links & link do cliente */}
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">📎 Materiais, anexos &amp; link do cliente</h3>
            <ProjectMateriais
              projectId={project.id}
              tasks={internalTasks.map((t) => ({ id: t.id, title: t.title }))}
              materials={materials}
              publicToken={publicToken}
            />
          </div>

          {/* Chamados agrupados no projeto — colapsável, começa fechado */}
          {chamados.length > 0 && (
            <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
              <button
                onClick={() => setChamadosOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-5 py-3.5 hover:bg-[#080b12] transition-colors text-left"
                aria-expanded={chamadosOpen}
              >
                <h3 className="text-white font-semibold text-sm">🎫 Chamados do projeto ({chamados.length})</h3>
                {chamadosOpen ? <ChevronUp className="w-4 h-4 text-slate-500 flex-none" /> : <ChevronDown className="w-4 h-4 text-slate-500 flex-none" />}
              </button>
              {chamadosOpen && (
              <div className="divide-y divide-[#1e2d45] border-t border-[#1e2d45]">
                {chamados.map((c) => {
                  const due = c.dueDate ? new Date(c.dueDate) : null;
                  const overdue = due && due < new Date() && c.status !== "RESOLVED" && c.status !== "CLOSED";
                  const done = c.status === "RESOLVED" || c.status === "CLOSED";
                  return (
                    <Link
                      key={c.id}
                      href={`/chamados/${c.id}`}
                      className="flex items-start gap-2 px-5 py-2.5 hover:bg-[#080b12] group"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        done ? "bg-emerald-400" : overdue ? "bg-red-400" : "bg-slate-500"
                      }`} />
                      <div className="min-w-0 flex-1">
                        <span className={`text-xs ${done ? "text-slate-500 line-through" : "text-slate-200 group-hover:text-white"}`}>
                          {c.title}
                        </span>
                        <div className="text-[10px] text-slate-600 mt-0.5">
                          {TICKET_STATUS_LABEL[c.status] ?? c.status}
                          {c.assigneeName && <> · {c.assigneeName}</>}
                        </div>
                      </div>
                      {due && (
                        <span className={`text-[10px] font-medium flex-shrink-0 ${overdue ? "text-red-300" : "text-slate-500"}`}>
                          {formatBrazilDate(due)}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
              )}
            </div>
          )}

          {/* Histórico de tarefas (do ClickUp) — colapsável, começa fechado */}
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
            <button
              onClick={() => setHistoricoOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-5 py-3.5 hover:bg-[#080b12] transition-colors text-left"
              aria-expanded={historicoOpen}
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-white font-semibold text-sm">📋 Histórico de tarefas</h3>
                <p className="text-slate-500 text-xs mt-0.5">
                  {activities.length === 0 ? "Sem movimentações ainda." : `${activities.length} movimentaç${activities.length === 1 ? "ão" : "ões"} detectada${activities.length === 1 ? "" : "s"} do ClickUp.`}
                </p>
              </div>
              {historicoOpen ? <ChevronUp className="w-4 h-4 text-slate-500 flex-none" /> : <ChevronDown className="w-4 h-4 text-slate-500 flex-none" />}
            </button>
            {historicoOpen && (
              <div className="border-t border-[#1e2d45]">
                {activities.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 text-xs">
                    Faça uma sync e edite tarefas no ClickUp — cada movimentação vira pontos de gamificação.
                  </div>
                ) : (
                  <div className="divide-y divide-[#1e2d45] max-h-[420px] overflow-y-auto">
                    {activities.map((a) => {
                      const meta = ACTIVITY_META[a.type] ?? { icon: "📝", text: "Atualizada", color: "text-slate-400" };
                      const isFollowup = a.type === "CLIENT_FOLLOWUP";
                      const isIncident = a.type === "INCIDENT";
                      return (
                        <div key={a.id} className="flex items-start gap-2 px-5 py-2.5 hover:bg-[#080b12]/50">
                          <span className="text-base flex-shrink-0 mt-0.5">{meta.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-slate-300 text-xs">
                              <span className={`font-medium ${meta.color}`}>{meta.text}</span>
                              {!isFollowup && <> <span className="text-white truncate">{a.taskName}</span></>}
                            </div>
                            {isFollowup && a.description && (
                              <div className="mt-1 text-slate-200 text-xs whitespace-pre-wrap bg-fuchsia-500/5 border border-fuchsia-500/20 rounded px-2 py-1.5">
                                {a.description}
                              </div>
                            )}
                            {isIncident && a.description && (
                              <div className="mt-1 text-red-200 text-xs whitespace-pre-wrap bg-red-500/5 border border-red-500/30 rounded px-2 py-1.5">
                                {a.description}
                              </div>
                            )}
                            <div className="text-slate-600 text-[10px] mt-0.5">
                              {a.authorName && <>{a.authorName} · </>}
                              {formatBrazilDateTime(a.createdAt)}
                            </div>
                          </div>
                          {!isFollowup && !isIncident && a.taskId && (
                            <a
                              href={`https://app.clickup.com/t/${a.taskId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-600 hover:text-[#7B68EE] flex-shrink-0 mt-0.5"
                              title="Abrir tarefa no ClickUp"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Configuração do projeto — modal (abre pelo botão "⚙ Configurar projeto") */}
        {configOpen && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={() => setConfigOpen(false)}>
            <div className="w-full max-w-md h-full overflow-y-auto bg-[#0b111c] border-l border-[#1e2d45] p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold text-sm">⚙ Configuração do projeto</h3>
                <button onClick={() => setConfigOpen(false)} className="text-slate-500 hover:text-white" aria-label="Fechar"><X className="w-5 h-5" /></button>
              </div>
          {/* Datas */}
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5 space-y-3">
            <div>
              <label className="text-slate-500 text-xs uppercase tracking-wider block mb-1">Início</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                onBlur={save}
                className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-500 text-xs uppercase tracking-wider block mb-1">
                Prazo {isOverdue && <span className="text-red-400">(vencido)</span>}
              </label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                onBlur={save}
                className={`w-full bg-[#080b12] border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 ${
                  isOverdue ? "border-red-500/40" : "border-[#1e2d45]"
                }`}
              />
              {dueDate && project.status !== "ENTREGUE" && (
                <p className="text-slate-600 text-[10px] mt-1">
                  {formatBrazilDate(dueDate)}
                </p>
              )}
            </div>
            <div>
              <label className="text-slate-500 text-xs uppercase tracking-wider block mb-1">Descrição</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                onBlur={save}
                rows={3}
                placeholder="Escopo, observações, links..."
                className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
          </div>

          {/* Membros */}
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
            <span className="text-slate-500 text-xs uppercase tracking-wider block mb-3">
              Equipe ({memberIds.length})
            </span>
            {availableUsers.length === 0 ? (
              <p className="text-slate-600 text-xs">Setor sem usuários cadastrados.</p>
            ) : (
              <div className="space-y-1.5">
                {availableUsers.map((u) => {
                  const checked = memberIds.includes(u.id);
                  return (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(u.id)}
                        className="w-4 h-4 rounded accent-indigo-500"
                      />
                      <span className={checked ? "text-white" : "text-slate-400"}>{u.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <button
              onClick={save}
              disabled={saving}
              className="mt-3 w-full px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar equipe"}
            </button>
          </div>

          {/* Cliente vinculado (editável + criar novo) */}
          <ClientSelector
            projectId={project.id}
            current={project.clientCompany}
            companies={clientCompanies}
          />

          {/* Serviço do catálogo — vincula pra contar como contratado (carro-chefe) */}
          <ProjectServiceSelector
            projectId={project.id}
            currentServiceId={currentServiceId}
            services={catalogServices}
          />

          {/* Serviços em sequência — agrupam as tarefas no Gantt do cliente */}
          <ProjectServicesEditor
            projectId={project.id}
            steps={serviceSteps}
            services={catalogServices}
          />

          {/* Visibilidade: aberto/restrito + pessoas extras */}
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
            <VisibilityControl
              kind="project"
              id={project.id}
              visibility={project.visibility ?? "OPEN"}
              accessUserIds={accessUserIds}
              users={companyUsers}
            />
          </div>

          {/* List ID do ClickUp (editável) */}
          <ClickupListIdEditor
            projectId={project.id}
            current={project.clickupListId}
          />

          {/* Registrar incidente (admin penaliza membro do projeto) */}
          <IncidentReporter
            projectId={project.id}
            members={project.members.map((m) => ({ id: m.user.id, name: m.user.name }))}
          />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Pipeline horizontal de status. O ativo aparece colorido com a cor da
 * categoria; os outros ficam discretos. Setas <> permitem navegar
 * sequencialmente; clique direto em qualquer pílula faz jump.
 */
function StatusPipeline({
  current, onChange, disabled,
}: {
  current:  ProjectStatus;
  onChange: (s: ProjectStatus) => void;
  disabled: boolean;
}) {
  const idx = STATUS_ORDER.indexOf(current);
  const prev = idx > 0 ? STATUS_ORDER[idx - 1] : null;
  const next = idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => prev && onChange(prev)}
        disabled={disabled || !prev}
        title={prev ? `Voltar pra ${STATUS_LABEL[prev].label}` : ""}
        className="w-8 h-8 flex-shrink-0 rounded-lg bg-[#080b12] hover:bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="flex-1 flex items-center gap-1 overflow-x-auto">
        {STATUS_ORDER.map((s) => {
          const meta = STATUS_LABEL[s];
          const isActive = s === current;
          return (
            <button
              key={s}
              onClick={() => !isActive && onChange(s)}
              disabled={disabled || isActive}
              className={`flex-1 min-w-fit text-[11px] font-medium px-2.5 py-2 rounded-lg transition-all whitespace-nowrap ${
                isActive
                  ? `${meta.activeColor} ring-2 ${meta.ringColor} font-bold shadow-lg`
                  : "bg-[#080b12] hover:bg-[#161f30] border border-[#1e2d45] text-slate-500 hover:text-slate-300"
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => next && onChange(next)}
        disabled={disabled || !next}
        title={next ? `Avançar pra ${STATUS_LABEL[next].label}` : ""}
        className="w-8 h-8 flex-shrink-0 rounded-lg bg-[#080b12] hover:bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Bloco que aparece quando projeto está em AGUARDANDO_CLIENTE.
 * Mostra última cobrança, próxima previsão de retorno, e form pra registrar
 * uma nova cobrança (gera ProjectActivity tipo CLIENT_FOLLOWUP).
 */
function FollowupBlock({ project }: { project: Project }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [expectedAt, setExpectedAt] = useState(
    project.clientExpectedAt ? new Date(project.clientExpectedAt).toISOString().slice(0, 10) : ""
  );
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!text.trim()) return;
    setSaving(true);
    await fetch(`/api/projetos/${project.id}/followup`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: text, expectedAt: expectedAt || null }),
    });
    setSaving(false);
    setText("");
    setOpen(false);
    router.refresh();
  }

  const lastContact   = project.clientLastContactAt ? new Date(project.clientLastContactAt) : null;
  const expectedDate  = project.clientExpectedAt    ? new Date(project.clientExpectedAt)    : null;
  const isExpectedOverdue = expectedDate && expectedDate < new Date();

  return (
    <div className="mt-3 bg-cyan-500/5 border border-cyan-500/30 rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-base">⏸</span>
        <div className="flex-1 text-cyan-200 text-xs leading-relaxed">
          <strong>Aguardando retorno do cliente.</strong>{" "}
          Tarefas atrasadas e sem prazo no ClickUp <strong>continuam penalizando</strong> —
          atualize o status / cobre o cliente.
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <div className="bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1.5">
          <span className="text-slate-500 block">Última cobrança</span>
          <span className="text-white">
            {lastContact ? formatBrazilDateTime(lastContact) : "— nenhuma ainda"}
          </span>
        </div>
        <div className={`border rounded px-2 py-1.5 ${
          isExpectedOverdue ? "bg-red-500/5 border-red-500/30" : "bg-[#080b12] border-[#1e2d45]"
        }`}>
          <span className="text-slate-500 block">Próxima previsão</span>
          <span className={isExpectedOverdue ? "text-red-300 font-bold" : "text-white"}>
            {expectedDate
              ? `${formatBrazilDate(expectedDate)}${isExpectedOverdue ? " · vencida" : ""}`
              : "— sem previsão"}
          </span>
        </div>
      </div>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full text-xs px-3 py-1.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-medium border border-cyan-500/30"
        >
          📨 Registrar cobrança
        </button>
      ) : (
        <div className="space-y-2 bg-[#080b12] rounded p-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Ex: Mandei mensagem cobrando aprovação do wireframe. Disse que retorna até sexta."
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 resize-none"
          />
          <div className="flex items-center gap-2">
            <label className="text-slate-500 text-[10px]">Próxima previsão:</label>
            <input
              type="date"
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
              className="bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={saving || !text.trim()}
              className="flex-1 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button
              onClick={() => { setOpen(false); setText(""); }}
              className="px-3 py-1.5 rounded text-slate-400 hover:text-white text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Chip de etapa editável inline numa tarefa. Clica → vira input (com sugestões
 * das etapas já usadas) → Enter/blur salva. Vazio = "sem etapa".
 */
function StageChip({
  value, suggestions, onSave,
}: {
  value: string | null;
  suggestions: string[];
  onSave: (s: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  if (editing) {
    return (
      <>
        <input
          list="etapas-list"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); if ((draft.trim() || null) !== (value || null)) onSave(draft); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { setEditing(false); if ((draft.trim() || null) !== (value || null)) onSave(draft); }
            if (e.key === "Escape") { setEditing(false); setDraft(value ?? ""); }
          }}
          placeholder="Etapa"
          className="bg-[#0a0f1a] border border-indigo-500/60 rounded px-1.5 py-0.5 text-[10px] text-white w-28 focus:outline-none"
        />
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className={
        value
          ? "px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-medium"
          : "px-1.5 py-0.5 rounded text-slate-600 border border-dashed border-slate-700 hover:text-indigo-300 hover:border-indigo-500/40"
      }
      title="Definir etapa"
    >
      {value || "+ etapa"}
    </button>
  );
}

/**
 * Editor de checklist leve (sub-passos) de uma tarefa. Guarda estado local e
 * persiste o array inteiro via PATCH a cada mudança (sem router.refresh pra não
 * recolher). O cliente vê esses passos com ✓ na página pública.
 */
function ChecklistEditor({
  projectId, taskId, initial,
}: {
  projectId: string;
  taskId: string;
  initial: ChecklistItem[];
}) {
  const [items, setItems] = useState<ChecklistItem[]>(initial);
  const [text, setText] = useState("");

  async function persist(next: ChecklistItem[]) {
    setItems(next);
    await fetch(`/api/projetos/${projectId}/tasks/${taskId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ checklist: next }),
    }).catch(() => {});
  }
  function add() {
    const t = text.trim();
    if (!t) return;
    persist([...items, { text: t, done: false, doneAt: null }]);
    setText("");
  }
  function toggle(i: number) {
    persist(items.map((x, idx) => {
      if (idx !== i) return x;
      const nowDone = !x.done;
      return { ...x, done: nowDone, doneAt: nowDone ? new Date().toISOString() : null };
    }));
  }

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="text-[11px] text-slate-500 font-medium">{doneCount} de {items.length} concluído{doneCount === 1 ? "" : "s"}</div>
      )}
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2.5 group/ck bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2">
          <input
            type="checkbox"
            checked={it.done}
            onChange={() => toggle(i)}
            className="w-4 h-4 rounded accent-emerald-500 cursor-pointer flex-shrink-0"
          />
          <span className={`text-sm flex-1 min-w-0 ${it.done ? "text-slate-500 line-through" : "text-slate-200"}`}>{it.text}</span>
          {it.done && it.doneAt && (
            <span className="text-[10px] text-emerald-500/90 whitespace-nowrap flex-shrink-0">
              ✓ {new Date(it.doneAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => persist(items.filter((_, idx) => idx !== i))}
            className="text-slate-600 hover:text-red-400 opacity-0 group-hover/ck:opacity-100 flex-shrink-0"
            title="Remover passo"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Escreva um passo e clique em Adicionar…"
          className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
        <button onClick={add} disabled={!text.trim()} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-1 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Adicionar
        </button>
      </div>
    </div>
  );
}

/**
 * Editor inline de uma tarefa: título, descrição, início/fim, e um atalho pra
 * adicionar link/anexo direto na tarefa (cria ProjectMaterial com taskId).
 */
function TaskEditor({ projectId, task, onClose, stageSuggestions, serviceSteps, hasClickup, availableUsers }: { projectId: string; task: InternalTask; onClose: () => void; stageSuggestions: string[]; serviceSteps: { id: string; name: string; order: number; taskCount: number; doneCount: number }[]; hasClickup: boolean; availableUsers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(task.title);
  const [stage, setStage] = useState(task.stage ?? "");
  const [svcId, setSvcId] = useState(task.projectServiceId ?? "");
  const [description, setDescription] = useState(task.description ?? "");
  const [startDate, setStartDate] = useState(task.startDate ? task.startDate.slice(0, 10) : "");
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const dirtyRef = useRef(false);
  const [taskStatus, setTaskStatus] = useState(task.status);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");

  // Aviso de "salvo" some sozinho depois de 2s — é confirmação, não estado fixo.
  useEffect(() => {
    if (!savedAt) return;
    const id = setTimeout(() => setSavedAt(null), 2000);
    return () => clearTimeout(id);
  }, [savedAt]);

  async function changeStatus(next: string) {
    setTaskStatus(next);
    setAutoSaving(true);
    const res = await fetch(`/api/projetos/${projectId}/tasks/${task.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    }).catch(() => null);
    setAutoSaving(false);
    if (res?.ok) setSavedAt(Date.now());
    else setTaskStatus(task.status);
  }
  const [matTitle, setMatTitle] = useState("");
  const [matUrl, setMatUrl] = useState("");
  const [matMsg, setMatMsg] = useState("");
  const [linkOpen, setLinkOpen] = useState(false); // composer de link externo
  const [comments, setComments] = useState(task.comments);
  const [newComment, setNewComment] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [visible, setVisible] = useState(task.visibleToClient);
  const [pushing, setPushing] = useState(false);

  async function pushToClickup() {
    setPushing(true);
    await fetch(`/api/projetos/${projectId}/tasks/${task.id}/push-clickup`, { method: "POST" }).catch(() => {});
    setPushing(false);
    router.refresh();
  }

  async function toggleVisible() {
    const v = !visible;
    setVisible(v);
    await fetch(`/api/projetos/${projectId}/tasks/${task.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ visibleToClient: v }),
    }).catch(() => {});
    router.refresh();
  }

  const inCls = "w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

  async function persistComments(next: { text: string; at: string; by?: "client"; vis?: boolean }[]) {
    setComments(next);
    await fetch(`/api/projetos/${projectId}/tasks/${task.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ comments: next }),
    }).catch(() => {});
    router.refresh();
  }
  async function addComment() {
    const text = newComment.trim();
    if (!text) return;
    const internal = commentInternal;
    setNewComment("");
    setCommentInternal(false);
    // Otimista + sobe pro ClickUp (se a tarefa for vinculada) via endpoint dedicado.
    setComments((prev) => [...prev, internal ? { text, at: new Date().toISOString(), vis: false } : { text, at: new Date().toISOString() }]);
    const res = await fetch(`/api/projetos/${projectId}/tasks/${task.id}/comment`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(internal ? { text, vis: false } : { text }),
    }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.comments) setComments(data.comments);
    }
    router.refresh();
  }

  function payload() {
    return {
      title:       title.trim(),
      ...(serviceSteps.length > 0 ? { projectServiceId: svcId || null } : { stage: stage.trim() || null }),
      description: description.trim() || null,
      startDate:   startDate ? new Date(startDate).toISOString() : null,
      dueDate:     dueDate ? new Date(dueDate).toISOString() : null,
      assigneeId:  assigneeId || null,
    };
  }

  async function persist() {
    if (!title.trim()) return false;
    const res = await fetch(`/api/projetos/${projectId}/tasks/${task.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload()),
    }).catch(() => null);
    return !!res?.ok;
  }

  // Auto-save ao sair do campo — evita ter que clicar em Salvar o tempo todo.
  // Não fecha o modal nem dá refresh (refresh remontaria o formulário no meio
  // da edição); a lista se atualiza quando o modal fecha.
  async function saveQuiet() {
    if (!title.trim()) return;
    setAutoSaving(true);
    const ok = await persist();
    setAutoSaving(false);
    if (ok) {
      setSavedAt(Date.now());
      dirtyRef.current = false;
    }
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    await persist();
    setSaving(false);
    onClose();
    router.refresh();
  }

  async function addMaterial() {
    if (!matTitle.trim() || !matUrl.trim()) { setMatMsg("Preencha título e link."); return; }
    setMatMsg("");
    const res = await fetch(`/api/projetos/${projectId}/materiais`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ kind: "LINK", taskId: task.id, title: matTitle.trim(), url: matUrl.trim() }),
    });
    if (res.ok) { setMatTitle(""); setMatUrl(""); setMatMsg("✓ adicionado"); router.refresh(); }
    else setMatMsg("Falha ao adicionar.");
  }

  async function removeMaterial(materialId: string) {
    const res = await fetch(`/api/projetos/${projectId}/materiais/${materialId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  // Upload de print pro descritivo: lê o arquivo em base64, cria um material
  // INLINE e devolve o id (o token [[img:id]] é inserido pelo editor).
  const descMediaUrl = (mid: string) => `/api/projetos/${projectId}/materiais/${mid}/media`;
  async function uploadDescImage(file: File): Promise<string | null> {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(file);
    }).catch(() => "") as string;
    if (!dataUrl) return null;
    const res = await fetch(`/api/projetos/${projectId}/materiais`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ kind: "INLINE", taskId: task.id, title: file.name || "Print", mediaBase64: dataUrl }),
    });
    if (!res.ok) return null;
    const m = await res.json();
    return (m?.id as string) ?? null;
  }

  const pill = (on: boolean, tone: "amber" | "emerald") =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${
      on
        ? tone === "amber"
          ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
          : "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
        : "bg-[#0a0f1a] border-[#1e2d45] text-slate-500 hover:text-slate-300"
    }`;

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

  // Situação do prazo — em dias-calendário, pra "vence hoje" não virar atraso.
  const prazo = (() => {
    if (taskStatus === "APROVADO") return { msg: "concluída", late: false, soon: false };
    if (!dueDate) return { msg: "", late: false, soon: false };
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const fim = new Date(`${dueDate}T00:00:00`);
    const dias = Math.round((fim.getTime() - hoje.getTime()) / 86400000);
    if (dias < 0)  return { msg: `atrasada ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? "s" : ""}`, late: true,  soon: false };
    if (dias === 0) return { msg: "vence hoje",  late: false, soon: true };
    if (dias <= 3)  return { msg: `faltam ${dias} dia${dias > 1 ? "s" : ""}`, late: false, soon: true };
    return { msg: `no prazo · ${dias} dias`, late: false, soon: false };
  })();

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Aviso de salvamento — flutua no canto, aparece só quando acontece algo */}
      {(autoSaving || savedAt) && (
        <div className={`absolute bottom-3 right-3 z-10 pointer-events-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium shadow-lg transition-opacity ${
          autoSaving
            ? "bg-[#0f1729] border-[#1e2d45] text-slate-400"
            : "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
        }`}>
          {autoSaving ? "salvando…" : <><Check className="w-3 h-3" strokeWidth={3} /> salvo</>}
        </div>
      )}

      {/* Título — único no modal (o cabeçalho não repete mais) */}
      <input
        value={title}
        onChange={(e) => { setTitle(e.target.value); dirtyRef.current = true; }}
        onBlur={saveQuiet}
        placeholder="Título da tarefa"
        className="shrink-0 w-full bg-transparent border-0 text-white text-lg font-semibold tracking-tight px-1 -mx-1 mb-3 rounded focus:outline-none focus:bg-[#0a0f1a] placeholder-slate-600"
      />

      {/* Trilha de andamento + prazo */}
      <div className="shrink-0 mb-3 space-y-2">
        <div className="flex items-center gap-1">
          {TASK_STATUS.map((s, i) => {
            const cur = TASK_STATUS.findIndex((x) => x.id === taskStatus);
            const isCur = s.id === taskStatus;
            const passed = i < cur;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => changeStatus(s.id)}
                title={`Marcar como ${s.label}`}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border text-[11px] font-semibold transition-colors ${
                  isCur ? s.badge : passed
                    ? "bg-[#0f1729] border-[#1e2d45] text-slate-400"
                    : "bg-[#0a0f1a] border-[#1e2d45] text-slate-600 hover:text-slate-300"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isCur || passed ? s.dot : "bg-slate-700"}`} />
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <label className="flex items-center gap-1.5 text-slate-500">
            Início
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); dirtyRef.current = true; }} onBlur={saveQuiet}
              className="bg-[#0a0f1a] border border-[#1e2d45] rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-indigo-500" />
          </label>
          <label className="flex items-center gap-1.5 text-slate-500">
            Prazo
            <input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); dirtyRef.current = true; }} onBlur={saveQuiet}
              className={`bg-[#0a0f1a] border rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-indigo-500 ${prazo.late ? "border-red-500/50" : "border-[#1e2d45]"}`} />
          </label>
          {prazo.msg && (
            <span className={`font-semibold ${prazo.late ? "text-red-300" : prazo.soon ? "text-amber-300" : "text-emerald-300"}`}>
              {prazo.msg}
            </span>
          )}
        </div>
      </div>

      {/* Barra de estados — compacta, uma linha só */}
      <div className="flex items-center gap-2 flex-wrap pb-3 mb-3 border-b border-[#1e2d45] shrink-0">
        <button type="button" onClick={toggleVisible} className={pill(visible, "emerald")} title="Aparece no painel do cliente">
          {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {visible ? "Cliente vê" : "Só interna"}
        </button>
        {hasClickup && (
          task.clickupTaskId ? (
            <a
              href={`https://app.clickup.com/t/${task.clickupTaskId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#7b68ee]/40 bg-[#7b68ee]/10 text-[11px] font-semibold text-[#b9aefb] hover:bg-[#7b68ee]/20"
              title="Sincroniza nos dois sentidos"
            >
              <RefreshCw className="w-3 h-3" /> ClickUp <ExternalLink className="w-2.5 h-2.5" />
            </a>
          ) : (
            <button
              type="button"
              onClick={pushToClickup}
              disabled={pushing}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#7b68ee]/40 bg-[#7b68ee]/10 hover:bg-[#7b68ee]/20 text-[11px] font-semibold text-[#b9aefb] disabled:opacity-50"
              title="Cria no ClickUp e passa a sincronizar"
            >
              <RefreshCw className="w-3 h-3" /> {pushing ? "Enviando…" : "Sincronizar ClickUp"}
            </button>
          )
        )}
      </div>

      {/* Duas colunas: esquerda = a tarefa · direita = o que aconteceu */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">

        {/* ─── ESQUERDA: descrição em destaque + dados ─── */}
        <div className="min-h-0 overflow-y-auto pr-1 space-y-4">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1">
              Descrição <span className="text-slate-600 normal-case">(o cliente vê · cole prints aqui)</span>
            </label>
            <DescricaoEditor
              value={description}
              onChange={(v: string) => { setDescription(v); dirtyRef.current = true; }}
              onBlur={saveQuiet}
              onUpload={uploadDescImage}
              mediaUrl={descMediaUrl}
              rows={10}
              placeholder="O que será feito nesta tarefa… (cole um print pra ilustrar)"
              className={`${inCls} resize-y`}
            />
          </div>

          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1">Checklist / sub-passos</label>
            <ChecklistEditor projectId={projectId} taskId={task.id} initial={task.checklist} />
          </div>

          <div className="pt-3 border-t border-[#1e2d45] space-y-3">
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1">Responsável</label>
              <select
                value={assigneeId}
                onChange={(e) => { setAssigneeId(e.target.value); dirtyRef.current = true; }}
                onBlur={saveQuiet}
                className={inCls}
              >
                <option value="">— sem responsável —</option>
                {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <p className="text-[10px] text-slate-600 mt-1">
                Quem vai executar. A tarefa passa a aparecer no “Minhas tarefas” dessa pessoa.
              </p>
            </div>
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1">{serviceSteps.length > 0 ? "Serviço / etapa" : "Etapa"}</label>
              {serviceSteps.length > 0 ? (
                <select value={svcId} onChange={(e) => { setSvcId(e.target.value); dirtyRef.current = true; }} onBlur={saveQuiet} className={inCls}>
                  <option value="">— sem serviço —</option>
                  {serviceSteps.map((s, i) => <option key={s.id} value={s.id}>{String(i + 1).padStart(2, "0")} · {s.name}</option>)}
                </select>
              ) : (
                <>
                  <input list="etapas-list" value={stage} onChange={(e) => { setStage(e.target.value); dirtyRef.current = true; }} onBlur={saveQuiet} placeholder="Ex.: Diagnóstico" className={inCls} />
                  <datalist id="etapas-list">{stageSuggestions.map((s) => <option key={s} value={s} />)}</datalist>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ─── DIREITA: atividade — log, anexos, links e comentários ─── */}
        <div className="min-h-0 flex flex-col lg:border-l lg:border-[#1e2d45] lg:pl-5">
          <div className="flex items-center gap-2 mb-2 shrink-0">
            <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Atividade</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            {/* Log da tarefa */}
            <div className="text-[11px] text-slate-500 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 space-y-0.5">
              <div>Aberta em <span className="text-slate-300 tabular-nums">{fmt(task.createdAt)}</span></div>
              <div>Última atualização <span className="text-slate-300 tabular-nums">{fmt(task.updatedAt)}</span></div>
            </div>

            {/* Arquivos (MinIO) — aparecem aqui assim que você anexa */}
            <AttachmentsPanel target={{ projectTaskId: task.id }} title="Arquivos" />

            {/* Links externos (YouTube, docs, etc.) */}
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide flex items-center gap-1 mb-1">
                <Link2 className="w-3 h-3" /> Links
              </label>
              {task.materials.length > 0 && (
                <div className="space-y-1 mb-1.5">
                  {task.materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-xs bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 group/mat">
                      <Link2 className="w-3 h-3 text-slate-500 shrink-0" />
                      {m.url ? (
                        <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:underline truncate flex-1" title={m.url}>{m.title}</a>
                      ) : (
                        <span className="text-slate-300 truncate flex-1">{m.title}</span>
                      )}
                      <button type="button" onClick={() => removeMaterial(m.id)} className="text-slate-600 hover:text-red-400 shrink-0 opacity-0 group-hover/mat:opacity-100" title="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!linkOpen ? (
                <button
                  type="button"
                  onClick={() => setLinkOpen(true)}
                  className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-indigo-300 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Adicionar link
                </button>
              ) : (
                <div className="space-y-1.5 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-2">
                  <input autoFocus value={matTitle} onChange={(e) => setMatTitle(e.target.value)} placeholder="Título (ex.: Vídeo da reunião)" className={inCls} />
                  <input value={matUrl} onChange={(e) => setMatUrl(e.target.value)} placeholder="https://…" className={inCls} />
                  <div className="flex gap-1.5">
                    <button type="button" onClick={async () => { await addMaterial(); setLinkOpen(false); }} className="flex-1 px-2 py-1 rounded-md bg-indigo-600/80 hover:bg-indigo-500 text-white text-[11px] font-medium">Adicionar</button>
                    <button type="button" onClick={() => { setLinkOpen(false); setMatMsg(""); }} className="px-2 py-1 text-slate-500 hover:text-white text-[11px]">Cancelar</button>
                  </div>
                  {matMsg && <p className="text-[10px] text-slate-500">{matMsg}</p>}
                </div>
              )}
            </div>

            {/* Comentários / andamento */}
            <div className="pt-2 border-t border-[#1e2d45]">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                Andamento <span className="text-slate-600 normal-case">(o cliente vê, exceto 🔒)</span>
              </label>
              {comments.length === 0 ? (
                <p className="text-[11px] text-slate-600 mb-2">Nenhuma atualização ainda.</p>
              ) : (
                <div className="flex flex-col gap-2 mb-2">
                  {comments.map((c, i) => {
                    const fromClient = (c as any).by === "client";
                    const internal = (c as any).vis === false;
                    return (
                      <div key={i} className={`group/cm rounded-lg border px-3 py-2 ${fromClient ? "border-amber-500/30 bg-amber-500/5" : internal ? "border-slate-700 bg-[#0b0f18]" : "border-[#1e2d45] bg-[#0f1729]"}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={`text-[11px] font-bold ${fromClient ? "text-amber-300" : internal ? "text-slate-400" : "text-indigo-300"}`}>{fromClient ? "Cliente" : "Equipe"}{internal && !fromClient ? " · 🔒 interno" : ""}</span>
                          <div className="flex items-center gap-2">
                            {!fromClient && (
                              <button onClick={() => persistComments(comments.map((x, idx) => (idx === i ? { ...x, vis: internal ? true : false } : x)))} className="text-[10px] font-semibold text-slate-500 hover:text-emerald-300 opacity-0 group-hover/cm:opacity-100" title={internal ? "Mostrar pro cliente" : "Deixar só interno"}>{internal ? "mostrar" : "ocultar"}</button>
                            )}
                            <span className="text-[10px] text-slate-500 tabular-nums">{new Date(c.at).toLocaleDateString("pt-BR")}</span>
                            <button onClick={() => persistComments(comments.filter((_, idx) => idx !== i))} className="text-slate-600 hover:text-red-400 opacity-0 group-hover/cm:opacity-100" title="Remover">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div className="text-[13px] text-slate-200 leading-relaxed whitespace-pre-wrap">{c.text}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Composer fixo no rodapé da coluna */}
          <div className="shrink-0 pt-2 mt-2 border-t border-[#1e2d45]">
            <div className="flex gap-1.5">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addComment(); } }}
                placeholder={commentInternal ? "Nota interna (o cliente não vê)…" : "O que avançou? Ex.: Artes enviadas pra aprovação…"}
                className={inCls + " flex-1"}
              />
              <button type="button" onClick={addComment} className="px-2 rounded-md bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs flex items-center" title="Publicar andamento">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
                <input type="checkbox" checked={commentInternal} onChange={(e) => setCommentInternal(e.target.checked)} className="accent-slate-500 w-3.5 h-3.5" />
                🔒 Só interno
              </label>
              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium">{saving ? "Salvando…" : "Salvar e fechar"}</button>
                <button onClick={onClose} className="px-3 py-1.5 rounded-md text-slate-400 hover:text-white text-xs">Fechar</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Card de tarefas do projeto: lista as tarefas internas do LeadHub e permite
 * criar uma nova — interna (LeadHub) ou direto no ClickUp (lista do projeto).
 */
function ProjectTasksCard({
  projectId, availableUsers, internalTasks, hasClickup, serviceSteps,
}: {
  projectId: string;
  availableUsers: { id: string; name: string }[];
  internalTasks: InternalTask[];
  hasClickup: boolean;
  serviceSteps: { id: string; name: string; order: number; taskCount: number; doneCount: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    destino: hasClickup ? "clickup" : "interna",
    title: "", description: "", stage: "", projectServiceId: "", priority: "MEDIUM", startDate: "", dueDate: "", assigneeId: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  // Seleção em massa — mudar serviço/etapa de várias tarefas de uma vez.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSvc, setBulkSvc] = useState("");
  const [bulkStage, setBulkStage] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [taskFilter, setTaskFilter] = useState<"inbox" | "all" | "doing" | "done">("all");
  const [showDone, setShowDone] = useState(false);            // concluídas escondidas por padrão
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // etapas fechadas

  // "A organizar": vieram do ClickUp e ainda não caíram numa etapa. Viram a
  // primeira aba — antes eram um card separado que repetia as mesmas tarefas.
  const toInboxRow = (t: InternalTask) => ({
    id: t.id, title: t.title, done: t.done,
    visibleToClient: t.visibleToClient, clickupTaskId: t.clickupTaskId,
  });
  const inboxTasks   = internalTasks.filter((t) => t.clickupTaskId && !t.projectServiceId && !t.ignored).map(toInboxRow);
  const ignoredTasks = internalTasks.filter((t) => t.ignored).map(toInboxRow);
  const [taskQuery, setTaskQuery] = useState("");

  function toggleSelect(taskId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setBulkSvc("");
    setBulkStage("");
  }
  async function applyBulk() {
    if (selected.size === 0) return;
    const usesServices = serviceSteps.length > 0;
    if (usesServices ? bulkSvc === "" : bulkStage.trim() === "") return;
    setBulkSaving(true);
    const res = await fetch(`/api/projetos/${projectId}/tasks/bulk`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        taskIds: Array.from(selected),
        ...(usesServices ? { projectServiceId: bulkSvc || null } : { stage: bulkStage.trim() || null }),
      }),
    });
    setBulkSaving(false);
    if (res.ok) { exitSelectMode(); router.refresh(); }
  }

  // Fecha o modal e atualiza a lista. Como os campos salvam sozinhos no blur,
  // fechar pelo X/Esc/fundo também precisa refletir as mudanças na lista.
  function closeTaskModal() {
    setEditingId(null);
    router.refresh();
  }

  useEffect(() => {
    if (!editingId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeTaskModal(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId]);

  // Etapas já usadas neste projeto — vira sugestão (datalist) pra reaproveitar rótulos.
  const knownStages = Array.from(
    new Set(internalTasks.map((t) => t.stage).filter((s): s is string => !!s && !!s.trim())),
  );

  async function create() {
    if (!form.title.trim()) { setError("Título é obrigatório."); return; }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/projetos/${projectId}/tasks`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destino:     form.destino,
        title:       form.title.trim(),
        description: form.description.trim() || null,
        stage:       form.destino === "interna" ? (form.stage.trim() || null) : null,
        projectServiceId: form.destino === "interna" ? (form.projectServiceId || null) : null,
        priority:    form.priority,
        startDate:   form.startDate ? new Date(form.startDate).toISOString() : null,
        dueDate:     form.dueDate ? new Date(form.dueDate).toISOString() : null,
        assigneeId:  form.destino === "interna" ? (form.assigneeId || null) : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Falha ao criar tarefa");
      return;
    }
    setForm({ destino: hasClickup ? "clickup" : "interna", title: "", description: "", stage: "", projectServiceId: "", priority: "MEDIUM", startDate: "", dueDate: "", assigneeId: "" });
    setOpen(false);
    router.refresh();
  }

  async function toggleDone(t: InternalTask) {
    await fetch(`/api/projetos/${projectId}/tasks/${t.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ done: !t.done }),
    });
    router.refresh();
  }

  async function setStatus(t: InternalTask, status: string) {
    await fetch(`/api/projetos/${projectId}/tasks/${t.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    }).catch(() => {});
    router.refresh();
  }

  async function saveStage(t: InternalTask, stage: string) {
    await fetch(`/api/projetos/${projectId}/tasks/${t.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ stage: stage.trim() || null }),
    });
    router.refresh();
  }

  async function remove(t: InternalTask) {
    if (!confirm(`Excluir a tarefa "${t.title}"?`)) return;
    await fetch(`/api/projetos/${projectId}/tasks/${t.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
      <datalist id="etapas-list">
        {knownStages.map((s) => <option key={s} value={s} />)}
      </datalist>
      <div className="px-5 py-4 border-b border-[#1e2d45] flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-sm">✅ Tarefas do projeto</h3>
          <p className="text-slate-500 text-xs mt-0.5">Tarefas internas (LeadHub) e tarefas criadas no ClickUp.</p>
        </div>
        <div className="flex items-center gap-2">
          {internalTasks.length > 0 && (
            <button
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium border ${selectMode ? "border-indigo-500 text-indigo-300 bg-indigo-500/10" : "border-[#1e2d45] text-slate-400 hover:text-white"}`}
            >
              {selectMode ? "Cancelar seleção" : "☑ Selecionar"}
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
          >
            {open ? "Fechar" : "+ Nova tarefa"}
          </button>
        </div>
      </div>

      {/* Barra de ação em massa */}
      {selectMode && (
        <div className="px-5 py-3 border-b border-[#1e2d45] bg-[#080b12] flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">{selected.size} selecionada{selected.size === 1 ? "" : "s"}</span>
          <span className="text-slate-600 text-xs">→ mudar {serviceSteps.length > 0 ? "serviço/etapa" : "etapa"}:</span>
          {serviceSteps.length > 0 ? (
            <select
              value={bulkSvc}
              onChange={(e) => setBulkSvc(e.target.value)}
              className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">— escolher —</option>
              <option value="__none__" disabled>──────</option>
              {serviceSteps.map((s, i) => <option key={s.id} value={s.id}>{String(i + 1).padStart(2, "0")} · {s.name}</option>)}
            </select>
          ) : (
            <input
              list="etapas-list"
              value={bulkStage}
              onChange={(e) => setBulkStage(e.target.value)}
              placeholder="Etapa (ex.: Diagnóstico)"
              className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          )}
          <button
            onClick={applyBulk}
            disabled={bulkSaving || selected.size === 0 || (serviceSteps.length > 0 ? bulkSvc === "" : bulkStage.trim() === "")}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-40"
          >
            {bulkSaving ? "Aplicando..." : `Aplicar a ${selected.size}`}
          </button>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:text-white">Limpar</button>
          )}
        </div>
      )}

      {open && (
        <div className="p-5 border-b border-[#1e2d45] bg-[#080b12] space-y-3">
          {/* Destino */}
          <div className="grid grid-cols-2 gap-2 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-1">
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, destino: "clickup" }))}
              disabled={!hasClickup}
              className={`py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-30 ${
                form.destino === "clickup" ? "bg-[#7B68EE]/20 text-[#b9aefb] border border-[#7B68EE]/40" : "text-slate-500 hover:text-white"
              }`}
            >
              ClickUp (lista do projeto)
            </button>
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, destino: "interna" }))}
              className={`py-1.5 rounded-md text-xs font-semibold transition-colors ${
                form.destino === "interna" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "text-slate-500 hover:text-white"
              }`}
            >
              Interna (LeadHub)
            </button>
          </div>

          <input
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Título da tarefa *"
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            rows={2}
            placeholder={form.destino === "interna" ? "O que será feito nesta tarefa (o cliente vê)" : "Descrição (opcional)"}
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
          />
          {form.destino === "interna" && (
            serviceSteps.length > 0 ? (
              <select
                value={form.projectServiceId}
                onChange={(e) => setForm((p) => ({ ...p, projectServiceId: e.target.value }))}
                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">— serviço/etapa (agrupa pro cliente) —</option>
                {serviceSteps.map((s, i) => <option key={s.id} value={s.id}>{String(i + 1).padStart(2, "0")} · {s.name}</option>)}
              </select>
            ) : (
              <div>
                <input
                  list="etapas-list"
                  value={form.stage}
                  onChange={(e) => setForm((p) => ({ ...p, stage: e.target.value }))}
                  placeholder="Etapa (ex.: Diagnóstico) — agrupa as tarefas pro cliente"
                  className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )
          )}
          <select
            value={form.priority}
            onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="LOW">🟢 Baixa</option>
            <option value="MEDIUM">🟡 Média</option>
            <option value="HIGH">🟠 Alta</option>
            <option value="URGENT">🔴 Urgente</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-slate-500 text-[10px] uppercase tracking-wide block mb-1">Início</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-500 text-[10px] uppercase tracking-wide block mb-1">Fim / prazo</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          {form.destino === "interna" && (
            <select
              value={form.assigneeId}
              onChange={(e) => setForm((p) => ({ ...p, assigneeId: e.target.value }))}
              className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">— sem responsável —</option>
              {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}

          {error && <p className="text-red-300 text-xs">{error}</p>}

          <div className="flex justify-end gap-2">
            <button onClick={() => { setOpen(false); setError(null); }} className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs">
              Cancelar
            </button>
            <button
              onClick={create}
              disabled={saving || !form.title.trim()}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Criando..." : "Criar tarefa"}
            </button>
          </div>
        </div>
      )}

      {internalTasks.length > 0 && (
        <div className="px-5 py-3 border-b border-[#1e2d45] flex items-center gap-2 flex-wrap">
          <div className="inline-flex bg-[#080b12] border border-[#1e2d45] rounded-lg p-0.5">
            {inboxTasks.length > 0 && (
              <button
                onClick={() => setTaskFilter("inbox")}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                  taskFilter === "inbox" ? "bg-amber-500/20 text-amber-200" : "text-amber-400/70 hover:text-amber-200"
                }`}
                title="Vieram do ClickUp e ainda não estão numa etapa"
              >
                A organizar
                <span className="bg-amber-500/25 text-amber-100 rounded-full px-1.5 tabular-nums">{inboxTasks.length}</span>
              </button>
            )}
            {(["all", "doing", "done"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTaskFilter(f)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${taskFilter === f ? "bg-[#1e2d45] text-white" : "text-slate-500 hover:text-white"}`}
              >
                {f === "all" ? "Tudo" : f === "doing" ? "Em andamento" : "Concluído"}
              </button>
            ))}
          </div>
          <input
            value={taskQuery}
            onChange={(e) => setTaskQuery(e.target.value)}
            placeholder="Buscar tarefa…"
            className="flex-1 min-w-[140px] bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
          {/* Concluídas ficam fora da vista por padrão — elas só enchem a tela. */}
          {taskFilter === "all" && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer select-none" title="Mostrar as tarefas já aprovadas">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="w-3.5 h-3.5 rounded accent-emerald-500" />
              Concluídas ({internalTasks.filter((t) => t.done && !t.ignored).length})
            </label>
          )}
          {serviceSteps.length > 0 && (
            <button
              onClick={() => setCollapsed(collapsed.size > 0 ? new Set() : new Set(serviceSteps.map((s) => s.id)))}
              className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
              title={collapsed.size > 0 ? "Abrir todas as etapas" : "Fechar todas as etapas"}
            >
              {collapsed.size > 0 ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              {collapsed.size > 0 ? "Abrir todas" : "Fechar todas"}
            </button>
          )}
        </div>
      )}

      {taskFilter === "inbox" ? (
        <ProjectInbox
          embedded
          projectId={projectId}
          tasks={inboxTasks}
          ignoredTasks={ignoredTasks}
          serviceSteps={serviceSteps}
          clickupUrlBase={null}
        />
      ) : (() => {
        const rowOf = (t: InternalTask) => {
          const start = t.startDate ? new Date(t.startDate) : null;
          const due = t.dueDate ? new Date(t.dueDate) : null;
          const overdue = due && due < new Date() && !t.done;
          const prio = PRIORITY_PILL[t.priority] ?? PRIORITY_PILL.MEDIUM;
          return (
            <div key={t.id} className={`flex items-start gap-3 px-5 py-2.5 group ${selectMode && selected.has(t.id) ? "bg-indigo-500/10" : "hover:bg-[#080b12]"}`}>
              {selectMode ? (
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggleSelect(t.id)}
                  className="w-4 h-4 mt-0.5 rounded cursor-pointer flex-shrink-0 accent-indigo-500"
                  title="Selecionar"
                />
              ) : (
                <button
                  onClick={() => toggleDone(t)}
                  title={t.done ? "Reabrir" : "Concluir"}
                  aria-label={t.done ? "Reabrir tarefa" : "Concluir tarefa"}
                  className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
                    t.done
                      ? "bg-emerald-500 border-emerald-500 text-[#0a0f1a]"
                      : "border-slate-600 hover:border-emerald-400 text-transparent hover:text-emerald-400"
                  }`}
                >
                  <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
                </button>
              )}

              <button onClick={() => (selectMode ? toggleSelect(t.id) : setEditingId(t.id))} className="min-w-0 flex-1 text-left cursor-pointer">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[13px] leading-snug ${t.done ? "text-slate-500 line-through" : "text-slate-100"}`}>
                    {t.title}
                  </span>
                  {!t.visibleToClient && <Lock className="w-3 h-3 text-slate-600 flex-none" strokeWidth={2.5} aria-label="Interna — não aparece pro cliente" />}
                  {t.clickupTaskId && <RefreshCw className="w-3 h-3 text-[#7B68EE] flex-none" strokeWidth={2.5} aria-label="Vinculada ao ClickUp" />}
                </div>
                <div className="text-[10px] mt-1 flex items-center gap-1.5 flex-wrap text-slate-600">
                  <span className={prio.cls}>{prio.label}</span>
                  <span>·</span>
                  {!t.projectServiceId && t.stage && <><span>·</span><span className="text-indigo-300">{t.stage}</span></>}
                  {t.assigneeName && <><span>·</span><span>{t.assigneeName}</span></>}
                  {t.checklist.length > 0 && <><span>·</span><span>{t.checklist.filter((c) => c.done).length}/{t.checklist.length} ✓</span></>}
                  {t.comments.length > 0 && <><span>·</span><span>💬 {t.comments.length}</span></>}
                </div>
              </button>

              <div className="flex items-center gap-2 flex-none pt-0.5">
                {/* Status — troca sem abrir a tarefa */}
                <select
                  value={t.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); setStatus(t, e.target.value); }}
                  title="Status da tarefa"
                  className={`text-[10px] font-semibold rounded-full border px-1.5 py-0.5 cursor-pointer focus:outline-none appearance-none text-center ${statusOf(t.status).badge}`}
                >
                  {TASK_STATUS.map((s) => <option key={s.id} value={s.id} className="bg-[#0f1729] text-slate-200">{s.label}</option>)}
                </select>
                {(start || due) && (
                  <span className={`text-[10px] tabular-nums text-right ${overdue ? "text-red-300 font-medium" : "text-slate-500"}`}>
                    {due ? formatBrazilDate(due) : formatBrazilDate(start!)}
                  </span>
                )}
                <button
                  onClick={() => remove(t)}
                  className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Excluir"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        };

        if (internalTasks.length === 0) {
          return <div className="p-5 text-slate-600 text-xs">Nenhuma tarefa interna ainda.</div>;
        }
        // Filtro (Tudo/Em andamento/Concluído) + busca.
        const q = taskQuery.trim().toLowerCase();
        const filtering = taskFilter !== "all" || q.length > 0;
        const list = internalTasks.filter((t) => {
          if (t.ignored) return false; // ignoradas vivem só na aba "A organizar"
          // Sem etapa + vinda do ClickUp = pertence à aba "A organizar", não a esta lista.
          if (t.clickupTaskId && !t.projectServiceId) return false;
          if (taskFilter === "doing" && t.done) return false;
          if (taskFilter === "done" && !t.done) return false;
          // Em "Tudo", esconde as concluídas até você pedir pra ver.
          if (taskFilter === "all" && t.done && !showDone) return false;
          if (q && !t.title.toLowerCase().includes(q)) return false;
          return true;
        });
        if (list.length === 0) {
          return <div className="p-5 text-slate-600 text-xs">Nenhuma tarefa neste filtro.</div>;
        }
        // Sem etapas cadastradas → lista plana (comportamento antigo).
        if (serviceSteps.length === 0) {
          return (
            <div>
              <div className="divide-y divide-[#1e2d45]">{list.map(rowOf)}</div>
              {!filtering && (
                <QuickAddTask projectId={projectId} projectServiceId={null} onAdded={() => router.refresh()} />
              )}
            </div>
          );
        }
        // Com serviços → agrupa as tarefas por serviço (igual o cliente vê).
        const svcIds = new Set(serviceSteps.map((s) => s.id));
        const groups = serviceSteps.map((s, i) => ({
          id: s.id,
          label: `${String(i + 1).padStart(2, "0")} · ${s.name}`,
          tasks: list.filter((t) => t.projectServiceId === s.id),
        }));
        const noSvc = list.filter((t) => !t.projectServiceId || !svcIds.has(t.projectServiceId));

        const GroupHead = ({ label, tasks, muted, stepId, index, total, done, isOpen, onToggle }: {
          label: string; tasks: InternalTask[]; muted?: boolean; stepId?: string; index?: number;
          total?: number; done?: number; isOpen?: boolean; onToggle?: () => void;
        }) => {
          // Contagem real da etapa (não a filtrada) — uma etapa 100% concluída
          // precisa mostrar 10/10 mesmo com as concluídas escondidas.
          const feitas = done ?? tasks.filter((t) => t.done).length;
          const base = total ?? tasks.length;
          const pct = base > 0 ? Math.round((feitas / base) * 100) : 0;
          const tone = muted ? null : STAGE_TONES[(index ?? 0) % STAGE_TONES.length];
          return (
            <div
              className={`px-5 pt-3 pb-2.5 border-t border-b border-l-[3px] ${
                tone ? `${tone.bg} ${tone.border}` : "bg-[#0b111c] border-[#1e2d45] border-l-slate-700"
              } ${tone ? "border-t-[#1e2d45] border-b-[#1e2d45]" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                {stepId ? (
                  <StageRename projectId={projectId} stepId={stepId} label={label} tone={tone?.text ?? "text-white"} onDone={() => router.refresh()} />
                ) : (
                  <span className={`text-[13px] font-semibold tracking-tight ${muted ? "text-slate-400" : "text-white"}`}>{label}</span>
                )}
                <div className="flex items-center gap-2 flex-none">
                  <span className="text-[11px] text-slate-500 font-medium tabular-nums">{feitas}/{base}</span>
                  {onToggle && (
                    <button
                      onClick={onToggle}
                      className="text-slate-500 hover:text-white transition-colors"
                      title={isOpen ? "Fechar etapa" : "Abrir etapa"}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
              {base > 0 && (
                <div className="mt-1.5 h-[3px] rounded-full bg-black/40 overflow-hidden">
                  <div className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : tone ? tone.bar : "bg-slate-600"}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        };

        return (
          <div>
            {groups.filter((g) => !filtering || g.tasks.length > 0).map((g, gi) => {
              const aberta = !collapsed.has(g.id);
              const toggle = () => setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                return next;
              });
              const step = serviceSteps.find((s) => s.id === g.id);
              const totalReal = step?.taskCount ?? g.tasks.length;
              const doneReal  = step?.doneCount ?? g.tasks.filter((t) => t.done).length;
              // Etapa sem nada na tela: distingue "não tem tarefa" de "tem, mas
              // estão escondidas" — senão parece que falta executar o que já foi feito.
              const escondidas = totalReal - g.tasks.length;
              return (
                <div key={g.id}>
                  <GroupHead
                    label={g.label} tasks={g.tasks} stepId={g.id} index={gi}
                    total={totalReal} done={doneReal}
                    isOpen={aberta} onToggle={toggle}
                  />
                  {aberta && (
                    <>
                      {g.tasks.length === 0
                        ? (
                          <div className="px-5 py-2.5 text-[11px] italic">
                            {totalReal === 0
                              ? <span className="text-slate-600">nenhuma tarefa nesta etapa</span>
                              : doneReal === totalReal
                                ? <span className="text-emerald-400/80">tudo concluído nesta etapa ✓</span>
                                : <span className="text-slate-500">{escondidas} tarefa{escondidas > 1 ? "s" : ""} oculta{escondidas > 1 ? "s" : ""} pelo filtro</span>}
                          </div>
                        )
                        : <div className="divide-y divide-[#1e2d45]">{g.tasks.map(rowOf)}</div>}
                      {/* Entrada rápida — some quando há filtro/busca ativa, pra não
                          criar tarefa que sumiria da vista logo em seguida. */}
                      {!filtering && (
                        <QuickAddTask projectId={projectId} projectServiceId={g.id} onAdded={() => router.refresh()} />
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {noSvc.length > 0 && (
              <div>
                <GroupHead label="Sem etapa — a organizar" tasks={noSvc} muted />
                <div className="divide-y divide-[#1e2d45]">{noSvc.map(rowOf)}</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Modal de edição da tarefa (85% da tela) */}
      {editingId && (() => {
        const t = internalTasks.find((x) => x.id === editingId);
        if (!t) return null;

        // Irmãs da MESMA etapa, na ordem da lista — permite passar de tarefa em
        // tarefa sem fechar o modal. Ignoradas ficam de fora.
        const irmas = internalTasks.filter((x) => !x.ignored && x.projectServiceId === t.projectServiceId);
        const idx = irmas.findIndex((x) => x.id === t.id);
        const anterior = idx > 0 ? irmas[idx - 1] : null;
        const proxima  = idx >= 0 && idx < irmas.length - 1 ? irmas[idx + 1] : null;
        const etapaNome = serviceSteps.find((s) => s.id === t.projectServiceId)?.name ?? t.stage ?? "Sem etapa";

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={closeTaskModal}>
            <div className="w-[85vw] h-[85vh] max-w-5xl bg-[#0b111c] border border-[#1e2d45] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* O título mora só dentro do editor (é editável lá) — aqui fica
                  a navegação entre tarefas da etapa, o carimbo e o fechar. */}
              <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[#1e2d45] flex-shrink-0">
                {irmas.length > 1 && (
                  <div className="flex items-center gap-1 flex-none">
                    <button
                      onClick={() => anterior && setEditingId(anterior.id)}
                      disabled={!anterior}
                      title={anterior ? `Anterior: ${anterior.title}` : "Já é a primeira"}
                      className="p-1 rounded text-slate-500 hover:text-white hover:bg-[#161f30] disabled:opacity-25 disabled:cursor-not-allowed"
                      aria-label="Tarefa anterior"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] text-slate-500 tabular-nums select-none">{idx + 1}/{irmas.length}</span>
                    <button
                      onClick={() => proxima && setEditingId(proxima.id)}
                      disabled={!proxima}
                      title={proxima ? `Próxima: ${proxima.title}` : "Já é a última"}
                      className="p-1 rounded text-slate-500 hover:text-white hover:bg-[#161f30] disabled:opacity-25 disabled:cursor-not-allowed"
                      aria-label="Próxima tarefa"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Pular direto pra qualquer tarefa da etapa */}
                {irmas.length > 1 ? (
                  <select
                    value={t.id}
                    onChange={(e) => setEditingId(e.target.value)}
                    title={`Tarefas em ${etapaNome}`}
                    className="min-w-0 flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    {irmas.map((x, i) => (
                      <option key={x.id} value={x.id}>
                        {String(i + 1).padStart(2, "0")} · {x.done ? "✓ " : ""}{x.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="flex-1" />
                )}

                <p className="text-slate-500 text-[11px] flex-none hidden sm:block">
                  Atualizada {new Date(t.updatedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </p>
                <button onClick={closeTaskModal} className="text-slate-500 hover:text-white flex-shrink-0" aria-label="Fechar"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex-1 min-h-0 px-6 py-5">
                {/* key = id: troca de tarefa REMONTA o editor. Sem isso os campos
                    (inicializados por useState) manteriam os valores da anterior. */}
                <TaskEditor key={t.id} projectId={projectId} task={t} onClose={() => setEditingId(null)} stageSuggestions={knownStages} serviceSteps={serviceSteps} hasClickup={hasClickup} availableUsers={availableUsers} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Nome da etapa editável direto no cabeçalho do grupo. Clica, edita, e salva
 * sozinho ao sair do campo (blur) ou no Enter — sem botão de gravar. Esc
 * descarta. Antes só dava pra renomear pelo ⚙ Configurar projeto.
 */
function StageRename({
  projectId, stepId, label, tone, onDone,
}: {
  projectId: string;
  stepId: string;
  label: string;   // "01 · Nome da etapa"
  tone: string;
  onDone: () => void;
}) {
  // O rótulo vem prefixado com a ordem ("01 · X"); só o nome é editável.
  const sep = label.indexOf("·");
  const prefix = sep >= 0 ? label.slice(0, sep + 1) : "";
  const nameOnly = sep >= 0 ? label.slice(sep + 1).trim() : label;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nameOnly);
  const [saving, setSaving] = useState(false);

  async function save() {
    const v = value.trim();
    setEditing(false);
    if (!v || v === nameOnly) { setValue(nameOnly); return; }
    setSaving(true);
    const res = await fetch(`/api/projetos/${projectId}/servicos/${stepId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name: v }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) onDone();
    else setValue(nameOnly); // falhou: volta o nome antigo
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setValue(nameOnly); setEditing(true); }}
        title="Clique pra renomear a etapa"
        className="min-w-0 flex items-center gap-1.5 text-left group/stage"
      >
        <span className={`text-[13px] font-semibold tracking-tight truncate ${tone}`}>
          {prefix} {saving ? "salvando…" : nameOnly}
        </span>
        <Pencil className="w-3 h-3 text-slate-600 opacity-0 group-hover/stage:opacity-100 transition-opacity flex-none" />
      </button>
    );
  }

  return (
    <div className="min-w-0 flex items-center gap-1.5 flex-1">
      <span className={`text-[13px] font-semibold tracking-tight flex-none ${tone}`}>{prefix}</span>
      <input
        autoFocus
        value={value}
        // Seleciona tudo ao abrir — clica e já digita por cima, sem apagar na mão.
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { e.preventDefault(); setValue(nameOnly); setEditing(false); }
        }}
        className={`flex-1 min-w-0 bg-black/30 border border-white/15 rounded px-1.5 py-0.5 text-[13px] font-semibold tracking-tight ${tone} focus:outline-none focus:border-white/40`}
      />
    </div>
  );
}

/**
 * Entrada rápida de tarefa, no estilo ClickUp: uma linha discreta no fim de cada
 * etapa. Digita + Enter salva e o campo continua aberto pra próxima — é o que
 * torna prático cadastrar 5 tarefas seguidas sem abrir formulário.
 * Cria sempre como tarefa INTERNA (instantâneo). Pro ClickUp / campos completos
 * (prazo, responsável, prioridade) existe o botão "+ Nova tarefa".
 */
function QuickAddTask({
  projectId, projectServiceId, onAdded,
}: {
  projectId: string;
  projectServiceId: string | null;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  // Tarefas já gravadas nesta sessão de digitação. Ficam como linhas otimistas
  // até fechar — atualizar a página a cada Enter remontava o campo e engolia a
  // digitação seguinte.
  const [justAdded, setJustAdded] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function close() {
    setTitle("");
    setOpen(false);
    if (justAdded.length > 0) { setJustAdded([]); onAdded(); }
  }

  async function submit() {
    const v = title.trim();
    if (!v) { close(); return; }
    setSaving(true);
    setTitle("");
    const res = await fetch(`/api/projetos/${projectId}/tasks`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ destino: "interna", title: v, projectServiceId }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) setJustAdded((prev) => [...prev, v]);
    else setTitle(v); // falhou: devolve o texto pra não perder o que foi digitado
    inputRef.current?.focus();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-1.5 px-5 py-2 text-[11px] text-slate-600 hover:text-indigo-300 hover:bg-[#080b12] transition-colors text-left"
      >
        <Plus className="w-3 h-3" strokeWidth={2.5} /> Adicionar tarefa
      </button>
    );
  }

  return (
    <div>
      {justAdded.map((t, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-t border-[#1e2d45]">
          <span className="w-4 h-4 rounded-full border border-slate-600 flex-none" />
          <span className="text-[13px] text-slate-100 flex-1">{t}</span>
          <Check className="w-3.5 h-3.5 text-emerald-400 flex-none" strokeWidth={3} />
        </div>
      ))}
      <div className="flex items-center gap-3 px-5 py-2.5 bg-[#080b12] border-t border-[#1e2d45]">
        <span className="w-4 h-4 rounded-full border border-slate-700 flex-none" />
        <input
          ref={inputRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            if (e.key === "Escape") { e.preventDefault(); close(); }
          }}
          onBlur={() => { if (!title.trim() && !saving) close(); }}
          placeholder="Nome da tarefa — Enter salva e continua, Esc fecha"
          className="flex-1 bg-transparent border-0 text-[13px] text-slate-100 placeholder-slate-600 focus:outline-none"
        />
        {saving && <span className="text-[10px] text-slate-500 flex-none">salvando…</span>}
      </div>
    </div>
  );
}

/** Editor inline do List ID do ClickUp. Suporta adicionar, trocar e remover. */
function ClickupListIdEditor({ projectId, current }: { projectId: string; current: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);

  async function persist(newValue: string) {
    const trimmed = newValue.trim();
    if (trimmed === (current ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/projetos/${projectId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ clickupListId: trimmed }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  async function remove() {
    if (!confirm("Remover o vínculo ClickUp? O snapshot de tarefas é descartado — o projeto passa a ser só interno.")) return;
    await persist("");
  }

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-500 text-xs uppercase tracking-wider">ClickUp</span>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-slate-500 hover:text-white text-[10px]">
            {current ? "Editar" : "Vincular"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="901234567890"
            className="w-full bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
          />
          <p className="text-slate-600 text-[10px]">
            {current
              ? "Ao trocar, o histórico de tarefas é resetado pra refletir a nova lista."
              : "Cole o List ID pra sincronizar as tarefas do ClickUp neste projeto."}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => persist(value)}
              disabled={saving}
              className="flex-1 px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(current ?? ""); }}
              className="px-2 py-1.5 text-slate-500 hover:text-white text-xs"
            >
              Cancelar
            </button>
          </div>
          {current && (
            <button
              onClick={remove}
              disabled={saving}
              className="w-full px-2 py-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 text-[11px] font-medium disabled:opacity-50"
            >
              Remover vínculo (virar só interno)
            </button>
          )}
        </div>
      ) : current ? (
        <code className="text-slate-400 text-xs font-mono break-all">{current}</code>
      ) : (
        <p className="text-slate-500 text-xs italic">Sem ClickUp — projeto só interno.</p>
      )}
    </div>
  );
}

/** Seletor de cliente vinculado — permite editar OU criar novo cliente inline. */
function ClientSelector({
  projectId, current, companies,
}: {
  projectId: string;
  current: { id: string; name: string } | null;
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function setClient(companyId: string | null) {
    setSaving(true);
    await fetch(`/api/projetos/${projectId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ clientCompanyId: companyId }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  async function createAndLink() {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/companies", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const company = await res.json();
      await setClient(company.id);
      setNewName("");
      setCreating(false);
    } else {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-500 text-xs uppercase tracking-wider">Cliente</span>
        {!editing && !creating && (
          <button onClick={() => setEditing(true)} className="text-slate-500 hover:text-white text-[10px]">
            Editar
          </button>
        )}
      </div>

      {!editing && !creating && (
        <div className="text-sm text-white">
          {current ? <>🏢 {current.name}</> : <span className="text-slate-600">— sem cliente</span>}
        </div>
      )}

      {editing && (
        <div className="space-y-2">
          <select
            value={current?.id ?? ""}
            onChange={(e) => setClient(e.target.value || null)}
            disabled={saving}
            className="w-full bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">— sem cliente —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex gap-1">
            <button
              onClick={() => { setEditing(false); setCreating(true); }}
              className="flex-1 px-2 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-medium"
            >
              + Criar novo
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-2 py-1.5 text-slate-500 hover:text-white text-xs"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {creating && (
        <div className="space-y-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do cliente"
            autoFocus
            className="w-full bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <div className="flex gap-1">
            <button
              onClick={createAndLink}
              disabled={saving || !newName.trim()}
              className="flex-1 px-2 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Criando..." : "Criar e vincular"}
            </button>
            <button
              onClick={() => { setCreating(false); setNewName(""); }}
              className="px-2 py-1.5 text-slate-500 hover:text-white text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
