"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface UnansweredConv {
  phone: string;
  companyId: string;
  companyName: string | null;
  leadName: string | null;
  leadId: string | null;
  pipeline: string | null;
  pipelineStage: string | null;
  attendanceStatus: string | null;
  lastMsgBody: string;
  lastMsgAt: string; // ISO string
  instanceName: string | null;
}

const PIPELINE_LABEL: Record<string, string> = {
  PROSPECCAO: "🔎 Prospecção",
  LEADS: "💬 Lead",
  OPORTUNIDADES: "💰 Oportunidade",
};
const PIPELINE_COLOR: Record<string, string> = {
  PROSPECCAO: "text-violet-400 bg-violet-500/10",
  LEADS: "text-blue-400 bg-blue-500/10",
  OPORTUNIDADES: "text-amber-400 bg-amber-500/10",
};
const ATTENDANCE_LABEL: Record<string, string> = {
  WAITING: "⏳ Aguardando",
  IN_PROGRESS: "💬 Em Atendimento",
  RESOLVED: "✅ Resolvido",
  SCHEDULED: "📅 Agendado",
};

function useTimer(isoDate: string) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [isoDate]);
  return elapsed;
}

function ElapsedBadge({ isoDate }: { isoDate: string }) {
  const secs = useTimer(isoDate);
  const mins = Math.floor(secs / 60);
  const urgent = mins >= 20;
  const warning = mins >= 5 && !urgent;

  const label = mins < 1
    ? `${secs}s`
    : mins < 60
    ? `${mins}min`
    : `${Math.floor(mins / 60)}h${mins % 60 ? String(mins % 60).padStart(2, "0") + "min" : ""}`;

  return (
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
      urgent  ? "bg-red-500/20 text-red-400 animate-pulse" :
      warning ? "bg-yellow-500/20 text-yellow-400" :
                "bg-slate-500/10 text-slate-400"
    }`}>
      {urgent ? "🔴" : warning ? "🟡" : "🟢"} {label}
    </span>
  );
}

export default function UnansweredWidget({ convs }: { convs: UnansweredConv[] }) {
  if (convs.length === 0) return null;

  return (
    <div className="bg-[#0c1220] border border-red-500/20 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-red-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🔔</span>
          <div>
            <h2 className="text-white font-bold text-sm">Aguardando Resposta</h2>
            <p className="text-slate-500 text-xs mt-0.5">{convs.length} conversa{convs.length !== 1 ? "s" : ""} sem retorno</p>
          </div>
        </div>
        <Link
          href="/whatsapp"
          className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline flex-shrink-0"
        >
          Ver todas →
        </Link>
      </div>

      {/* Lista */}
      <div className="divide-y divide-[#1e2d45]/50">
        {convs.map((c) => (
          <Link
            key={c.phone + c.companyId}
            href={`/whatsapp?abrir=${encodeURIComponent(c.phone)}`}
            className="flex items-start gap-3 px-5 py-3.5 hover:bg-white/[0.02] transition-colors group"
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0 mt-0.5">
              <div className="w-9 h-9 rounded-full bg-[#1e2d45] flex items-center justify-center text-xs font-bold text-slate-400">
                {c.phone.slice(-2)}
              </div>
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-[#0c1220] animate-pulse" />
            </div>

            {/* Conteúdo */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white text-[13px] font-semibold truncate">
                  {c.leadName ?? c.phone}
                </span>
                <ElapsedBadge isoDate={c.lastMsgAt} />
              </div>

              {c.leadName && (
                <div className="text-slate-600 text-[10px]">{c.phone}</div>
              )}

              <div className="text-slate-500 text-[11px] truncate mt-0.5">
                {c.lastMsgBody}
              </div>

              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {c.pipeline && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PIPELINE_COLOR[c.pipeline] ?? "text-slate-400 bg-white/5"}`}>
                    {PIPELINE_LABEL[c.pipeline] ?? c.pipeline}
                    {c.pipelineStage ? ` · ${c.pipelineStage}` : ""}
                  </span>
                )}
                {c.attendanceStatus && c.attendanceStatus !== "WAITING" && (
                  <span className="text-[10px] text-slate-500">
                    {ATTENDANCE_LABEL[c.attendanceStatus] ?? c.attendanceStatus}
                  </span>
                )}
                {c.instanceName && (
                  <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded-full">
                    {c.instanceName}
                  </span>
                )}
              </div>
            </div>

            {/* Botão responder */}
            <div className="flex-shrink-0 self-center">
              <span className="text-indigo-400 text-[11px] font-medium group-hover:text-indigo-300 transition-colors">
                Responder →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
