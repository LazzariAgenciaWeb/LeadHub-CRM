"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stats {
  open: number;
  pending: number;
  inProgress: number;
  waitingCustomer: number;
  closed: number;
  closedLast24h: number;
  avgResponseMin: number | null;
  sampleSize: number;
}

function formatMinutes(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export default function AtendimentoStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/atendimento")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 animate-pulse">
        <div className="h-4 w-40 bg-[#1e2d45] rounded mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-[#1e2d45] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const cards = [
    { label: "🔴 Sem atendimento", value: stats.pending,         color: "text-red-300",      bg: "bg-red-500/10 border-red-500/20", urgent: stats.pending > 0 },
    { label: "🆕 Aguardando",      value: stats.open,            color: "text-cyan-300",     bg: "bg-cyan-500/10 border-cyan-500/20", urgent: false },
    { label: "🟡 Em atendimento",  value: stats.inProgress,      color: "text-yellow-300",   bg: "bg-yellow-500/10 border-yellow-500/20", urgent: false },
    { label: "✅ Finalizadas (24h)", value: stats.closedLast24h, color: "text-slate-300",    bg: "bg-slate-500/10 border-slate-500/20", urgent: false },
  ];

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          ⏱️ Atendimento WhatsApp
        </h3>
        <Link href="/whatsapp" className="text-indigo-400 hover:text-indigo-300 text-xs font-medium">
          Abrir inbox →
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-lg border p-3 ${c.bg} ${c.urgent ? "ring-1 ring-red-400/40" : ""}`}
          >
            <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">{c.label}</div>
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-[#1e2d45] flex items-center justify-between text-xs">
        <div className="text-slate-400">
          Tempo médio de 1ª resposta:{" "}
          <span className="text-white font-semibold">{formatMinutes(stats.avgResponseMin)}</span>
          <span className="text-slate-600 ml-1">(últimos 30d, {stats.sampleSize} conversas)</span>
        </div>
        {stats.waitingCustomer > 0 && (
          <span className="text-blue-400">
            🔵 {stats.waitingCustomer} aguardando cliente
          </span>
        )}
      </div>
    </div>
  );
}
