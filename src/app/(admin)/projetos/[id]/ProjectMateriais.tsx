"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Plus, Trash2, FileText, Video, PlayCircle, Link2, Paperclip, ExternalLink, Users, X } from "lucide-react";

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

  // ── Modal de novo material ────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [kind, setKind] = useState("LINK");
  const [taskId, setTaskId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [docHtml, setDocHtml] = useState("");
  const [ata, setAta] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Abre o modal; `preTask` pré-seleciona a tarefa (""=no projeto).
  function openModal(preTask: string) {
    setErr(""); setTitle(""); setUrl(""); setDocHtml(""); setAta("");
    setTaskId(preTask);
    setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); }

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

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
      setModalOpen(false);
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  }

  async function del(mid: string) {
    if (!confirm("Remover este material?")) return;
    setMaterials((m) => m.filter((x) => x.id !== mid));
    await fetch(`/api/projetos/${projectId}/materiais/${mid}`, { method: "DELETE" });
  }

  const loose = materials.filter((m) => !m.taskId);

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

  // Botão "+ material" compacto usado em cada grupo (projeto / tarefa).
  function AddBtn({ preTask }: { preTask: string }) {
    return (
      <button
        onClick={() => openModal(preTask)}
        className="text-[11px] px-2 py-1 rounded-md border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 flex items-center gap-1 flex-none"
      >
        <Plus className="w-3 h-3" /> material
      </button>
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
        <div className="text-white text-sm font-medium mb-3">Materiais ({materials.length})</div>

        {/* Do projeto */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-slate-500 text-[11px] uppercase tracking-wide">Do projeto</div>
            <AddBtn preTask="" />
          </div>
          {loose.length > 0
            ? <div className="space-y-2">{loose.map((m) => <MaterialRow key={m.id} m={m} />)}</div>
            : <p className="text-slate-600 text-xs italic">Nenhum material solto no projeto.</p>}
        </div>

        {/* Por tarefa — toda tarefa aparece, com botão de adicionar já vinculado */}
        {tasks.map((t) => {
          const items = materials.filter((m) => m.taskId === t.id);
          return (
            <div key={t.id} className="mb-4">
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <div className="text-slate-500 text-[11px] uppercase tracking-wide truncate">Tarefa · {t.title}</div>
                <AddBtn preTask={t.id} />
              </div>
              {items.length > 0
                ? <div className="space-y-2">{items.map((m) => <MaterialRow key={m.id} m={m} />)}</div>
                : <p className="text-slate-600 text-xs italic">Sem materiais nesta tarefa.</p>}
            </div>
          );
        })}

        {/* Rodapé: entrada principal pra adicionar */}
        <button
          onClick={() => openModal("")}
          className="mt-1 w-full py-2.5 rounded-xl border border-dashed border-slate-700 text-slate-300 text-sm font-medium hover:border-indigo-500/50 hover:text-indigo-300 flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Adicionar material
        </button>
      </div>

      {/* ── Modal ─────────────────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0b111c] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="text-white text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> Adicionar material</div>
              <button onClick={closeModal} className="text-slate-500 hover:text-white" aria-label="Fechar"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
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
              </div>
              <div>
                <label className="text-slate-400 text-xs">Título</label>
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls + " mt-1"} placeholder="Ex.: Vídeo da reunião" />
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
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-800">
              <button onClick={closeModal} className="px-4 py-2 rounded-lg text-slate-400 hover:text-white text-sm">Cancelar</button>
              <button onClick={addMaterial} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium">
                {saving ? "Salvando…" : "Adicionar material"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
