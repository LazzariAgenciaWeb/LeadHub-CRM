"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, ExternalLink, Check, AlertTriangle, FolderUp } from "lucide-react";

interface Result { file: string; ok: boolean; exists: boolean; reason: string | null; url: string | null }

/**
 * "Enviar arquivos" do cartão cPanel. Sobe pra pasta de publicação (ou uma
 * subpasta dela, criada se não existir). Nunca substitui direto: o que já
 * existe volta marcado e só é trocado se você confirmar.
 */
export default function CompanyCpanelUpload({ companyId, publishDir = "", portal = false }: {
  companyId?: string;
  publishDir?: string;
  /** Meu Espaço do cliente: rota do portal, sem mostrar o caminho no servidor, já aberto. */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(portal);
  const [subPath, setSubPath] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const existing = results?.filter((r) => r.exists) ?? [];

  async function send(list: File[], overwrite: boolean) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      list.forEach((f) => fd.append("files", f));
      fd.append("subPath", subPath);
      if (overwrite) fd.append("overwrite", "1");
      const r = await fetch(portal ? "/api/meu-espaco/upload" : `/api/companies/${companyId}/cpanel/upload`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || "Erro ao enviar."); return; }
      const incoming: Result[] = j.results ?? [];
      // Na 2ª rodada (substituir), mescla com o que já tinha ido na 1ª.
      setResults((prev) => {
        if (!overwrite || !prev) return incoming;
        const byFile = new Map(incoming.map((x) => [x.file, x]));
        return prev.map((p) => byFile.get(p.file) ?? p);
      });
    } catch {
      setError("Erro de rede ao enviar.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFiles([]);
    setResults(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const smallBtn = "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide disabled:opacity-50 transition-colors";
  const inputCls = "w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60";
  const dest = [publishDir, subPath.trim().replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/");

  return (
    <div className={portal
      ? "bg-white/[0.03] border border-white/10 rounded-2xl p-4 space-y-3"
      : "mt-3 ml-9 bg-black/20 border border-white/5 rounded-lg p-3 space-y-3"}>
      <div className="flex items-center gap-2">
        <FolderUp className="w-4 h-4 text-cyan-300" />
        <h4 className="text-white text-xs font-semibold flex-1">Enviar arquivos pro site</h4>
        {!portal && <button onClick={() => { setOpen((o) => !o); reset(); }}
          className={`${smallBtn} bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300`}>
          <Upload className="w-3 h-3" /> {open ? "Fechar" : "Enviar"}
        </button>}
      </div>

      {open && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Subpasta (opcional)</label>
              <input value={subPath} onChange={(e) => setSubPath(e.target.value)} placeholder="lp/black-friday"
                className={`${inputCls} font-mono`} />
              <p className="text-slate-600 text-[10px] mt-1">
                {portal
                  ? <>Vazio = pasta principal do site. Uma subpasta nova é criada se não existir.</>
                  : <>Vai pra <span className="font-mono text-slate-400">{dest}</span>. Criada se não existir.</>}
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Arquivos</label>
              <input ref={inputRef} type="file" multiple
                onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setResults(null); setError(null); }}
                className="block w-full text-[11px] text-slate-400 file:mr-2 file:px-2 file:py-1 file:rounded-lg file:border-0 file:bg-white/10 file:text-slate-200 file:text-[11px]" />
              <p className="text-slate-600 text-[10px] mt-1">HTML, CSS, JS, imagens, fontes, PDF e vídeo · até 50 arquivos / 25 MB. Página principal = <span className="font-mono">index.html</span>.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => send(files, false)} disabled={busy || files.length === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 flex items-center gap-1.5">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />}
              Enviar {files.length > 0 ? `${files.length} arquivo${files.length > 1 ? "s" : ""}` : ""}
            </button>
          </div>

          {error && <p className="p-2 rounded-lg border bg-red-500/10 border-red-500/30 text-red-200 text-[11px]">{error}</p>}

          {results && (
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.file} className="flex items-center gap-2 text-[11px]">
                  {r.ok
                    ? <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    : <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${r.exists ? "text-amber-400" : "text-red-400"}`} />}
                  <span className="font-mono text-slate-200">{r.file}</span>
                  {r.ok && r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200 flex items-center gap-1 truncate">
                      {r.url} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {!r.ok && <span className={r.exists ? "text-amber-300" : "text-red-300"}>{r.exists ? "já existe — não foi trocado" : r.reason}</span>}
                </li>
              ))}
            </ul>
          )}

          {existing.length > 0 && (
            <div className="p-2 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-100 text-[11px] flex items-center gap-2 flex-wrap">
              <span className="flex-1">{existing.length === 1 ? "1 arquivo já existia" : `${existing.length} arquivos já existiam`} nessa pasta. Substituir pelo que você enviou?</span>
              <button disabled={busy}
                onClick={() => send(files.filter((f) => existing.some((x) => x.file === f.name)), true)}
                className={`${smallBtn} bg-amber-500/20 hover:bg-amber-500/30 text-amber-100`}>
                Substituir
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
