"use client";

import { useEffect, useState } from "react";
import { BadgeType } from "@/generated/prisma";
import Leaderboard from "./Leaderboard";

type RankingEntry = {
  userId:          string;
  name:            string;
  rankingCategory: "PRODUCAO" | "GESTAO";
  monthPoints:     number;
  totalPoints:     number;
  position:        number;
  badges:          { badge: BadgeType; tier: number }[];
};

type Props = {
  initialRanking: RankingEntry[];
  currentUserId:  string;
};

/**
 * Wrapper "ao vivo" do Leaderboard. Faz polling de /api/gamificacao/ranking
 * a cada 30s e quando a aba ganha foco. Renderiza o Leaderboard server-side
 * com dados frescos sem F5.
 */
export default function LiveLeaderboard({ initialRanking, currentUserId }: Props) {
  const [ranking, setRanking] = useState<RankingEntry[]>(initialRanking);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch("/api/gamificacao/ranking", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setRanking(data.ranking ?? []);
        setUpdatedAt(Date.now());
      } catch {/* silent */}
    }
    const iv = setInterval(refresh, 30_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  const ageSec = Math.floor((Date.now() - updatedAt) / 1000);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2 text-[10px] text-slate-500">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        ao vivo · há {ageSec}s
      </div>
      <Leaderboard ranking={ranking} currentUserId={currentUserId} />
    </div>
  );
}
