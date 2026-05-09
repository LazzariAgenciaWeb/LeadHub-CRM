"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";

type RankingEntry = {
  userId:          string;
  name:            string;
  rankingCategory: "PRODUCAO" | "GESTAO";
  monthPoints:     number;
};

type Props = {
  initialRanking: RankingEntry[];
  viewUserId:     string;
};

/**
 * Mini ranking com polling a cada 30s. Mantém o mesmo layout do bloco que
 * existia inline no DashboardGamificacaoTop, mas atualiza sem reload.
 *
 * Usa /api/gamificacao/ranking — já filtra SUPER_ADMIN do leaderboard e
 * respeita o gate de módulo. Em caso de erro silencia (mantém último estado).
 */
export default function LiveRankingMini({ initialRanking, viewUserId }: Props) {
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
        setRanking(
          (data.ranking ?? []).map((r: any) => ({
            userId:          r.userId,
            name:            r.name,
            rankingCategory: r.rankingCategory,
            monthPoints:     r.monthPoints,
          })),
        );
        setUpdatedAt(Date.now());
      } catch {/* silent */}
    }
    const iv = setInterval(refresh, 30_000);
    // refresh quando a aba volta ao foco — feedback rápido
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  const globalRanking = [...ranking]
    .sort((a, b) => b.monthPoints - a.monthPoints)
    .map((r, i) => ({ ...r, globalPosition: i + 1 }));

  const me = globalRanking.find((r) => r.userId === viewUserId);
  const top5 = globalRanking.slice(0, 5);
  const myPosition = me?.globalPosition ?? 0;
  const showsMe = top5.some((r) => r.userId === viewUserId);

  // Idade do snapshot pra dar pista de "ao vivo"
  const ageSec = Math.floor((Date.now() - updatedAt) / 1000);

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-400" /> Ranking
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
              title={`Atualizado há ${ageSec}s · refresh a cada 30s`}
            />
          </h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Top do mês — atualiza a cada 30s
          </p>
        </div>
        <Link href="/gamificacao" className="text-[10px] text-slate-500 hover:text-white">
          ver todos
        </Link>
      </div>

      {ranking.length === 0 ? (
        <p className="text-slate-600 text-xs text-center py-6">
          Ninguém pontuou ainda.
        </p>
      ) : (
        <div className="space-y-1.5">
          {top5.map((entry) => {
            const isMe = entry.userId === viewUserId;
            const medal = entry.globalPosition === 1 ? "🥇"
                        : entry.globalPosition === 2 ? "🥈"
                        : entry.globalPosition === 3 ? "🥉"
                        : null;
            const catLabel = entry.rankingCategory === "GESTAO" ? "👔" : "👷";
            return (
              <div
                key={entry.userId}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                  isMe ? "bg-indigo-500/10 ring-1 ring-indigo-500/30" : ""
                }`}
              >
                <span className="w-6 text-center text-sm flex-shrink-0">
                  {medal ?? <span className="text-slate-500 text-xs">#{entry.globalPosition}</span>}
                </span>
                <span
                  className="text-xs flex-shrink-0"
                  title={entry.rankingCategory === "GESTAO" ? "Gestão" : "Produção"}
                >
                  {catLabel}
                </span>
                <span className={`flex-1 truncate text-xs ${isMe ? "text-white font-medium" : "text-slate-300"}`}>
                  {entry.name}
                  {isMe && <span className="ml-1 text-[9px] uppercase tracking-wider text-indigo-300">você</span>}
                </span>
                <span className={`text-xs font-bold ${isMe ? "text-white" : "text-slate-400"}`}>
                  {entry.monthPoints}
                </span>
              </div>
            );
          })}

          {!showsMe && me && myPosition > 0 && (
            <>
              <div className="text-center text-slate-700 text-[10px] py-0.5">···</div>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-indigo-500/10 ring-1 ring-indigo-500/30">
                <span className="w-6 text-center">
                  <span className="text-slate-500 text-xs">#{myPosition}</span>
                </span>
                <span className="flex-1 truncate text-xs text-white font-medium">
                  {me.name}
                  <span className="ml-1 text-[9px] uppercase tracking-wider text-indigo-300">você</span>
                </span>
                <span className="text-xs font-bold text-white">{me.monthPoints}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
