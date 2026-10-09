"use client";

import { useEffect, useState } from "react";
import { Download, RefreshCw, Check } from "lucide-react";

type Att = { id: string; title: string; extension: string; size: number; thumbnail: string | null; imported: boolean };

/**
 * Anexos que estão no ClickUp da tarefa espelhada. A equipe escolhe o que
 * trazer pro LeadHub (aí entra na peça do link de aprovação). O caminho
 * inverso é automático: arquivo subido aqui vai pro ClickUp sozinho.
 */
export default function ClickupAttachments({ projectId, taskId, onImported, refreshKey = 0 }: { projectId: string; taskId: string; onImported: () => void; refreshKey?: number }) {
  const [list, setList] = useState<Att[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const res = await fetch(`/api/projetos/${projectId}/tasks/${taskId}/clickup-anexos`).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (!res?.ok) { setErr(d?.error ?? "Não foi possível ler o ClickUp."); setList([]); return; }
    setList(d.attachments ?? []);
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [projectId, taskId, refreshKey]);

  async function bring(ids: string[] | null) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/projetos/${projectId}/tasks/${taskId}/clickup-anexos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ids ?? [] }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) { setMsg(d?.error ?? "Falhou."); return; }
    setMsg(`${d.imported} arquivo${d.imported === 1 ? "" : "s"} trazido${d.imported === 1 ? "" : "s"}${d.errors?.length ? ` · ${d.errors.length} com erro` : ""}.`);
    setSel(new Set());
    await load();
    onImported();
  }

  const pending = (list ?? []).filter((a) => !a.imported);

  return (
    <div className="bg-[#0a0f1a] border border-[#7b68ee]/30 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#b9aefb]">Anexos no ClickUp {list ? `(${list.length})` : ""}</span>
        <span className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="text-slate-500 hover:text-white" title="Recarregar"><RefreshCw className="w-3 h-3" /></button>
          {sel.size > 0 && (
            <button type="button" disabled={busy} onClick={() => bring([...sel])} className="text-[11px] font-semibold text-[#b9aefb] hover:text-white disabled:opacity-50">
              Trazer {sel.size}
            </button>
          )}
          {pending.length > 0 && (
            <button type="button" disabled={busy} onClick={() => bring(null)} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-[#7b68ee]/20 border border-[#7b68ee]/40 text-[#d6cffd] hover:bg-[#7b68ee]/30 disabled:opacity-50">
              <Download className="w-3 h-3" /> {busy ? "Trazendo…" : `Trazer todos (${pending.length})`}
            </button>
          )}
        </span>
      </div>
      {list === null && <div className="text-[11px] text-slate-500">Lendo o ClickUp…</div>}
      {err && <div className="text-[11px] text-red-300">{err}</div>}
      {list && !err && list.length === 0 && <div className="text-[11px] text-slate-500">Nenhum anexo na tarefa do ClickUp.</div>}
      {list && list.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.map((a) => {
            const on = sel.has(a.id);
            return (
              <button
                key={a.id}
                type="button"
                disabled={a.imported || busy}
                onClick={() => setSel((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
                title={a.imported ? `${a.title} — já está no LeadHub` : `${a.title} — clique pra selecionar`}
                className={`relative w-20 rounded-md overflow-hidden border text-left ${on ? "border-[#7b68ee] ring-1 ring-[#7b68ee]" : "border-[#1e2d45]"} ${a.imported ? "opacity-50" : "hover:border-[#7b68ee]/70"}`}
              >
                <div className="h-16 bg-[#080b12] flex items-center justify-center">
                  {a.thumbnail
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.thumbnail} alt="" className="w-full h-full object-cover" />
                    : <span className="text-[10px] uppercase text-slate-500">{a.extension || "arq"}</span>}
                </div>
                <div className="px-1 py-0.5 text-[9px] text-slate-400 truncate">{a.title}</div>
                {(a.imported || on) && (
                  <span className={`absolute top-1 right-1 w-4 h-4 rounded-full grid place-items-center ${a.imported ? "bg-emerald-500" : "bg-[#7b68ee]"}`}>
                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {msg && <div className="text-[11px] text-slate-300 mt-2">{msg}</div>}
      <p className="text-[10px] text-slate-600 mt-2">✓ verde = já está no LeadHub. Arquivo que você sobe aqui vai pro ClickUp sozinho.</p>
    </div>
  );
}
