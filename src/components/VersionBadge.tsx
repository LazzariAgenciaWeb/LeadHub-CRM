"use client";

import { useEffect, useState } from "react";

interface VersionInfo {
  version: string;
  shortCommit: string;
  commit: string;
  builtAt: string | null;
  commitUrl: string | null;
  releaseUrl: string;
  repoUrl: string;
}

/**
 * Rodapé da sidebar: versão + commit + hora do build, legível de relance.
 * Clique copia o commit (prático pra conferir se o deploy subiu); o ícone ↗
 * abre o commit no GitHub.
 */
export default function VersionBadge() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/version")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled && d) setInfo(d); })
      .catch(() => { /* silencioso */ });
    return () => { cancelled = true; };
  }, []);

  if (!info) return null;

  const isDev = info.commit === "dev";
  const builtAtStr = info.builtAt
    ? new Date(info.builtAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  const targetUrl = info.commitUrl ?? info.releaseUrl;

  function copy() {
    navigator.clipboard?.writeText(isDev ? info!.version : info!.shortCommit).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mt-2 flex items-center justify-center gap-1.5 font-mono text-[11px] leading-tight text-slate-400">
      <button
        type="button"
        onClick={copy}
        title={`Versão ${info.version}${!isDev ? ` · commit ${info.shortCommit}` : ""}${builtAtStr ? ` · build ${builtAtStr}` : ""} — clique pra copiar`}
        className="px-2 py-1 rounded-md bg-[#0f1623] border border-[#1e2d45] hover:border-[#2d4060] hover:text-slate-200 transition-colors"
      >
        {copied ? "copiado ✓" : (
          <>
            <span className="text-slate-300">v{info.version}</span>
            {!isDev && <span className="text-fuchsia-300/90"> · {info.shortCommit}</span>}
            {builtAtStr && <span className="text-slate-500"> · {builtAtStr}</span>}
          </>
        )}
      </button>
      {!isDev && (
        <a href={targetUrl} target="_blank" rel="noopener noreferrer" title="Abrir commit no GitHub" className="text-slate-500 hover:text-slate-300 transition-colors">↗</a>
      )}
    </div>
  );
}
