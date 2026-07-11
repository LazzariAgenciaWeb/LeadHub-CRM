"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Trash2, RefreshCw, ChevronLeft, ChevronRight, Pencil, Plus, Link2 } from "lucide-react";
import { ProjectStatus } from "@/generated/prisma";
import { formatBrazilDateTime, formatBrazilDate } from "@/lib/datetime";
import IncidentReporter from "./IncidentReporter";
import VisibilityControl from "@/components/VisibilityControl";
import ProjectServiceSelector from "./ProjectServiceSelector";

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

type ChecklistItem = { text: string; done: boolean };
type InternalTask = {
  id:           string;
  title:        string;
  description:  string | null;
  stage:        string | null; // etapa/fase (rótulo)
  checklist:    ChecklistItem[]; // sub-passos
  comments:     { text: string; at: string }[]; // atualizações datadas
  done:         boolean;
  priority:     string;
  startDate:    string | null; // ISO — início
  dueDate:      string | null; // ISO — fim/prazo
  assigneeName: string | null;
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

const TICKET_STATUS_LABEL: Record<string, string> = {
  OPEN: "Aberto", IN_PROGRESS: "Em andamento", RESOLVED: "Resolvido", CLOSED: "Fechado",
};

export default function ProjectDetail({
  project, availableUsers, companyUsers, accessUserIds, activities, clientCompanies, openTasks, internalTasks, chamados,
  catalogServices, currentServiceId,
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
  currentServiceId: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-5">
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

                {/* Lista de tarefas abertas — snapshot do último sync */}
                {openTasks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#1e2d45]">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-slate-400 text-[11px] uppercase tracking-wider">
                        Tarefas abertas ({openTasks.length})
                      </span>
                      <span className="text-slate-600 text-[10px]">snapshot do último sync</span>
                    </div>
                    <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
                      {openTasks.map((t) => {
                        const overdue = t.dueDate !== null && t.dueDate < Date.now();
                        return (
                          <a
                            key={t.id}
                            href={`https://app.clickup.com/t/${t.taskId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-[#080b12] group"
                            title={t.statusName ?? undefined}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                              overdue ? "bg-red-400" : t.dueDate === null ? "bg-amber-400" : "bg-slate-500"
                            }`} />
                            <span className="text-slate-200 text-xs flex-1 group-hover:text-white truncate">
                              {t.name}
                            </span>
                            {t.dueDate !== null ? (
                              <span className={`text-[10px] font-medium flex-shrink-0 ${
                                overdue ? "text-red-300" : "text-slate-500"
                              }`}>
                                {formatBrazilDate(new Date(t.dueDate))}
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-400 flex-shrink-0">sem prazo</span>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
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

          {/* Tarefas do projeto (LeadHub + ClickUp) */}
          <ProjectTasksCard
            projectId={project.id}
            availableUsers={availableUsers}
            internalTasks={internalTasks}
            hasClickup={!!project.clickupListId}
          />

          {/* Chamados agrupados no projeto */}
          {chamados.length > 0 && (
            <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#1e2d45]">
                <h3 className="text-white font-semibold text-sm">🎫 Chamados do projeto ({chamados.length})</h3>
              </div>
              <div className="divide-y divide-[#1e2d45]">
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
            </div>
          )}

          {/* Descrição */}
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
            <span className="text-slate-500 text-xs uppercase tracking-wider block mb-2">Descrição</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              onBlur={save}
              rows={4}
              placeholder="Escopo, observações, links..."
              className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {/* Histórico de tarefas (do ClickUp) */}
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#1e2d45]">
              <h3 className="text-white font-semibold text-sm">📋 Histórico de tarefas</h3>
              <p className="text-slate-500 text-xs mt-0.5">
                Movimentações detectadas no ClickUp via sync. Cada uma vira pontos de gamificação.
              </p>
            </div>
            {activities.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                Nenhuma movimentação ainda. Faça uma sync e edite tarefas no ClickUp.
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
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
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

          {/* Serviço do catálogo — vincula pra contar como contratado */}
          <ProjectServiceSelector
            projectId={project.id}
            currentServiceId={currentServiceId}
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
  const [open, setOpen] = useState(initial.length > 0);

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
    persist([...items, { text: t, done: false }]);
    setText("");
  }

  const doneCount = items.filter((i) => i.done).length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-[10px] text-slate-600 hover:text-indigo-300"
      >
        + checklist
      </button>
    );
  }

  return (
    <div className="mt-1.5 pl-0.5 space-y-1">
      {items.length > 0 && (
        <div className="text-[10px] text-slate-500">Checklist · {doneCount}/{items.length}</div>
      )}
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 group/ck">
          <input
            type="checkbox"
            checked={it.done}
            onChange={() => persist(items.map((x, idx) => (idx === i ? { ...x, done: !x.done } : x)))}
            className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer flex-shrink-0"
          />
          <span className={`text-[11px] flex-1 ${it.done ? "text-slate-600 line-through" : "text-slate-300"}`}>{it.text}</span>
          <button
            onClick={() => persist(items.filter((_, idx) => idx !== i))}
            className="text-slate-600 hover:text-red-400 opacity-0 group-hover/ck:opacity-100 flex-shrink-0"
            title="Remover passo"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="+ adicionar passo"
          className="flex-1 bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
        {text.trim() && (
          <button onClick={add} className="text-[11px] px-2 py-1 rounded bg-indigo-600/80 hover:bg-indigo-500 text-white">add</button>
        )}
      </div>
    </div>
  );
}

/**
 * Editor inline de uma tarefa: título, descrição, início/fim, e um atalho pra
 * adicionar link/anexo direto na tarefa (cria ProjectMaterial com taskId).
 */
function TaskEditor({ projectId, task, onClose }: { projectId: string; task: InternalTask; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [startDate, setStartDate] = useState(task.startDate ? task.startDate.slice(0, 10) : "");
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const [matTitle, setMatTitle] = useState("");
  const [matUrl, setMatUrl] = useState("");
  const [matMsg, setMatMsg] = useState("");
  const [comments, setComments] = useState(task.comments);
  const [newComment, setNewComment] = useState("");

  const inCls = "w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

  async function persistComments(next: { text: string; at: string }[]) {
    setComments(next);
    await fetch(`/api/projetos/${projectId}/tasks/${task.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ comments: next }),
    }).catch(() => {});
    router.refresh();
  }
  function addComment() {
    if (!newComment.trim()) return;
    persistComments([...comments, { text: newComment.trim(), at: new Date().toISOString() }]);
    setNewComment("");
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    await fetch(`/api/projetos/${projectId}/tasks/${task.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title:       title.trim(),
        description: description.trim() || null,
        startDate:   startDate ? new Date(startDate).toISOString() : null,
        dueDate:     dueDate ? new Date(dueDate).toISOString() : null,
      }),
    }).catch(() => {});
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

  return (
    <div className="mt-2 p-3 rounded-lg bg-[#0a0f1a] border border-indigo-500/30 space-y-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" className={inCls} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Descrição (o cliente vê)" className={`${inCls} resize-y`} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-slate-500 text-[9px] uppercase tracking-wide block mb-0.5">Início</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inCls} />
        </div>
        <div>
          <label className="text-slate-500 text-[9px] uppercase tracking-wide block mb-0.5">Fim / prazo</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inCls} />
        </div>
      </div>
      <div className="pt-1 border-t border-[#1e2d45]">
        <label className="text-slate-500 text-[9px] uppercase tracking-wide flex items-center gap-1 mb-1"><Link2 className="w-3 h-3" /> Adicionar link / anexo na tarefa</label>
        <div className="flex gap-1.5">
          <input value={matTitle} onChange={(e) => setMatTitle(e.target.value)} placeholder="Título" className={inCls + " flex-1"} />
          <input value={matUrl} onChange={(e) => setMatUrl(e.target.value)} placeholder="https://…" className={inCls + " flex-1"} />
          <button type="button" onClick={addMaterial} className="px-2 rounded-md bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs flex items-center"><Plus className="w-3.5 h-3.5" /></button>
        </div>
        {matMsg && <p className="text-[10px] text-slate-500 mt-1">{matMsg}</p>}
      </div>
      <div className="pt-1 border-t border-[#1e2d45]">
        <label className="text-slate-500 text-[9px] uppercase tracking-wide block mb-1">Atualizações / comentários (o cliente vê)</label>
        {comments.length > 0 && (
          <div className="space-y-1 mb-1.5">
            {comments.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] group/cm">
                <span className="text-slate-600 whitespace-nowrap mt-0.5">{new Date(c.at).toLocaleDateString("pt-BR")}</span>
                <span className="text-slate-300 flex-1">{c.text}</span>
                <button onClick={() => persistComments(comments.filter((_, idx) => idx !== i))} className="text-slate-600 hover:text-red-400 opacity-0 group-hover/cm:opacity-100" title="Remover">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addComment(); } }}
            placeholder="Ex.: Aguardando o Google liberar (uns 3 dias)…"
            className={inCls + " flex-1"}
          />
          <button type="button" onClick={addComment} className="px-2 rounded-md bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs flex items-center"><Plus className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="flex gap-2 pt-0.5">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium">{saving ? "Salvando…" : "Salvar"}</button>
        <button onClick={onClose} className="px-3 py-1.5 rounded-md text-slate-400 hover:text-white text-xs">Fechar</button>
      </div>
    </div>
  );
}

/**
 * Card de tarefas do projeto: lista as tarefas internas do LeadHub e permite
 * criar uma nova — interna (LeadHub) ou direto no ClickUp (lista do projeto).
 */
function ProjectTasksCard({
  projectId, availableUsers, internalTasks, hasClickup,
}: {
  projectId: string;
  availableUsers: { id: string; name: string }[];
  internalTasks: InternalTask[];
  hasClickup: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    destino: hasClickup ? "clickup" : "interna",
    title: "", description: "", stage: "", priority: "MEDIUM", startDate: "", dueDate: "", assigneeId: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);

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
    setForm({ destino: hasClickup ? "clickup" : "interna", title: "", description: "", stage: "", priority: "MEDIUM", startDate: "", dueDate: "", assigneeId: "" });
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
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
        >
          {open ? "Fechar" : "+ Nova tarefa"}
        </button>
      </div>

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
            <div>
              <input
                list="etapas-list"
                value={form.stage}
                onChange={(e) => setForm((p) => ({ ...p, stage: e.target.value }))}
                placeholder="Etapa (ex.: Diagnóstico) — agrupa as tarefas pro cliente"
                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
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

      {internalTasks.length === 0 ? (
        <div className="p-5 text-slate-600 text-xs">Nenhuma tarefa interna ainda.</div>
      ) : (
        <div className="divide-y divide-[#1e2d45]">
          {internalTasks.map((t) => {
            const start = t.startDate ? new Date(t.startDate) : null;
            const due = t.dueDate ? new Date(t.dueDate) : null;
            const overdue = due && due < new Date() && !t.done;
            const prio = PRIORITY_PILL[t.priority] ?? PRIORITY_PILL.MEDIUM;
            return (
              <div key={t.id} className="flex items-start gap-2 px-5 py-2.5 hover:bg-[#080b12] group">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => toggleDone(t)}
                  className="w-4 h-4 mt-0.5 rounded accent-emerald-500 cursor-pointer flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <span className={`text-xs ${t.done ? "text-slate-500 line-through" : "text-slate-200"}`}>
                    {t.title}
                  </span>
                  <div className="text-[10px] mt-0.5 flex items-center gap-2 flex-wrap">
                    <StageChip
                      value={t.stage}
                      suggestions={knownStages}
                      onSave={(s) => saveStage(t, s)}
                    />
                    <span className={prio.cls}>{prio.label}</span>
                    {t.assigneeName && <span className="text-slate-600">· {t.assigneeName}</span>}
                    {(start || due) && (
                      <span className={overdue ? "text-red-300" : "text-slate-600"}>
                        · {start ? formatBrazilDate(start) : "?"}{due ? ` → ${formatBrazilDate(due)}` : ""}
                      </span>
                    )}
                    <span className="text-slate-700">· interna</span>
                  </div>
                  {t.description && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{t.description}</p>}
                  <ChecklistEditor projectId={projectId} taskId={t.id} initial={t.checklist} />
                  {editingId === t.id && <TaskEditor projectId={projectId} task={t} onClose={() => setEditingId(null)} />}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                    className={`transition-opacity ${editingId === t.id ? "text-indigo-400" : "text-slate-600 hover:text-indigo-400 opacity-0 group-hover:opacity-100"}`}
                    title="Editar tarefa"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
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
          })}
        </div>
      )}
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
