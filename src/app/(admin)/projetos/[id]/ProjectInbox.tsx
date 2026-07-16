"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Eye, EyeOff, ExternalLink, CheckSquare, Square, X } from "lucide-react";

// Caixa de entrada "a organizar": tarefas espelhadas do ClickUp que ainda não
// têm serviço. Cada uma aparece UMA vez aqui (não nos serviços). Ao escolher um
// serviço, ela sai da caixa e passa a viver sob aquele serviço.
type InboxTask = {
  id: string;
  title: string;
  done: boolean;
  visibleToClient: boolean;
  clickupTaskId: string | null;
};

export default function ProjectInbox({
  projectId, tasks, serviceSteps, clickupUrlBase,
}: {
  projectId: string;
  tasks: InboxTask[];
  serviceSteps: { id: string; name: string; order: number }[];
  clickupUrlBase: string | null; // ex.: "https://app.clickup.com/t/" — pra deep-link
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); // taskId ativo p/ ação individual
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const allSelected = selected.size > 0 && selected.size === tasks.length;
  const someSelected = selected.size > 0 && !allSelected;

  if (tasks.length === 0) return null;

  // ── Ações individuais (mantidas quando NÃO está em modo seleção) ────────
  async function patch(taskId: string, body: any) {
    setBusy(taskId);
    await fetch(`/api/projetos/${projectId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
    setBusy(null);
    router.refresh();
  }

  // ── Ações em massa ──────────────────────────────────────────────────────
  async function bulk(body: any) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    await fetch(`/api/projetos/${projectId}/tasks/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: ids, ...body }),
    }).catch(() => {});
    setBulkBusy(false);
    setSelected(new Set());
    // Depois de pôr todo mundo num serviço, a caixa esvazia — sair do modo
    // seleção também. Manter no modo mostrar/ocultar, que segue mostrando as tarefas.
    if (body.projectServiceId) setSelectMode(false);
    router.refresh();
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAll() { setSelected(new Set(allIds)); }
  function clearSel() { setSelected(new Set()); }
  function exitSelectMode() { setSelected(new Set()); setSelectMode(false); }

  return (
    <div className="bg-[#0a0f1a] border border-amber-500/30 rounded-xl p-5">
      {/* Cabeçalho + botão de entrar/sair do modo seleção */}
      <div className="flex items-center gap-2 flex-wrap">
        <Inbox className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
        <span className="text-white text-sm font-semibold">Caixa de entrada — a organizar</span>
        <span className="text-amber-300 text-xs font-bold bg-amber-500/15 border border-amber-500/30 rounded-full px-2 py-0.5">
          {tasks.length}
        </span>
        <span className="flex-1" />
        {!selectMode ? (
          <button
            onClick={() => setSelectMode(true)}
            className="text-xs px-2.5 py-1 rounded bg-[#080b12] hover:bg-[#161f30] border border-[#1e2d45] text-slate-300 flex items-center gap-1"
          >
            <CheckSquare className="w-3.5 h-3.5" /> Selecionar
          </button>
        ) : (
          <button
            onClick={exitSelectMode}
            className="text-xs px-2.5 py-1 rounded bg-[#080b12] hover:bg-[#161f30] border border-[#1e2d45] text-slate-300 flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Sair da seleção
          </button>
        )}
      </div>
      <p className="text-slate-500 text-xs mt-1 mb-3">
        Tarefas vindas do ClickUp que ainda não estão num serviço. Escolha o serviço (some daqui) e decida se o cliente vê.
      </p>

      {/* Barra de seleção — some quando não está no modo */}
      {selectMode && (
        <div className="mb-3 flex items-center gap-2 flex-wrap bg-amber-500/5 border border-amber-500/25 rounded-lg px-3 py-2">
          <button
            onClick={allSelected ? clearSel : selectAll}
            className="text-xs text-amber-200 hover:text-amber-100 flex items-center gap-1"
          >
            {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            {allSelected ? "Limpar seleção" : `Selecionar todas (${tasks.length})`}
          </button>
          <span className="text-slate-600">·</span>
          <span className="text-[11px] text-slate-400">
            {selected.size === 0 ? "Nenhuma selecionada" : `${selected.size} selecionada${selected.size > 1 ? "s" : ""}`}
          </span>
          {someSelected && (
            <button onClick={clearSel} className="text-[11px] text-slate-500 hover:text-white ml-1">
              limpar
            </button>
          )}

          <span className="flex-1" />

          {/* Ações em massa — desabilitadas quando 0 selecionadas */}
          <button
            disabled={bulkBusy || selected.size === 0}
            onClick={() => bulk({ visibleToClient: true })}
            className="text-xs px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            title="Mostrar as selecionadas ao cliente"
          >
            <Eye className="w-3.5 h-3.5" /> Mostrar
          </button>
          <button
            disabled={bulkBusy || selected.size === 0}
            onClick={() => bulk({ visibleToClient: false })}
            className="text-xs px-2 py-1 rounded bg-[#080b12] hover:bg-[#161f30] border border-[#1e2d45] text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            title="Ocultar as selecionadas do cliente"
          >
            <EyeOff className="w-3.5 h-3.5" /> Ocultar
          </button>

          {serviceSteps.length > 0 && (
            <select
              disabled={bulkBusy || selected.size === 0}
              defaultValue=""
              onChange={(e) => { if (e.target.value) { bulk({ projectServiceId: e.target.value }); e.currentTarget.value = ""; } }}
              className="bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Pôr as selecionadas num serviço"
            >
              <option value="">— pôr no serviço —</option>
              {serviceSteps.map((s, i) => (
                <option key={s.id} value={s.id}>{String(i + 1).padStart(2, "0")} · {s.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Lista de tarefas */}
      <div className="flex flex-col gap-2">
        {tasks.map((t) => {
          const isChecked = selected.has(t.id);
          return (
            <div
              key={t.id}
              className={`flex items-center gap-2 border rounded-lg px-3 py-2 transition-colors ${
                selectMode && isChecked
                  ? "bg-amber-500/10 border-amber-500/40"
                  : "bg-[#161f30] border-[#1e2d45]"
              }`}
            >
              {selectMode && (
                <button
                  onClick={() => toggleOne(t.id)}
                  className="flex-none text-amber-300 hover:text-amber-200"
                  title={isChecked ? "Desmarcar" : "Marcar"}
                >
                  {isChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
              )}

              <span className={`flex-1 text-sm truncate ${t.done ? "text-slate-500 line-through" : "text-white"}`}>{t.title}</span>

              {clickupUrlBase && t.clickupTaskId && (
                <a href={`${clickupUrlBase}${t.clickupTaskId}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-indigo-400 flex-none" title="Abrir no ClickUp">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              {/* Ações individuais ficam disponíveis mesmo no modo seleção, pra
                  quem quer tratar 1-a-1 sem sair do modo. */}
              <button
                disabled={busy === t.id || bulkBusy}
                onClick={() => patch(t.id, { visibleToClient: !t.visibleToClient })}
                className={`flex-none disabled:opacity-30 ${t.visibleToClient ? "text-emerald-400 hover:text-emerald-300" : "text-slate-500 hover:text-white"}`}
                title={t.visibleToClient ? "Cliente vê — clique pra ocultar" : "Oculta do cliente — clique pra mostrar"}
              >
                {t.visibleToClient ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>

              {serviceSteps.length > 0 ? (
                <select
                  disabled={busy === t.id || bulkBusy}
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) patch(t.id, { projectServiceId: e.target.value }); }}
                  className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-40 flex-none"
                  title="Pôr num serviço"
                >
                  <option value="">— pôr no serviço —</option>
                  {serviceSteps.map((s, i) => (
                    <option key={s.id} value={s.id}>{String(i + 1).padStart(2, "0")} · {s.name}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-slate-600 flex-none">crie serviços pra organizar</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
