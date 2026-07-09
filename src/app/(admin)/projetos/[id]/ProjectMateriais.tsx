"use client";

import { useState } from "react";
import { Copy, Check, Plus, Trash2, FileText, Video, PlayCircle, Link2, Paperclip, ExternalLink, Users } from "lucide-react";

type Task = { id: string; title: string };
type Material = {
  id: string; kind: string; taskId: string | null; stage: string | null;
  title: string; docHtml: string | null; url: string | null; ata: string | null;
};

const KIND_OPTS = [
  { v: "DOCUMENTO", l: "Documento (HTML)" },
  { v: "REUNIAO", l: "Reunião (vídeo + ata)" },
  { v: "APOIO", l: "Vídeo de apoio" },
  { v: "LINK", l: "Link" },
  { v: "ANEXO", l: "Anexo (link do arquivo)" },
];
const KIND_ICON: Record<string, any> = { DOCUMENTO: FileText, REUNIAO: Video, APOIO: PlayCircle, LINK: Link2, ANEXO: Paperclip };
const inputCls = "w-full rounded-lg bg-slate-950 border border-slate-800 text-white text-sm px-3 py-2 outline-none focus:border-indigo-500";

export default function ProjectMateriais({
  projectId, tasks, materials: initialMaterials, publicToken: initialToken,
}: {
  projectId: string; tasks: Task[]; materials: Material[]; publicToken: string | null;
}) {
  const [materials, setMaterials] = useState<Material[]>(initialMaterials);
  const [token, setToken] = useState<string | null>(initialToken);
  const [copied, setCopied] = useState(false);
  const [genning, setGenning] = useState(false);

  const link = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/c/${token}` : "";

  async function genLink() {
    setGenning(true);
    try {
      const res = await fetch(`/api/projetos/${projectId}/link`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setToken(data.publicToken);
    } finally { setGenning(false); }
  }
  function copyLink() { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); }

  // Form de novo material
  const [kind, setKind] = useState("LINK");
  const [taskId, setTaskId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [docHtml, setDocHtml] = useState("");
  const [ata, setAta] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function addMaterial() {
    setErr("");
    if (!title.trim()) return setErr("Dê um título ao material");
    setSaving(true);
    try {
      const res = await fetch(`/api/projetos/${projectId}/materiais`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, taskId: taskId || undefined, title,
          url: kind === "DOCUMENTO" ? undefined : url,
          docHtml: kind === "DOCUMENTO" ? docHtml : undefined,
          ata: kind === "REUNIAO" ? ata : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setMaterials((m) => [...m, data]);
      setTitle(""); setUrl(""); setDocHtml(""); setAta("");
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  }

  async function del(mid: string) {
    if (!confirm("Remover este material?")) return;
    setMaterials((m) => m.filter((x) => x.id !== mid));
    await fetch(`/api/projetos/${projectId}/materiais/${mid}`, { method: "DELETE" });
  }

  const taskTitle = (tid: string) => tasks.find((t) => t.id === tid)?.title ?? "tarefa";
  const loose = materials.filter((m) => !m.taskId);
  const byTask = tasks
    .map((t) => ({ task: t, items: materials.filter((m) => m.taskId === t.id) }))
    .filter((g) => g.items.length > 0);

  function MaterialRow({ m }: { m: Material }) {
    const Icon = KIND_ICON[m.kind] ?? Link2;
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 flex items-center gap-3">
        <Icon className="w-4 h-4 text-indigo-400 flex-none" />
        <div className="min-w-0 flex-1">
          <div className="text-slate-200 text-sm truncate">{m.title}</div>
          {m.url && <div className="text-slate-500 text-[11px] truncate">{m.url}</div>}
        </div>
        {m.url && (
          <a href={m.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-indigo-400 flex-none" aria-label="Abrir">
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        <button onClick={() => del(m.id)} className="text-slate-500 hover:text-red-400 flex-none" aria-label="Remover">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 pt-0 space-y-6 max-w-4xl">
      {/* Link do cliente */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="text-white text-sm font-medium flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-indigo-400" /> Link do cliente</div>
        {token ? (
          <div className="flex items-center gap-2 flex-wrap">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-xs px-3 py-2">{link}</code>
            <button onClick={copyLink} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5">
              {copied ? <><Check className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
            </button>
            <a href={link} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 text-xs flex items-center gap-1.5 hover:bg-slate-800">
              <ExternalLink className="w-3.5 h-3.5" /> Abrir
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-slate-500 text-xs flex-1">Gere um link secreto (sem login) pra enviar ao cliente.</p>
            <button onClick={genLink} disabled={genning} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium">
              {genning ? "Gerando…" : "Gerar link"}
            </button>
          </div>
        )}
      </div>

      {/* Lista de materiais */}
      <div>
        <div className="text-white text-sm font-medium mb-2">Materiais ({materials.length})</div>

        {loose.length > 0 && (
          <div className="mb-3">
            <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1.5">Do projeto</div>
            <div className="space-y-2">{loose.map((m) => <MaterialRow key={m.id} m={m} />)}</div>
          </div>
        )}
        {byTask.map((g) => (
          <div key={g.task.id} className="mb-3">
            <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1.5">Tarefa · {g.task.title}</div>
            <div className="space-y-2">{g.items.map((m) => <MaterialRow key={m.id} m={m} />)}</div>
          </div>
        ))}
        {materials.length === 0 && <p className="text-slate-600 text-xs">Nenhum material ainda.</p>}
      </div>

      {/* Adicionar */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
        <div className="text-white text-sm font-medium flex items-center gap-2"><Plus className="w-4 h-4" /> Adicionar material</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-slate-400 text-xs">Tipo</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls + " mt-1"}>
              {KIND_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-slate-400 text-xs">Onde</label>
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className={inputCls + " mt-1"}>
              <option value="">— No projeto —</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>Tarefa: {t.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-slate-400 text-xs">Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls + " mt-1"} placeholder="Ex.: Vídeo da reunião" />
          </div>
        </div>
        {kind === "DOCUMENTO" ? (
          <div>
            <label className="text-slate-400 text-xs">Conteúdo (HTML)</label>
            <textarea value={docHtml} onChange={(e) => setDocHtml(e.target.value)} rows={5} className={inputCls + " mt-1 font-mono text-xs"} placeholder="Cole o HTML do documento…" />
          </div>
        ) : (
          <div>
            <label className="text-slate-400 text-xs">Link</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls + " mt-1"} placeholder="YouTube / Vimeo / Drive / link do arquivo" />
          </div>
        )}
        {kind === "REUNIAO" && (
          <div>
            <label className="text-slate-400 text-xs">Ata / anotações (opcional)</label>
            <textarea value={ata} onChange={(e) => setAta(e.target.value)} rows={3} className={inputCls + " mt-1"} placeholder="Resumo da reunião…" />
          </div>
        )}
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <button onClick={addMaterial} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium">
          {saving ? "Salvando…" : "Adicionar material"}
        </button>
      </div>
    </div>
  );
}
