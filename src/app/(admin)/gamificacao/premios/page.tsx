import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PremiosClient from "./PremiosClient";

export const dynamic = "force-dynamic";

export default async function PremiosPage() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const userId    = (session.user as any).id        as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const role      = (session.user as any).role      as string;
  const isAdmin   = role === "ADMIN" || role === "SUPER_ADMIN";

  if (!companyId) {
    return (
      <div className="p-6">
        <p className="text-slate-500 text-sm">Empresa não encontrada.</p>
      </div>
    );
  }

  const [rewards, myRedemptions, allRedemptionsPending, scoreAggregate] = await Promise.all([
    prisma.reward.findMany({
      where:   { companyId },
      orderBy: [{ available: "desc" }, { cost: "asc" }],
    }),
    prisma.rewardRedemption.findMany({
      where:   { userId, companyId },
      orderBy: { createdAt: "desc" },
      take:    20,
    }),
    isAdmin
      ? prisma.rewardRedemption.findMany({
          where:    { companyId, status: "PENDING" },
          orderBy:  { createdAt: "asc" },
          include:  { user: { select: { name: true } } },
        })
      : [],
    prisma.userScore.aggregate({
      where: { userId, companyId },
      _sum:  { redeemablePoints: true },
    }),
  ]);

  const myBalance = scoreAggregate._sum.redeemablePoints ?? 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/gamificacao" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar pro painel
      </Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-2xl">🎁 Prêmios</h1>
          <p className="text-slate-500 text-sm mt-1">Troque seus pontos por recompensas reais</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2.5 text-right">
          <p className="text-emerald-300 text-[10px] uppercase tracking-wider">Saldo</p>
          <p className="text-emerald-200 text-2xl font-bold">{myBalance} <span className="text-xs">pts</span></p>
        </div>
      </div>

      <PremiosClient
        rewards={rewards}
        myRedemptions={myRedemptions}
        adminPending={allRedemptionsPending as any}
        myBalance={myBalance}
        isAdmin={isAdmin}
      />
    </div>
  );
}
