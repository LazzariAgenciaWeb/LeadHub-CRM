"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeType } from "@/generated/prisma";
import { BADGE_META, BADGE_TIERS, ICON_GLOW, ALL_BADGES, TIER_HEX } from "@/app/(admin)/gamificacao/labels";

type UserAchievement = {
  userId:       string;
  name:         string;
  totalPoints:  number;
  monthPoints:  number;
  badges:       { badge: BadgeType; tier: number; earnedAt: string }[];
};

type ApiResponse = {
  users: UserAchievement[];
  month: number;
  year:  number;
};

export default function CompanyAchievements({ companyId }: { companyId: string }) {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/companies/${companyId}/achievements`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `Erro ${r.status}`);
        }
        return r.json();
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 text-sm">Carregando conquistas...</div>;
  }
  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    );
  }
  if (!data || data.users.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="text-3xl mb-2">🏆</div>
        <div className="text-slate-500 text-sm">Nenhum usuário com pontuação ainda.</div>
      </div>
    );
  }

  const monthLabel = new Date(data.year, data.month - 1, 1)
    .toLocaleString("pt-BR", { month: "long", year: "numeric" });

  // Ordena por monthPoints desc
  const ranked = [...data.users].sort((a, b) => b.monthPoints - a.monthPoints);

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-white font-bold text-sm">🏆 Conquistas dos Usuários</h2>
          <p className="text-slate-500 text-[11px] capitalize mt-0.5">{monthLabel}</p>
        </div>
        <Link
          href={`/api/admin/impersonate/${companyId}?returnTo=/gamificacao`}
          className="text-indigo-400 text-xs font-medium hover:underline"
        >
          Abrir painel completo →
        </Link>
      </div>

      <div className="space-y-3">
        {ranked.map((u, idx) => {
          const podium = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
          return (
            <div key={u.userId} className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {podium && <span className="text-lg">{podium}</span>}
                  <span className="text-slate-500 text-xs font-mono">#{idx + 1}</span>
                  <span className="text-white text-sm font-semibold">{u.name}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-500">
                    Mês: <span className="text-indigo-300 font-semibold">{u.monthPoints} pts</span>
                  </span>
                  <span className="text-slate-500">
                    Total: <span className="text-white font-semibold">{u.totalPoints}</span>
                  </span>
                  <span className="text-slate-500">
                    Badges: <span className="text-fuchsia-300 font-semibold">{u.badges.length}</span>
                  </span>
                </div>
              </div>

              {u.badges.length === 0 ? (
                <div className="text-slate-600 text-[11px] italic">Nenhuma conquista ainda</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ALL_BADGES.map((b) => {
                    // Pega tier mais alto conquistado pelo usuário
                    const earned = u.badges
                      .filter((x) => x.badge === b)
                      .sort((a, b) => b.tier - a.tier)[0];
                    if (!earned) return null;
                    const meta = BADGE_META[b];
                    const tierName = BADGE_TIERS[b][earned.tier - 1]?.name ?? "";
                    const glow = ICON_GLOW[earned.tier];
                    const hex = TIER_HEX[earned.tier];
                    return (
                      <div
                        key={b}
                        title={`${meta.name} — ${tierName} (Tier ${earned.tier})\n${meta.description}`}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${glow}`}
                      >
                        <span className="text-base leading-none">{meta.emoji}</span>
                        <div className="flex flex-col leading-none">
                          <span className="text-[10px] text-white font-semibold">{meta.name}</span>
                          <span className="text-[9px]" style={{ color: hex }}>
                            T{earned.tier} · {tierName}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
