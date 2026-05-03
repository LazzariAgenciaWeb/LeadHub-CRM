"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { BADGE_META, BADGE_TIERS, TIER_HEX } from "@/app/(admin)/gamificacao/labels";
import { BadgeType } from "@/generated/prisma";

type Badge = {
  id:       string;
  badge:    BadgeType;
  tier:     number;
  earnedAt: string;
};

/**
 * Polling silencioso a cada 30s. Quando detecta badges novos via
 * /api/gamificacao/recent-badges, mostra toast no canto inferior direito.
 * Auto-dismisses após 6s.
 */
export default function BadgeToastNotifier() {
  const [toasts, setToasts] = useState<Badge[]>([]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval>;

    async function check() {
      try {
        const res = await fetch("/api/gamificacao/recent-badges", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!active || !data.badges?.length) return;
        setToasts((prev) => [...data.badges, ...prev]);
        // auto-dismiss cada um
        for (const b of data.badges) {
          setTimeout(() => {
            if (active) setToasts((prev) => prev.filter((x) => x.id !== b.id));
          }, 6000);
        }
      } catch { /* ignore */ }
    }

    // Primeira verificação após 5s, depois a cada 30s
    const initialTimer = setTimeout(() => { check(); timer = setInterval(check, 30_000); }, 5000);
    return () => { active = false; clearTimeout(initialTimer); if (timer) clearInterval(timer); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((b) => {
        const meta  = BADGE_META[b.badge];
        const tier  = BADGE_TIERS[b.badge].find((t) => t.level === b.tier);
        const color = TIER_HEX[b.tier];
        return (
          <div
            key={b.id}
            className="pointer-events-auto bg-[#0a0f1a] border-2 rounded-xl p-3 shadow-2xl flex items-center gap-3 min-w-[280px] animate-[slide-in_0.3s_ease-out]"
            style={{ borderColor: color }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: `${color}33`, boxShadow: `0 0 20px ${color}66` }}
            >
              {meta.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-fuchsia-300 font-bold">
                🎉 Você desbloqueou!
              </div>
              <div className="text-white text-sm font-semibold">
                {meta.name} · N{b.tier}
              </div>
              <div className="text-xs" style={{ color }}>
                {tier?.name ?? ""}
              </div>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== b.id))}
              className="text-slate-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      <style jsx>{`
        @keyframes slide-in {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </div>
  );
}
