"use client";

import { useState } from "react";

// "Guardar em Arquivos" — copia um anexo (chamado/tarefa) pra biblioteca do
// cliente (Meu Espaço → Arquivos). Abre uma janelinha pra escolher pasta e
// título. Janela fixa no centro: o botão costuma estar em lugares apertados
// (barra lateral do chamado, miniatura de 64px).
export default function SaveToLibraryButton({
  clientId,
  storageObjectId,
  fileName,
  variant = "text",
}: {
  clientId: string;
  storageObjectId: string;
  fileName: string;
  variant?: "text" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState(fileName);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedIn, setSavedIn] = useState<string | null>(null);

  async function openModal(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
    setError(null);
    const res = await fetch(`/api/biblioteca/${clientId}`).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    if (data) {
      const used = (data.items ?? []).map((i: { folder: string }) => i.folder);
      setFolders([...new Set<string>([...used, ...(data.defaultFolders ?? [])])].sort((a, b) => a.localeCompare(b, "pt-BR")));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/biblioteca/${clientId}/guardar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageObjectId, folder, title, description }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) { setError(data.error ?? "Não foi possível guardar"); return; }
    setSavedIn(data.item?.folder ?? (folder || "Geral"));
    setOpen(false);
  }

  const listId = `lib-save-${storageObjectId}`;

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={openModal}
          title={savedIn ? `Guardado em Arquivos · ${savedIn}` : "Guardar nos Arquivos do cliente"}
          className={`w-5 h-5 rounded-full border text-[10px] leading-none flex items-center justify-center ${
            savedIn ? "bg-emerald-600 border-emerald-400 text-white" : "bg-[#0a0f1a] border-[#1e2d45] text-slate-300 hover:text-white hover:border-indigo-400"
          }`}
        >
          {savedIn ? "✓" : "🗂"}
        </button>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className={`text-[10px] font-semibold whitespace-nowrap ${savedIn ? "text-emerald-400" : "text-slate-500 hover:text-indigo-300"}`}
          title="Guardar nos Arquivos do cliente (Meu Espaço)"
        >
          {savedIn ? `✓ Em Arquivos · ${savedIn}` : "🗂 Guardar em Arquivos"}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60"
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
        >
          <div className="w-full max-w-sm bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-white text-sm font-semibold">🗂 Guardar nos Arquivos do cliente</h3>
              <p className="text-slate-500 text-[11px] mt-0.5">Vai aparecer em Meu Espaço → Arquivos, na pasta escolhida.</p>
            </div>
            <datalist id={listId}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
            <label className="block">
              <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">Pasta</span>
              <input
                autoFocus
                list={listId}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Ex.: Redes sociais"
                className="mt-1 w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">Título</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">Descrição (opcional)</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="mt-1 w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 resize-y"
              />
            </label>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">Cancelar</button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
