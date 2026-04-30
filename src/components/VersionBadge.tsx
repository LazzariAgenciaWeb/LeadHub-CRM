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

export default function VersionBadge() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

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
    ? new Date(info.builtAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  // Tooltip com data de build + link pro commit
  const tooltipParts: string[] = [`Versão ${info.version}`];
  if (!isDev) tooltipParts.push(`commit ${info.shortCommit}`);
  if (builtAtStr) tooltipParts.push(`build ${builtAtStr}`);
  const tooltip = tooltipParts.join(" · ");

  const targetUrl = info.commitUrl ?? info.releaseUrl;

  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      className="block text-center text-[9px] text-slate-700 hover:text-slate-500 transition-colors mt-1.5 font-mono leading-tight"
    >
      v{info.version}{!isDev && ` · ${info.shortCommit}`}
    </a>
  );
}
