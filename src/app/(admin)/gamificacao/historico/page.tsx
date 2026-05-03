import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export default async function HistoricoPage() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const userId    = (session.user as any).id        as string;
  const userName  = (session.user as any).name      as string;
  const companyId = (session.user as any).companyId as string | undefined;

  if (!companyId) {
    return (
      <div className="p-6">
        <p className="text-slate-500 text-sm">
          Você precisa estar vinculado a uma empresa.
        </p>
      </div>
    );
  }

  // Pega últimos 12 meses de histórico (incluindo atual)
  const scores = await prisma.userScore.findMany({
    where:   { userId, companyId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take:    12,
  });

  // Reverso pra cronológico: mais antigo primeiro (pra gráfico ir crescendo)
  const reversed = [...scores].reverse();

  const maxPoints = Math.max(1, ...scores.map((s) => s.monthPoints));
  const totalAcumulado = scores[0]?.totalPoints ?? 0;
  const redeemableAtual = scores[0]?.redeemablePoints ?? 0;

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear  = now.getFullYear();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/gamificacao" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar pro painel
      </Link>

      <div className="mb-6">
        <h1 className="text-white font-bold text-2xl">Histórico de pontuação</h1>
        <p className="text-slate-500 text-sm mt-1">{userName} · últimos 12 meses</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Acumulado total</p>
          <p className="text-white font-bold text-3xl">{totalAcumulado}</p>
          <p className="text-slate-600 text-xs mt-1">pontos no histórico</p>
        </div>
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Resgatáveis</p>
          <p className="text-emerald-400 font-bold text-3xl">{redeemableAtual}</p>
          <p className="text-slate-600 text-xs mt-1">disponíveis pra prêmios</p>
        </div>
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Meses ativos</p>
          <p className="text-indigo-400 font-bold text-3xl">{scores.filter((s) => s.monthPoints > 0).length}</p>
          <p className="text-slate-600 text-xs mt-1">de {scores.length} registrados</p>
        </div>
      </div>

      {/* Gráfico de barras simples */}
      {reversed.length > 0 && (
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5 mb-6">
          <h3 className="text-white font-semibold text-sm mb-4">Evolução mensal</h3>
          <div className="flex items-end gap-2 h-48">
            {reversed.map((s) => {
              const height = Math.max(2, (s.monthPoints / maxPoints) * 100);
              const isCurrent = s.month === currentMonth && s.year === currentYear;
              return (
                <div key={`${s.year}-${s.month}`} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="text-[10px] text-slate-400 font-bold">{s.monthPoints}</div>
                  <div
                    className={`w-full rounded-t transition-all ${
                      isCurrent
                        ? "bg-gradient-to-t from-fuchsia-600 to-purple-500"
                        : "bg-gradient-to-t from-indigo-600 to-indigo-400"
                    }`}
                    style={{ height: `${height}%` }}
                  />
                  <div className={`text-[10px] truncate ${isCurrent ? "text-fuchsia-300 font-bold" : "text-slate-500"}`}>
                    {MONTH_NAMES[s.month - 1]}
                    <span className="text-slate-700 ml-0.5">{String(s.year).slice(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lista detalhada */}
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#1e2d45]">
          <h3 className="text-white font-semibold text-sm">Detalhamento mês a mês</h3>
        </div>
        {scores.length === 0 ? (
          <div className="p-6 text-slate-500 text-sm text-center">
            Nenhum registro ainda. Atenda o primeiro cliente pra começar a pontuar!
          </div>
        ) : (
          <div className="divide-y divide-[#1e2d45]">
            {scores.map((s, i) => {
              const prev = scores[i + 1];
              const diff = prev ? s.monthPoints - prev.monthPoints : null;
              const trend = diff === null ? "neutral" : diff > 0 ? "up" : diff < 0 ? "down" : "neutral";
              const isCurrent = s.month === currentMonth && s.year === currentYear;
              return (
                <div key={`${s.year}-${s.month}`} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-16">
                    <div className={`text-sm font-semibold ${isCurrent ? "text-fuchsia-300" : "text-white"}`}>
                      {MONTH_NAMES[s.month - 1]}/{String(s.year).slice(2)}
                    </div>
                    {isCurrent && <div className="text-fuchsia-400 text-[9px] uppercase tracking-wider">atual</div>}
                  </div>
                  <div className="flex-1">
                    <div className="text-white font-bold text-lg">{s.monthPoints} pts</div>
                  </div>
                  {diff !== null && (
                    <div className={`flex items-center gap-1 text-xs ${
                      trend === "up" ? "text-emerald-400" :
                      trend === "down" ? "text-red-400" : "text-slate-500"
                    }`}>
                      {trend === "up" && <TrendingUp className="w-3 h-3" />}
                      {trend === "down" && <TrendingDown className="w-3 h-3" />}
                      {trend === "neutral" && <Minus className="w-3 h-3" />}
                      {diff > 0 ? "+" : ""}{diff} vs {MONTH_NAMES[(prev!.month - 1)]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-slate-600 text-[11px] mt-4 text-center">
        💡 Bônus de <strong>+30 pts</strong> automático no dia 1º para quem superar o mês anterior.
      </p>
    </div>
  );
}
