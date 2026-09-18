"use client";

import { type StoredFile, formatBytes, fileIcon } from "./upload";

// Lista de arquivos do MinIO. Imagem vira miniatura; o resto, linha com ícone.
// Abrir/baixar passa por /api/storage/[id] (checa acesso e redireciona pra URL
// assinada) — nunca expor a chave do bucket no front.
export default function AttachmentList({
  files,
  compact = false,
  canDelete,
  onDelete,
}: {
  files: StoredFile[];
  compact?: boolean;
  canDelete?: (f: StoredFile) => boolean;
  onDelete?: (f: StoredFile) => void;
}) {
  if (!files.length) return null;
  const images = files.filter((f) => /^image\/(png|jpe?g|gif|webp|avif)$/i.test(f.mimeType));
  const others = files.filter((f) => !images.includes(f));

  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((f) => (
            <div key={f.id} className="relative group">
              <a href={`/api/storage/${f.id}`} target="_blank" rel="noopener noreferrer" title={f.fileName}>
                <img
                  src={`/api/storage/${f.id}`}
                  alt={f.fileName}
                  loading="lazy"
                  className={`${compact ? "w-16 h-16" : "w-20 h-20"} object-cover rounded-lg border border-[#1e2d45] hover:opacity-90 transition`}
                />
              </a>
              {onDelete && canDelete?.(f) && (
                <button
                  type="button"
                  onClick={() => onDelete(f)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#0a0f1a] border border-[#1e2d45] text-slate-400 hover:text-red-400 text-xs leading-none opacity-0 group-hover:opacity-100 transition"
                  title="Excluir"
                >×</button>
              )}
            </div>
          ))}
        </div>
      )}
      {others.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-2 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 group"
        >
          <span className="text-sm flex-shrink-0">{fileIcon(f.mimeType, f.fileName)}</span>
          <a
            href={`/api/storage/${f.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-w-0 text-xs text-slate-200 hover:text-indigo-300 truncate"
            title={f.fileName}
          >
            {f.fileName}
          </a>
          <span className="text-[10px] text-slate-600 flex-shrink-0">{formatBytes(f.size)}</span>
          <a
            href={`/api/storage/${f.id}?download=1`}
            className="text-slate-500 hover:text-indigo-300 text-xs flex-shrink-0"
            title="Baixar"
          >⬇</a>
          {onDelete && canDelete?.(f) && (
            <button
              type="button"
              onClick={() => onDelete(f)}
              className="text-slate-600 hover:text-red-400 text-sm leading-none flex-shrink-0 opacity-0 group-hover:opacity-100 transition"
              title="Excluir"
            >×</button>
          )}
        </div>
      ))}
    </div>
  );
}
