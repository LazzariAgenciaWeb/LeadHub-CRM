"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Eye, EyeOff, ExternalLink } from "lucide-react";

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
  const [busy, setBusy] = useState<string | null>(null);

  if (tasks.length === 0) return null;

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

  return (
    <div className="bg-[#0a0f1a] border border-amber-500/30 rounded-xl p-5">
      <div className="flex items-center gap-2">
        <Inbox className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
        <span className="text-white text-sm font-semibold">Caixa de entrada — a organizar</span>
        <span className="text-amber-300 text-xs font-bold bg-amber-500/15 border border-amber-500/30 rounded-full px-2 py-0.5">{tasks.length}</span>
      </div>
      <p className="text-slate-500 text-xs mt-1 mb-3">
        Tarefas vindas do ClickUp que ainda não estão num serviço. Escolha o serviço (some daqui) e decida se o cliente vê.
      </p>

      <div className="flex flex-col gap-2">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-2 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2">
            <span className={`flex-1 text-sm truncate ${t.done ? "text-slate-500 line-through" : "text-white"}`}>{t.title}</span>

            {clickupUrlBase && t.clickupTaskId && (
              <a href={`${clickupUrlBase}${t.clickupTaskId}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-indigo-400 flex-none" title="Abrir no ClickUp">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              disabled={busy === t.id}
              onClick={() => patch(t.id, { visibleToClient: !t.visibleToClient })}
              className={`flex-none disabled:opacity-30 ${t.visibleToClient ? "text-emerald-400 hover:text-emerald-300" : "text-slate-500 hover:text-white"}`}
              title={t.visibleToClient ? "Cliente vê — clique pra ocultar" : "Oculta do cliente — clique pra mostrar"}
            >
              {t.visibleToClient ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>

            {serviceSteps.length > 0 ? (
              <select
                disabled={busy === t.id}
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
        ))}
      </div>
    </div>
  );
}
