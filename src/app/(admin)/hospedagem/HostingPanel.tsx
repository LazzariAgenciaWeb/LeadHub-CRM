"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Server, Mail, HardDrive, AlertTriangle, Loader2, ChevronDown, ChevronRight, Settings, ExternalLink, RefreshCw, Users,
} from "lucide-react";
import CompanyCpanelEmail from "../empresas/[id]/CompanyCpanelEmail";
import CompanyCpanelUpload from "../empresas/[id]/CompanyCpanelUpload";

export interface HostingRow {
  companyId: string;
  name: string;
  isOwn: boolean;
  host: string;
  username: string;
  siteUrl: string | null;
  publishDir: string;
  status: "ACTIVE" | "EXPIRED" | "ERROR" | "DISCONNECTED";
  lastTestedAt: string | null;
  lastError: string | null;
  clientPortal: boolean;
}

interface Mailbox { email: string; usedMb: number; quotaMb: number | null; suspended: boolean }
interface Overview {
  usage: { usedMb: number; limitMb: number | null };
  mailboxes: Mailbox[];
  plan?: { packageName: string | null; mailboxCount: number | null; mailboxMax: number | null };
  space?: { emailMb: number; filesMb: number; dbMb: number };
}
type Live = { state: "loading" } | { state: "ok"; data: Overview } | { state: "error"; error: string };

const CONCURRENCY = 4;
const ALERT_PCT = 90;

function fmtSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  return `${mb.toLocaleString("pt-BR", { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

function pctOf(o: Overview): number | null {
  return o.usage.limitMb ? Math.round((o.usage.usedMb / o.usage.limitMb) * 100) : null;
}

/** Caixas no limite da cota ou suspensas: o que costuma virar chamado. */
function mailboxAlerts(o: Overview): number {
  return o.mailboxes.filter((m) => m.suspended || (m.quotaMb && m.usedMb / m.quotaMb >= ALERT_PCT / 100)).length;
}

async function fetchOverview(companyId: string): Promise<Live> {
  try {
    const r = await fetch(`/api/companies/${companyId}/cpanel/email`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { state: "error", error: j.error || "Erro ao consultar o cPanel." };
    return { state: "ok", data: j };
  } catch {
    return { state: "error", error: "Erro de rede." };
  }
}

export default function HostingPanel({ rows, withoutCpanel }: {
  rows: HostingRow[];
  withoutCpanel: { id: string; name: string }[];
}) {
  const [live, setLive] = useState<Record<string, Live>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  // Consulta ao vivo cada conta ativa, poucas por vez pra não segurar a tela.
  useEffect(() => {
    let cancelled = false;
    const queue = rows.filter((r) => r.status === "ACTIVE").map((r) => r.companyId);
    const t = setTimeout(() => {
      setLive(Object.fromEntries(queue.map((id) => [id, { state: "loading" } as Live])));
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          const res = await fetchOverview(id);
          if (cancelled) return;
          setLive((prev) => ({ ...prev, [id]: res }));
        }
      };
      void Promise.all(Array.from({ length: CONCURRENCY }, worker));
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [rows, round]);

  const loaded = Object.values(live).filter((l): l is Extract<Live, { state: "ok" }> => l.state === "ok");
  const totalMailboxes = loaded.reduce((n, l) => n + l.data.mailboxes.length, 0);
  const attention = rows.filter((r) => {
    const l = live[r.companyId];
    if (r.status !== "ACTIVE" || l?.state === "error") return true;
    if (l?.state !== "ok") return false;
    const pct = pctOf(l.data);
    return (pct !== null && pct >= ALERT_PCT) || mailboxAlerts(l.data) > 0;
  }).length;
  const anyLoading = Object.values(live).some((l) => l.state === "loading");

  const card = "bg-white/[0.03] border border-white/10 rounded-2xl";

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`${card} p-4 flex items-center gap-3`}>
          <Server className="w-5 h-5 text-cyan-300" />
          <div><p className="text-white text-lg font-bold">{rows.length}</p><p className="text-slate-400 text-xs">contas cPanel ligadas</p></div>
        </div>
        <div className={`${card} p-4 flex items-center gap-3`}>
          <Mail className="w-5 h-5 text-indigo-300" />
          <div>
            <p className="text-white text-lg font-bold">{anyLoading && totalMailboxes === 0 ? "…" : totalMailboxes}</p>
            <p className="text-slate-400 text-xs">caixas de e-mail</p>
          </div>
        </div>
        <div className={`${card} p-4 flex items-center gap-3`}>
          <AlertTriangle className={`w-5 h-5 ${attention > 0 ? "text-amber-400" : "text-emerald-400"}`} />
          <div><p className="text-white text-lg font-bold">{attention}</p><p className="text-slate-400 text-xs">precisam de atenção</p></div>
        </div>
      </div>

      {/* Contas */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
          <h2 className="text-white text-sm font-semibold flex-1">Contas</h2>
          <button onClick={() => setRound((n) => n + 1)} disabled={anyLoading}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 disabled:opacity-50">
            {anyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Atualizar
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="p-4 text-slate-400 text-sm">
            Nenhuma conta cPanel ligada ainda. Ligue a sua em{" "}
            <Link href="/configuracoes?secao=integracoes-cpanel" className="text-indigo-300 hover:underline">Configurações → Integrações</Link>{" "}
            ou a de um cliente na aba Hospedagem do cadastro dele.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.map((r) => {
              const l = live[r.companyId];
              const pct = l?.state === "ok" ? pctOf(l.data) : null;
              const mbAlerts = l?.state === "ok" ? mailboxAlerts(l.data) : 0;
              const isOpen = open === r.companyId;
              const configHref = r.isOwn ? "/configuracoes?secao=integracoes-cpanel" : `/empresas/${r.companyId}#hospedagem`;
              const barColor = pct === null ? "" : pct >= ALERT_PCT ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <li key={r.companyId}>
                  <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <button onClick={() => setOpen(isOpen ? null : r.companyId)} disabled={r.status !== "ACTIVE"}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left disabled:cursor-default">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-white text-sm font-semibold truncate">
                          {r.name}
                          {r.isOwn && <span className="ml-2 text-[10px] text-cyan-300 bg-cyan-500/15 px-1.5 py-0.5 rounded-full font-bold">SUA EMPRESA</span>}
                          {r.clientPortal && <span className="ml-2 text-[10px] text-indigo-300 bg-indigo-500/15 px-1.5 py-0.5 rounded-full font-bold inline-flex items-center gap-1"><Users className="w-2.5 h-2.5" />CLIENTE GERENCIA</span>}
                        </p>
                        <p className="text-slate-500 text-[11px] font-mono truncate">{r.username}@{r.host}</p>
                      </div>
                    </button>

                    {/* Espaço */}
                    <div className="w-56 space-y-1">
                      {r.status !== "ACTIVE" ? (
                        <p className="text-amber-300 text-[11px] flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {r.lastError || "Conexão com problema — teste de novo"}</p>
                      ) : !l || l.state === "loading" ? (
                        <p className="text-slate-500 text-[11px] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> consultando…</p>
                      ) : l.state === "error" ? (
                        <p className="text-red-300 text-[11px] flex items-center gap-1" title={l.error}><AlertTriangle className="w-3 h-3" /> {l.error}</p>
                      ) : (
                        <>
                          <p className="text-[11px] flex items-center gap-1">
                            <HardDrive className="w-3 h-3 text-slate-400" />
                            <span className="text-white font-semibold">{fmtSize(l.data.usage.usedMb)}</span>
                            <span className="text-slate-500">{l.data.usage.limitMb ? `de ${fmtSize(l.data.usage.limitMb)} · ${pct}%` : "· sem limite"}</span>
                          </p>
                          {pct !== null && (l.data.space && l.data.usage.limitMb ? (
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex" title="E-mails · site e arquivos · bancos">
                              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (l.data.space.emailMb / l.data.usage.limitMb) * 100)}%` }} />
                              <div className="h-full bg-cyan-400" style={{ width: `${Math.min(100, (l.data.space.filesMb / l.data.usage.limitMb) * 100)}%` }} />
                              <div className="h-full bg-violet-400" style={{ width: `${Math.min(100, (l.data.space.dbMb / l.data.usage.limitMb) * 100)}%` }} />
                            </div>
                          ) : (
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                          ))}
                          {l.data.space && (
                            <p className="text-[10px] text-slate-400 flex flex-wrap gap-x-2">
                              <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 mr-1" />E-mails {fmtSize(l.data.space.emailMb)}</span>
                              <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 mr-1" />Arquivos {fmtSize(l.data.space.filesMb)}</span>
                              {l.data.space.dbMb > 0 && <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 mr-1" />Bancos {fmtSize(l.data.space.dbMb)}</span>}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* E-mails */}
                    <div className="w-36 text-[11px]">
                      {l?.state === "ok" && (
                        <>
                          <p className="text-slate-300 flex items-center gap-1"><Mail className="w-3 h-3 text-slate-400" /> {l.data.mailboxes.length}{l.data.plan?.mailboxMax ? ` de ${l.data.plan.mailboxMax}` : ""} caixa{l.data.mailboxes.length === 1 && !l.data.plan?.mailboxMax ? "" : "s"}</p>
                          {l.data.plan?.packageName && <p className="text-slate-500 truncate" title="Plano no cPanel">{l.data.plan.packageName}</p>}
                          {mbAlerts > 0 && <p className="text-amber-300">{mbAlerts} cheia{mbAlerts === 1 ? "" : "s"} ou suspensa{mbAlerts === 1 ? "" : "s"}</p>}
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {r.siteUrl && (
                        <a href={r.siteUrl} target="_blank" rel="noopener noreferrer" title="Abrir o site"
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300"><ExternalLink className="w-3.5 h-3.5" /></a>
                      )}
                      <Link href={configHref} title="Configuração da conta"
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300"><Settings className="w-3.5 h-3.5" /></Link>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="pb-4 pr-4 -mt-2">
                      <CompanyCpanelEmail companyId={r.companyId} autoLoad />
                      <CompanyCpanelUpload companyId={r.companyId} publishDir={r.publishDir} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {withoutCpanel.length > 0 && (
        <details className={`${card} p-4`}>
          <summary className="text-slate-300 text-sm cursor-pointer">{withoutCpanel.length} cliente{withoutCpanel.length === 1 ? "" : "s"} sem cPanel ligado</summary>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {withoutCpanel.map((c) => (
              <li key={c.id}>
                <Link href={`/empresas/${c.id}#hospedagem`} className="text-indigo-300 hover:text-indigo-200 text-xs hover:underline">{c.name}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
