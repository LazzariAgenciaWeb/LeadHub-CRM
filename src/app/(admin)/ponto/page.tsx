import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { dayKeyInTZ, parseYm } from "@/lib/ponto";
import { loadEspelho } from "@/lib/ponto-data";
import MeuPontoClient from "./MeuPontoClient";

// Sem cache — o ponto do dia muda a cada batida
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PontoPage(props: { searchParams: Promise<{ ym?: string }> }) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const userId = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const role = (session.user as any).role as string;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  if (!companyId) {
    return (
      <div className="p-6">
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-8 text-center">
          <div className="text-3xl mb-2">🕐</div>
          <div className="text-slate-400 text-sm">
            Seu usuário não está vinculado a uma empresa — o ponto fica indisponível.
          </div>
        </div>
      </div>
    );
  }

  const { ym } = await props.searchParams;
  const { year, month } = parseYm(ym);

  const [{ espelho, signature }, myRequests] = await Promise.all([
    loadEspelho(userId, companyId, year, month),
    prisma.punchAdjustRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, date: true, reason: true, status: true, reviewNote: true,
        punches: true, createdAt: true,
      },
    }),
  ]);

  return (
    <MeuPontoClient
      espelho={espelho}
      signature={signature ? { signedAt: signature.signedAt.toISOString(), ip: signature.ip } : null}
      myRequests={myRequests.map((r) => ({
        id: r.id,
        dayKey: dayKeyInTZ(r.date),
        reason: r.reason,
        status: r.status,
        reviewNote: r.reviewNote,
        punches: r.punches as { type: string; time: string }[],
      }))}
      todayKey={dayKeyInTZ(new Date())}
      userId={userId}
      isAdmin={isAdmin}
    />
  );
}
