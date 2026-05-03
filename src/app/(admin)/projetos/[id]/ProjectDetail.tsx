"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Trash2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { ProjectStatus } from "@/generated/prisma";
import { formatBrazilDateTime, formatBrazilDate } from "@/lib/datetime";

type Project = {
  id:                  string;
  name:                string;
  description:         string | null;
  type:                string | null;
  clickupListId:       string;
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

export default function ProjectDetail({
  project, availableUsers, activities, clientCompanies,
}: {
  project: Project;
  availableUsers: { id: string; name: string }[];
  activities: Activity[];
  clientCompanies: { id: string; name: string }[];
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

  async function syncNow() {
    setSaving(true);
    await fetch("/api/cron/projetos-sync", { method: "POST" });
    setSaving(false);
    router.refresh();
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

          {/* Progresso ClickUp */}
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
                    ⚠ {project.taskNoDueDate} tarefas sem prazo no ClickUp · equipe perde -3 pts/dia
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
                        <div className="text-slate-600 text-[10px] mt-0.5">
                          {a.authorName && <>{a.authorName} · </>}
                          {formatBrazilDateTime(a.createdAt)}
                        </div>
                      </div>
                      {!isFollowup && a.taskId && (
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

          {/* List ID do ClickUp (editável) */}
          <ClickupListIdEditor
            projectId={project.id}
            current={project.clickupListId}
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

/** Editor inline do List ID do ClickUp — útil pra corrigir colagens erradas. */
function ClickupListIdEditor({ projectId, current }: { projectId: string; current: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim() || value.trim() === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/projetos/${projectId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ clickupListId: value.trim() }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-500 text-xs uppercase tracking-wider">List ID (ClickUp)</span>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-slate-500 hover:text-white text-[10px]">
            Editar
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
            Ao trocar, o histórico de tarefas é resetado pra refletir a nova lista.
          </p>
          <div className="flex gap-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(current); }}
              className="px-2 py-1.5 text-slate-500 hover:text-white text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <code className="text-slate-400 text-xs font-mono break-all">{current}</code>
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
