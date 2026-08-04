"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, LogIn, LogOut, Coffee } from "lucide-react";
import { PUNCH_LABEL, formatMin, type PunchTypeStr } from "@/lib/ponto-shared";

type TodayState = {
  punches: { id: string; type: PunchTypeStr; time: string }[];
  allowedNext: PunchTypeStr[];
  workedMin: number;
  clockOpen: boolean;
  schedule: { startTime: string; endTime: string } | null;
};

const ICON: Record<PunchTypeStr, typeof LogIn> = {
  ENTRADA: LogIn,
  INTERVALO_INICIO: Coffee,
  INTERVALO_FIM: Coffee,
  SAIDA: LogOut,
};

// Widget compacto de bater ponto no painel de entrada. Some silenciosamente
// se a API não responder (ex: usuário sem empresa).
export default function PontoWidget() {
  const [today, setToday] = useState<TodayState | null>(null);
  const [punching, setPunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ponto/today");
      if (res.ok) setToday(await res.json());
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function punch(type: PunchTypeStr) {
    if (punching) return;
    setPunching(true);
    setError(null);
    try {
      const res = await fetch("/api/ponto/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao bater o ponto");
      }
      await load();
    } finally {
      setPunching(false);
    }
  }

  if (!today) return null;

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
      <Link href="/ponto" className="flex items-center gap-3 group">
        <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
          <Clock className="w-4.5 h-4.5 text-indigo-400" />
        </div>
        <div>
          <div className="text-white text-sm font-semibold group-hover:text-indigo-300 transition-colors">
            Ponto
            {today.clockOpen && <span className="text-green-400 text-[10px] ml-2">● em jornada</span>}
          </div>
          <div className="text-slate-500 text-xs">
            {today.punches.length > 0
              ? <>Hoje: {today.punches.map((p) => p.time).join(" · ")} — <b className="text-slate-300">{formatMin(today.workedMin)}</b></>
              : today.schedule
                ? `Jornada de hoje: ${today.schedule.startTime}–${today.schedule.endTime}`
                : "Nenhuma marcação hoje"}
          </div>
        </div>
      </Link>

      <div className="flex items-center gap-2">
        {error && <span className="text-red-400 text-[10px] max-w-[180px]">{error}</span>}
        {today.allowedNext.map((t) => {
          const Icon = ICON[t];
          const primary = t === "ENTRADA" || t === "SAIDA";
          return (
            <button
              key={t}
              onClick={() => punch(t)}
              disabled={punching}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                primary
                  ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90"
                  : "bg-[#1e2d45] text-slate-200 hover:bg-[#27395a]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {PUNCH_LABEL[t]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
