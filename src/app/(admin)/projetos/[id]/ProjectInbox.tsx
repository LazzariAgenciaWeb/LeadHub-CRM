"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Eye, EyeOff, ExternalLink, CheckSquare, Square, X, Ban, RotateCcw, ChevronDown, ChevronUp, ChevronRight, Layers, CornerDownRight } from "lucide-react";

// Caixa de entrada "a organizar": tarefas espelhadas do ClickUp que ainda não
// têm serviço. Cada uma aparece UMA vez aqui (não nos serviços). Ao escolher um
// serviço, ela sai da caixa e passa a viver sob aquele serviço.
type InboxTask = {
  id: string;
  title: string;
  done: boolean;
  visibleToClient: boolean;
  clickupTaskId: string | null;
  // Tarefa-mãe no ClickUp. É o que deixa a caixa parecida com o ClickUp:
  // a principal com as subtarefas embaixo, em vez de tudo achatado.
  parentClickupTaskId?: string | null;
  // Quantas subtarefas ela tem no ClickUp. 0 = não é tarefa principal, e aí
  // não faz sentido oferecer "virar etapa" — etapa é mãe, nunca folha.
  subtarefasTotal?: number;
};

export default function ProjectInbox({
  projectId, tasks, ignoredTasks = [], serviceSteps, clickupUrlBase, embedded = false,
}: {
  projectId: string;
  tasks: InboxTask[];
  ignoredTasks?: InboxTask[];
  serviceSteps: { id: string; name: string; order: number; clickupTaskId?: string | null }[];
  clickupUrlBase: string | null; // ex.: "https://app.clickup.com/t/" — pra deep-link
  // embedded = renderiza sem card/cabeçalho próprios, pra viver dentro de uma
  // aba do card de Tarefas (o rótulo da aba já diz o que é).
  embedded?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); // taskId ativo p/ ação individual
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  // Grupos fechados, por id (id da tarefa principal, ou da etapa). Fechado é a
  // exceção: abre tudo e o usuário colapsa o que já resolveu.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  function toggleGroup(id: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Etapas que já têm tarefa principal no ClickUp, pelo id dessa tarefa.
  const etapaByClickup = useMemo(
    () => new Map(serviceSteps.filter((e) => e.clickupTaskId).map((e) => [e.clickupTaskId!, e])),
    [serviceSteps],
  );

  // Hierarquia: subtarefa fica aninhada sob a principal quando as duas estão
  // aqui. Principal com subtarefas é candidata a virar ETAPA — é assim que o
  // mês do ClickUp entra no LeadHub sem você redigitar nada.
  const { etapaGroups, roots, childrenOf } = useMemo(() => {
    const porClickupId = new Map(
      tasks.filter((t) => t.clickupTaskId).map((t) => [t.clickupTaskId!, t]),
    );
    const filhas   = new Map<string, InboxTask[]>(); // mãe que ainda está na caixa
    const deEtapa  = new Map<string, InboxTask[]>(); // mãe que JÁ virou etapa
    for (const t of tasks) {
      const pai = t.parentClickupTaskId;
      if (!pai) continue;
      const alvo = etapaByClickup.has(pai) ? deEtapa : porClickupId.has(pai) ? filhas : null;
      if (!alvo) continue;
      const arr = alvo.get(pai) ?? [];
      arr.push(t);
      alvo.set(pai, arr);
    }
    const agrupadas = new Set(
      [...filhas.values(), ...deEtapa.values()].flat().map((t) => t.id),
    );
    return {
      etapaGroups: [...deEtapa.entries()].map(([cid, itens]) => ({
        etapa: etapaByClickup.get(cid)!,
        itens,
      })),
      roots:      tasks.filter((t) => !agrupadas.has(t.id)),
      childrenOf: filhas,
    };
  }, [tasks, etapaByClickup]);

  const allIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const allSelected = selected.size > 0 && selected.size === tasks.length;
  const someSelected = selected.size > 0 && !allSelected;

  // Card solto some de vez quando não há nada na fila nem em ignorados.
  // Embutido numa aba, fica — a aba precisa mostrar o estado vazio.
  if (!embedded && tasks.length === 0 && ignoredTasks.length === 0) return null;

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

  // Esta tarefa é uma etapa: reusa a MESMA tarefa do ClickUp como tarefa
  // principal da etapa e leva as subtarefas pra dentro dela.
  async function promover(t: InboxTask, nFilhas: number) {
    const ok = confirm(
      `Transformar "${t.title}" em etapa?\n\n` +
      `A tarefa principal do ClickUp passa a ser a etapa (nada novo é criado lá)` +
      (nFilhas > 0 ? ` e ${nFilhas} subtarefa${nFilhas > 1 ? "s" : ""} entra${nFilhas > 1 ? "m" : ""} dentro dela.` : ".") +
      `\n\nEla deixa de aparecer como tarefa.`,
    );
    if (!ok) return;
    setBusy(t.id);
    const r = await fetch(`/api/projetos/${projectId}/tasks/${t.id}/promover-etapa`, { method: "POST" })
      .then((x) => x.json())
      .catch(() => null);
    setBusy(null);
    if (r && !r.ok && r.error) alert(r.error);
    router.refresh();
  }

  // ── Ações em massa ──────────────────────────────────────────────────────
  // `idsArg` deixa um grupo agir sobre as próprias linhas sem passar pelo modo
  // seleção (o "pôr todas na etapa" do cabeçalho da etapa).
  async function bulk(body: any, idsArg?: string[]) {
    const ids = idsArg ?? Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    await fetch(`/api/projetos/${projectId}/tasks/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: ids, ...body }),
    }).catch(() => {});
    setBulkBusy(false);
    if (!idsArg) {
      setSelected(new Set());
      // Depois de pôr todo mundo num serviço, a caixa esvazia — sair do modo
      // seleção também. Manter no modo mostrar/ocultar, que segue mostrando as tarefas.
      if (body.projectServiceId) setSelectMode(false);
    }
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

  // Uma linha da caixa. `nFilhas` > 0 marca a tarefa como principal (ganha o
  // botão "virar etapa"); `sub` desenha a linha como subtarefa, sem moldura.
  // Só tarefa principal recebe "virar etapa": etapa é mãe, nunca folha.
  function row(t: InboxTask, nFilhas: number, sub = false, onToggle?: () => void, aberto = true) {
    const isChecked = selected.has(t.id);
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 transition-colors ${
          sub ? "rounded-md" : nFilhas > 0 ? "" : "border rounded-lg"
        } ${
          selectMode && isChecked
            ? "bg-amber-500/10 border-amber-500/40"
            : sub ? "bg-[#161f30]/60" : "bg-[#161f30] border-[#1e2d45]"
        }`}
      >
        {onToggle && (
          <button
            onClick={onToggle}
            className="flex-none text-slate-500 hover:text-white"
            title={aberto ? "Fechar as subtarefas" : "Abrir as subtarefas"}
            aria-expanded={aberto}
          >
            {aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}

        {selectMode && (
          <button
            onClick={() => toggleOne(t.id)}
            className="flex-none text-amber-300 hover:text-amber-200"
            title={isChecked ? "Desmarcar" : "Marcar"}
          >
            {isChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          </button>
        )}

        <span className={`flex-1 truncate ${sub ? "text-xs" : "text-sm"} ${t.done ? "text-slate-500 line-through" : "text-white"}`}>
          {t.title}
        </span>

        {nFilhas > 0 && (
          <span className="flex-none text-[11px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 rounded-full px-2 py-0.5">
            {nFilhas} subtarefa{nFilhas > 1 ? "s" : ""}
          </span>
        )}

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

        <button
          disabled={busy === t.id || bulkBusy}
          onClick={() => patch(t.id, { ignored: true })}
          className="flex-none text-slate-600 hover:text-red-400 disabled:opacity-30 transition-colors"
          title="Ignorar — sai da fila sem apagar (dá pra restaurar)"
          aria-label="Ignorar tarefa"
        >
          <Ban className="w-4 h-4" />
        </button>

        {!sub && nFilhas > 0 && t.clickupTaskId && (
          <button
            disabled={busy === t.id || bulkBusy}
            onClick={() => promover(t, nFilhas)}
            className="flex-none text-xs px-2 py-1 rounded bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-200 disabled:opacity-40 flex items-center gap-1"
            title="Esta tarefa é uma etapa (um mês, uma fase): ela vira etapa e as subtarefas entram dentro"
          >
            <Layers className="w-3.5 h-3.5" /> virar etapa
          </button>
        )}

        {serviceSteps.length > 0 ? (
          <select
            disabled={busy === t.id || bulkBusy}
            defaultValue=""
            onChange={(e) => { if (e.target.value) patch(t.id, { projectServiceId: e.target.value }); }}
            className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-40 flex-none"
            title="Pôr numa etapa"
          >
            <option value="">— pôr na etapa —</option>
            {serviceSteps.map((st, i) => (
              <option key={st.id} value={st.id}>{String(i + 1).padStart(2, "0")} · {st.name}</option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-slate-600 flex-none">crie etapas pra organizar</span>
        )}
      </div>
    );
  }

  return (
    <div className={embedded ? "px-5 py-4" : "bg-[#0a0f1a] border border-amber-500/30 rounded-xl p-5"}>
      {/* Cabeçalho + botão de entrar/sair do modo seleção */}
      <div className="flex items-center gap-2 flex-wrap">
        {!embedded && (
          <>
            <Inbox className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
            <span className="text-white text-sm font-semibold">Caixa de entrada — a organizar</span>
            <span className="text-amber-300 text-xs font-bold bg-amber-500/15 border border-amber-500/30 rounded-full px-2 py-0.5">
              {tasks.length}
            </span>
          </>
        )}
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
        Vieram do ClickUp e ainda não estão numa etapa, com as subtarefas identadas embaixo da principal — igual lá.
        Só tarefa principal tem <strong className="text-indigo-300">virar etapa</strong>: ela vira a etapa e as
        subtarefas entram dentro. A setinha fecha o grupo. Quando a principal já virou etapa, o que sobrou dela
        aparece sob o nome da etapa, em <strong className="text-emerald-300">verde</strong>. As outras: escolha a
        etapa, decida se o cliente vê, ou ignore.
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
          <button
            disabled={bulkBusy || selected.size === 0}
            onClick={() => bulk({ ignored: true })}
            className="text-xs px-2 py-1 rounded bg-[#080b12] hover:bg-red-500/15 border border-[#1e2d45] hover:border-red-500/30 text-slate-300 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            title="Ignorar as selecionadas — saem da fila sem apagar"
          >
            <Ban className="w-3.5 h-3.5" /> Ignorar
          </button>

          {serviceSteps.length > 0 && (
            <select
              disabled={bulkBusy || selected.size === 0}
              defaultValue=""
              onChange={(e) => { if (e.target.value) { bulk({ projectServiceId: e.target.value }); e.currentTarget.value = ""; } }}
              className="bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Pôr as selecionadas numa etapa"
            >
              <option value="">— pôr na etapa —</option>
              {serviceSteps.map((s, i) => (
                <option key={s.id} value={s.id}>{String(i + 1).padStart(2, "0")} · {s.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Lista de tarefas — principal com as subtarefas embaixo, como no ClickUp */}
      <div className="flex flex-col gap-2">
        {tasks.length === 0 && (
          <p className="text-slate-600 text-xs py-2">Nada a organizar — tudo já está numa etapa ou foi ignorado. 👌</p>
        )}
        {/* Mãe que JÁ virou etapa: ela não está mais aqui, mas as subtarefas que
            ficaram de fora continuam. Agrupa embaixo do nome da etapa pra você
            ver de onde vieram e mandar pra dentro de uma vez. */}
        {etapaGroups.map(({ etapa, itens }) => {
          const aberto = !closed.has(etapa.id);
          return (
            <div key={etapa.id} className="border border-emerald-500/30 rounded-lg overflow-hidden bg-[#0d1422]">
              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/5">
                <button
                  onClick={() => toggleGroup(etapa.id)}
                  className="flex-none text-slate-500 hover:text-white"
                  title={aberto ? "Fechar" : "Abrir"}
                  aria-expanded={aberto}
                >
                  {aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <Layers className="w-4 h-4 text-emerald-400 flex-none" />
                <span className="flex-1 truncate text-sm text-white">{etapa.name}</span>
                <span className="flex-none text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
                  etapa criada
                </span>
                <span className="flex-none text-[11px] text-slate-500">
                  {itens.length} fora dela
                </span>
                <button
                  disabled={bulkBusy}
                  onClick={() => bulk({ projectServiceId: etapa.id }, itens.map((i) => i.id))}
                  className="flex-none text-xs px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-200 disabled:opacity-40"
                  title="Põe todas essas subtarefas dentro da etapa"
                >
                  pôr todas na etapa
                </button>
              </div>
              {aberto && (
                <div className="pl-5 pr-3 pt-1 pb-2.5 flex flex-col gap-1.5">
                  <div className="border-l-2 border-emerald-500/25 pl-3 flex flex-col gap-1.5">
                    {itens.map((f) => (
                      <div key={f.id} className="flex items-center gap-1.5">
                        <CornerDownRight className="w-3.5 h-3.5 text-emerald-400/50 flex-none" />
                        <div className="flex-1 min-w-0">{row(f, 0, true)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {roots.map((t) => {
          const filhas = (t.clickupTaskId ? childrenOf.get(t.clickupTaskId) : undefined) ?? [];
          // Mãe pelo ClickUp, não pelo que sobrou na caixa: filha já organizada
          // não tira da mãe o direito de virar etapa.
          const nFilhas = t.subtarefasTotal ?? filhas.length;
          const aberto  = !closed.has(t.id);
          return (
            <div
              key={t.id}
              className={nFilhas > 0 ? "border border-indigo-500/25 rounded-lg overflow-hidden bg-[#0d1422]" : ""}
            >
              {row(t, nFilhas, false, filhas.length > 0 ? () => toggleGroup(t.id) : undefined, aberto)}
              {aberto && filhas.length > 0 && (
                <div className="pl-5 pr-3 pt-1 pb-2.5 flex flex-col gap-1.5">
                  {/* Trilho à esquerda = a identação. Bate o olho e vê o que é
                      subtarefa de quem, igual à árvore do ClickUp. */}
                  <div className="border-l-2 border-indigo-500/25 pl-3 flex flex-col gap-1.5">
                    {filhas.map((f) => (
                      <div key={f.id} className="flex items-center gap-1.5">
                        <CornerDownRight className="w-3.5 h-3.5 text-indigo-400/50 flex-none" />
                        <div className="flex-1 min-w-0">{row(f, 0, true)}</div>
                      </div>
                    ))}
                  </div>
                  {filhas.length < nFilhas && (
                    <p className="text-[11px] text-slate-600 pl-3">
                      +{nFilhas - filhas.length} subtarefa{nFilhas - filhas.length > 1 ? "s" : ""} já organizada{nFilhas - filhas.length > 1 ? "s" : ""} ou ignorada{nFilhas - filhas.length > 1 ? "s" : ""}.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Ignorados — fora da fila, mas recuperável */}
      {ignoredTasks.length > 0 && (
        <div className="mt-3 border-t border-[#1e2d45] pt-3">
          <button
            onClick={() => setIgnoredOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left group"
            aria-expanded={ignoredOpen}
          >
            <span className="text-[11px] text-slate-500 group-hover:text-slate-300 flex items-center gap-1.5 transition-colors">
              <Ban className="w-3.5 h-3.5" />
              Ignorados ({ignoredTasks.length})
            </span>
            {ignoredOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-600" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-600" />}
          </button>

          {ignoredOpen && (
            <div className="mt-2 flex flex-col gap-1.5">
              {ignoredTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 bg-[#0d1422] border border-[#1a2334] rounded-lg px-3 py-1.5">
                  <span className="flex-1 text-xs text-slate-500 truncate line-through">{t.title}</span>
                  {clickupUrlBase && t.clickupTaskId && (
                    <a href={`${clickupUrlBase}${t.clickupTaskId}`} target="_blank" rel="noreferrer" className="text-slate-700 hover:text-indigo-400 flex-none" title="Abrir no ClickUp">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    disabled={busy === t.id || bulkBusy}
                    onClick={() => patch(t.id, { ignored: false })}
                    className="flex-none text-[11px] text-slate-500 hover:text-emerald-300 disabled:opacity-30 flex items-center gap-1 transition-colors"
                    title="Restaurar — volta pra fila"
                  >
                    <RotateCcw className="w-3 h-3" /> restaurar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
