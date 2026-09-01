"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, AlertTriangle, Trash2 } from "lucide-react";

/**
 * Card da conexão Google Agenda dentro de Configurações → Integrações → Google.
 *
 * Diferente dos outros cards desta tela, esta conexão é PESSOAL
 * (UserGoogleConnection service="calendar"), não da empresa: cada atendente liga
 * a própria agenda e só ele mesmo reconecta. Antes só existia em /calendario, e
 * quem chegava aqui procurando "reconectar a agenda" não achava.
 */

interface Status {
  connected: boolean;
  canWrite?: boolean;
  googleEmail?: string | null;
  googleName?: string | null;
  status?: string;
  lastError?: string | null;
}

export default function CalendarConnectionCard({ returnTo }: { returnTo: string }) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/calendar/google/status")
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((j) => { if (alive) setSt(j); })
      .catch(() => { if (alive) setSt({ connected: false }); });
    return () => { alive = false; };
  }, []);

  async function disconnect() {
    if (!confirm("Desconectar sua agenda do Google? Os eventos deixam de aparecer no Calendário e o agente volta a usar só o link de agendamento.")) return;
    setBusy(true);
    try {
      await fetch("/api/calendar/google/disconnect", { method: "DELETE" });
      setSt({ connected: false });
    } finally {
      setBusy(false);
    }
  }

  const connectUrl = `/api/calendar/google/connect?returnTo=${encodeURIComponent(returnTo)}`;
  const connected = !!st?.connected;
  const active = connected && (st?.status ?? "ACTIVE") === "ACTIVE";
  const needsScope = active && st?.canWrite === false;

  return (
    <div className="px-5 pb-5">
      <div className="flex items-baseline gap-2 flex-wrap mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-sky-300">Google · Agenda</h3>
        <span className="text-slate-600 text-[11px]">
          Conexão pessoal — vale pra você, não pra empresa selecionada acima.
        </span>
      </div>

      <div className="rounded-xl border bg-sky-500/10 border-sky-500/30 p-4">
        <div className="flex items-start gap-3">
          <CalendarDays className="w-6 h-6 text-sky-300 flex-shrink-0 mt-0.5" strokeWidth={2} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-white font-semibold text-sm">Google Agenda</h3>
              {active && !needsScope && (
                <span className="text-[10px] text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <Check className="w-2.5 h-2.5" /> CONECTADO
                </span>
              )}
              {needsScope && (
                <span className="text-[10px] text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded-full font-bold">
                  RECONECTAR
                </span>
              )}
            </div>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Seus compromissos no Meu Dia e agendamento direto do agente de IA (cria o evento com Google Meet).
            </p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            {st === null ? (
              <span className="text-slate-600 text-[11px]">carregando…</span>
            ) : (
              <a
                href={connectUrl}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  connected
                    ? "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40"
                }`}
                title={connected ? "Renova a autorização da sua agenda com o Google." : undefined}
              >
                {connected ? "Reconectar" : "Conectar"}
              </a>
            )}
          </div>
        </div>

        {connected && (
          <div className="mt-3 pl-9">
            <div className="bg-black/20 border border-white/5 rounded-lg p-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold ${active ? "text-emerald-400" : "text-amber-400"}`}>
                    ● {active ? "Conectado" : (st?.status ?? "Erro")}
                  </span>
                  {(st?.googleEmail || st?.googleName) && (
                    <span className="text-slate-500 truncate">· {st?.googleEmail || st?.googleName}</span>
                  )}
                </div>
                {needsScope && (
                  <p className="text-amber-400 text-[11px] mt-0.5 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    Conectada antes da permissão de criar eventos — reconecte pra liberar o agendamento direto.
                  </p>
                )}
                {st?.lastError && (
                  <p className="text-red-400 text-[10px] mt-0.5 truncate" title={st.lastError}>{st.lastError}</p>
                )}
              </div>
              <button
                onClick={disconnect}
                disabled={busy}
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                title="Desconectar"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
