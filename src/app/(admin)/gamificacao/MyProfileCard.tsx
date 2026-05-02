import { Trophy, TrendingUp, Award } from "lucide-react";
import { gradStroke } from "@/components/IconGradients";

type Props = {
  userName:    string;
  monthPoints: number;
  totalPoints: number;
  position:    number | null;
  totalUsers:  number;
  badgeCount:  number;
};

export default function MyProfileCard({
  userName, monthPoints, totalPoints, position, totalUsers, badgeCount,
}: Props) {
  const positionLabel = position
    ? position === 1 ? "🥇 1º"
      : position === 2 ? "🥈 2º"
      : position === 3 ? "🥉 3º"
      : `${position}º`
    : "—";

  return (
    <div className="bg-gradient-to-br from-[#0a0f1a] to-[#0f1623] border border-[#1e2d45] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Olá,</p>
          <h2 className="text-white font-semibold text-xl">{userName}</h2>
          <p className="text-slate-500 text-xs mt-1">Seu desempenho no mês</p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/10 border border-yellow-500/30 flex items-center justify-center">
          <Trophy className="w-6 h-6" stroke={gradStroke("gamificacao")} strokeWidth={2} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Pontos do mês */}
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Mês</p>
          </div>
          <p className="text-white font-bold text-2xl">{monthPoints}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">pontos</p>
        </div>

        {/* Posição */}
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy className="w-3.5 h-3.5 text-yellow-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Posição</p>
          </div>
          <p className="text-white font-bold text-2xl">{positionLabel}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">de {totalUsers}</p>
        </div>

        {/* Badges */}
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Award className="w-3.5 h-3.5 text-indigo-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Badges</p>
          </div>
          <p className="text-white font-bold text-2xl">{badgeCount}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">conquistadas</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[#1e2d45] flex items-center justify-between text-xs">
        <span className="text-slate-500">Acumulado total</span>
        <span className="text-white font-medium">{totalPoints} pts</span>
      </div>
    </div>
  );
}
