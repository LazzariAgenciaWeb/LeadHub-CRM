"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AttachmentList from "./AttachmentList";
import { uploadFile, type StoredFile, type UploadTarget } from "./upload";

type Uploading = { key: string; name: string; pct: number; error?: string };

// Painel "Arquivos" de um chamado ou tarefa: lista, upload (botão ou arrastar)
// e exclusão. Em chamado, inclui também os arquivos enviados pela conversa.
export default function AttachmentsPanel({
  target,
  currentUserId,
  canManage = false,
  title = "Arquivos",
  refreshKey,
  onUploaded,
  onDeleted,
}: {
  target: Exclude<UploadTarget, { libraryCompanyId: string }>;
  currentUserId?: string;
  canManage?: boolean;
  title?: string;
  /** muda quando algo externo (ex.: mensagem com anexo) adicionou arquivo */
  refreshKey?: unknown;
  onUploaded?: (f: StoredFile) => void;
  onDeleted?: (f: StoredFile) => void;
}) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [me, setMe] = useState<{ id: string | null; manager: boolean } | null>(null);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = "ticketId" in target ? `ticketId=${target.ticketId}` : `projectTaskId=${target.projectTaskId}`;

  const load = useCallback(async () => {
    const res = await fetch(`/api/storage?${query}`);
    if (!res.ok) return setFiles([]);
    const data = await res.json();
    setFiles(data.files ?? []);
    setEnabled(data.enabled !== false);
    if (data.me) setMe(data.me);
  }, [query]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function handleFiles(list: FileList | File[] | null) {
    if (!list) return;
    for (const file of Array.from(list)) {
      const key = `${Date.now()}-${Math.random()}`;
      setUploading((u) => [...u, { key, name: file.name, pct: 0 }]);
      try {
        const saved = await uploadFile(file, target, {
          onProgress: (pct) => setUploading((u) => u.map((x) => (x.key === key ? { ...x, pct } : x))),
        });
        setFiles((f) => [saved, ...(f ?? [])]);
        setUploading((u) => u.filter((x) => x.key !== key));
        onUploaded?.(saved);
      } catch (e: any) {
        setUploading((u) => u.map((x) => (x.key === key ? { ...x, error: e?.message ?? "Erro" } : x)));
      }
    }
  }

  async function handleDelete(f: StoredFile) {
    if (!confirm(`Excluir "${f.fileName}"?`)) return;
    const res = await fetch(`/api/storage/${f.id}`, { method: "DELETE" });
    if (res.ok) {
      setFiles((list) => (list ?? []).filter((x) => x.id !== f.id));
      onDeleted?.(f);
    }
    else alert((await res.json().catch(() => ({}))).error ?? "Não foi possível excluir");
  }

  const userId = currentUserId ?? me?.id ?? undefined;
  const canDelete = (f: StoredFile) => canManage || !!me?.manager || (!!userId && f.uploadedById === userId);

  return (
    <div
      className={`bg-[#0f1623] border rounded-lg p-3 transition-colors ${dragOver ? "border-indigo-500" : "border-[#1e2d45]"}`}
      onDragOver={(e) => { if (!enabled) return; e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (enabled) void handleFiles(e.dataTransfer.files); }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-slate-500 uppercase tracking-wide">
          {title}{files && files.length > 0 ? ` (${files.length})` : ""}
        </div>
        {enabled && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-[11px] text-indigo-300 hover:text-indigo-200"
          >
            + Anexar
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {uploading.map((u) => (
        <div key={u.key} className="mb-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className={`truncate ${u.error ? "text-red-400" : "text-slate-400"}`}>{u.name}</span>
            {u.error ? (
              <button
                type="button"
                className="text-slate-500 hover:text-slate-300 ml-2"
                onClick={() => setUploading((list) => list.filter((x) => x.key !== u.key))}
              >×</button>
            ) : (
              <span className="text-slate-600 ml-2">{u.pct}%</span>
            )}
          </div>
          {u.error ? (
            <p className="text-[10px] text-red-400/80">{u.error}</p>
          ) : (
            <div className="h-1 bg-[#1e2d45] rounded overflow-hidden mt-0.5">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${u.pct}%` }} />
            </div>
          )}
        </div>
      ))}

      {files === null ? (
        <p className="text-[11px] text-slate-600">Carregando…</p>
      ) : files.length === 0 && uploading.length === 0 ? (
        <p className="text-[11px] text-slate-600">
          {enabled ? "Nenhum arquivo. Arraste aqui ou clique em Anexar." : "Armazenamento de arquivos não configurado."}
        </p>
      ) : (
        <AttachmentList files={files} compact canDelete={canDelete} onDelete={handleDelete} />
      )}
    </div>
  );
}
