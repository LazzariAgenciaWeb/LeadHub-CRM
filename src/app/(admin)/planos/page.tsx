import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PlanosClient from "./PlanosClient";
import type { PlanTier } from "@/lib/plans";

// Painel comercial do SUPER_ADMIN: visão de quem usa o sistema (plano, status,
// atividade) + catálogo do que cada plano inclui. Só super admin acessa.
// Usa a sessão real (não impersonation) — gerir planos é ação de dono da plataforma.
export default async function PlanosPage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) redirect("/login");
  if (role !== "SUPER_ADMIN") redirect("/dashboard");

  const companies = await prisma.company.findMany({
    where: { hasSystemAccess: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      segment: true,
      status: true,
      createdAt: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          billingCycle: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
        },
      },
      _count: { select: { leads: true, whatsappInstances: true, users: true } },
    },
  });

  const ids = companies.map((c) => c.id);

  // "Última atividade" = a data mais recente entre a última mensagem recebida
  // e o último lead criado. Não há campo de last-login no schema, então isso é
  // o melhor proxy de uso real sem mexer no banco.
  const [msgActivity, leadActivity] = await Promise.all([
    ids.length
      ? prisma.message.groupBy({ by: ["companyId"], _max: { receivedAt: true }, where: { companyId: { in: ids } } })
      : Promise.resolve([] as { companyId: string; _max: { receivedAt: Date | null } }[]),
    ids.length
      ? prisma.lead.groupBy({ by: ["companyId"], _max: { createdAt: true }, where: { companyId: { in: ids } } })
      : Promise.resolve([] as { companyId: string; _max: { createdAt: Date | null } }[]),
  ]);
  const lastMsg = new Map(msgActivity.map((m) => [m.companyId, m._max.receivedAt]));
  const lastLead = new Map(leadActivity.map((l) => [l.companyId, l._max.createdAt]));

  const rows = companies.map((c) => {
    const tier = (c.subscription?.plan ?? "FREE") as PlanTier;
    const m = lastMsg.get(c.id) ?? null;
    const l = lastLead.get(c.id) ?? null;
    const lastActivity = [m, l]
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      id: c.id,
      name: c.name,
      segment: c.segment,
      companyStatus: c.status,
      plan: tier,
      subStatus: c.subscription?.status ?? null,
      billingCycle: c.subscription?.billingCycle ?? null,
      trialEndsAt: c.subscription?.trialEndsAt?.toISOString() ?? null,
      leads: c._count.leads,
      users: c._count.users,
      whatsappInstances: c._count.whatsappInstances,
      lastActivity: lastActivity ? lastActivity.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    };
  });

  return <PlanosClient rows={rows} />;
}
