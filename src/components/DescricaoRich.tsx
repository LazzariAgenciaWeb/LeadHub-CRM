"use client";

import { useRef, useState } from "react";

/**
 * Descritivo de tarefa com imagens/prints INLINE de forma SEGURA.
 *
 * A descrição é guardada como TEXTO PURO, com imagens referenciadas por um token
 * `[[img:<materialId>]]`. Nada de HTML arbitrário → zero XSS no painel do cliente
 * (que é público). O binário da imagem mora em ProjectMaterial.mediaBase64 e é
 * servido por /materiais/[id]/media (nunca carregado inline nas listas).
 */

const TOKEN_RE = /\[\[img:([a-zA-Z0-9_-]+)\]\]/g;

/** true se o texto tem pelo menos um print embutido. */
export function hasInlineImages(text: string | null | undefined): boolean {
  return !!text && /\[\[img:[a-zA-Z0-9_-]+\]\]/.test(text);
}

/** Renderiza o descritivo: segmentos de texto + imagens (do endpoint de mídia). */
export function DescricaoView({
  text,
  mediaUrl,
  className = "text-sm text-slate-200 leading-relaxed",
}: {
  text: string | null | undefined;
  mediaUrl: (materialId: string) => string;
  className?: string;
}) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++} className="whitespace-pre-wrap">{text.slice(last, m.index)}</span>);
    }
    // eslint-disable-next-line @next/next/no-img-element
    parts.push(
      <img
        key={key++}
        src={mediaUrl(m[1])}
        alt="print"
        loading="lazy"
        className="my-2 block max-w-full rounded-lg border border-[#1e2d45]"
      />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(<span key={key++} className="whitespace-pre-wrap">{text.slice(last)}</span>);
  }
  return <div className={className}>{parts}</div>;
}

/**
 * Editor do descritivo: textarea comum + colar/anexar imagem. Ao colar (Ctrl+V)
 * ou escolher um arquivo, faz upload via `onUpload` e insere o token no cursor.
 * Mostra uma prévia (como o cliente vê) abaixo quando há imagens.
 */
export function DescricaoEditor({
  value,
  onChange,
  onUpload,
  mediaUrl,
  placeholder,
  className,
  rows = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Faz upload da imagem e devolve o materialId (ou null em falha). */
  onUpload: (file: File) => Promise<string | null>;
  mediaUrl: (materialId: string) => string;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");

  async function insertImage(file: File) {
    if (!file.type.startsWith("image/")) { setErr("Só imagens."); return; }
    setErr("");
    setUploading(true);
    const id = await onUpload(file);
    setUploading(false);
    if (!id) { setErr("Falha ao enviar a imagem."); return; }
    const token = `[[img:${id}]]`;
    const ta = ref.current;
    const pos = ta ? ta.selectionStart : value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const sepBefore = before && !before.endsWith("\n") ? "\n" : "";
    const sepAfter = after && !after.startsWith("\n") ? "\n" : "";
    onChange(`${before}${sepBefore}${token}${sepAfter}${after}`);
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    if (!item) return; // deixa o paste de texto normal seguir
    e.preventDefault();
    const file = item.getAsFile();
    if (file) await insertImage(file);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) await insertImage(f);
    e.target.value = "";
  }

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        rows={rows}
        placeholder={placeholder}
        className={className}
      />
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <label className="text-[11px] text-indigo-300 hover:underline cursor-pointer">
          <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
          + Adicionar print
        </label>
        <span className="text-[10px] text-slate-600">ou cole a imagem (Ctrl+V) direto aqui</span>
        {uploading && <span className="text-[10px] text-amber-400">enviando…</span>}
        {err && <span className="text-[10px] text-red-400">{err}</span>}
      </div>
      {hasInlineImages(value) && (
        <div className="mt-2 p-3 rounded-lg border border-[#1e2d45] bg-[#0a0f1a]">
          <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Prévia (como o cliente vê)</p>
          <DescricaoView text={value} mediaUrl={mediaUrl} />
        </div>
      )}
    </div>
  );
}
