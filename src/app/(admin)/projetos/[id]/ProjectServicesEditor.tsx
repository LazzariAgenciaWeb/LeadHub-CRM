"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListOrdered, Plus, ChevronUp, ChevronDown, X } from "lucide-react";

// Serviços entregues no projeto, em sequência ordenada. Cada tarefa aponta pra um
// deles; o Gantt do cliente agrupa por serviço nesta ordem (01, 02, 03…).
export default function ProjectServicesEditor({
  projectId, steps, services,
}: {
  projectId: string;
  steps: { id: string; name: string; order: number; taskCount: number }[];
  services: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, body?: any) {
    setBusy(true);
    await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  const add = () => { if (adding) { call(`/api/projetos/${projectId}/servicos`, "POST", { serviceId: adding }); setAdding(""); } };
  const move = (id: string, dir: "up" | "down") => call(`/api/projetos/${projectId}/servicos/${id}`, "PATCH", { move: dir });
  const remove = (id: string) => call(`/api/projetos/${projectId}/servicos/${id}`, "DELETE");

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
      <span className="text-slate-500 text-xs uppercase tracking-wider flex items-center gap-1.5">
        <ListOrdered className="w-3.5 h-3.5 text-indigo-400" strokeWidth={2.25} /> Serviços deste projeto (sequência)
      </span>

      {steps.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2">
              <span className="text-indigo-300 font-bold text-xs tabular-nums w-6">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 text-sm text-white truncate">{s.name}</span>
              <span className="text-slate-500 text-[11px]">{s.taskCount} tarefa{s.taskCount === 1 ? "" : "s"}</span>
              <button disabled={busy || i === 0} onClick={() => move(s.id, "up")} className="text-slate-400 hover:text-white disabled:opacity-30" title="Subir"><ChevronUp className="w-4 h-4" /></button>
              <button disabled={busy || i === steps.length - 1} onClick={() => move(s.id, "down")} className="text-slate-400 hover:text-white disabled:opacity-30" title="Descer"><ChevronDown className="w-4 h-4" /></button>
              <button disabled={busy} onClick={() => remove(s.id)} className="text-slate-500 hover:text-red-400 disabled:opacity-30" title="Remover"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-slate-600 text-xs mt-3">Nenhum serviço na sequência ainda. Adicione abaixo pra o cliente ver as etapas em ordem.</p>
      )}

      <div className="flex gap-2 mt-3">
        <select
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          disabled={busy || services.length === 0}
          className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
        >
          <option value="">{services.length === 0 ? "— cadastre serviços no catálogo —" : "— escolher serviço —"}</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          onClick={add}
          disabled={busy || !adding}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-3 py-2 rounded-lg whitespace-nowrap"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      <p className="text-slate-600 text-[11px] mt-1.5">
        Dá pra repetir o mesmo serviço (ex.: 3 hospedagens). Cada tarefa escolhe a qual serviço pertence.
      </p>
    </div>
  );
}
