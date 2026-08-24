import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import EsteiraPanel, { type EsteiraData } from "./EsteiraPanel";

export const dynamic = "force-dynamic";

export default async function EsteiraPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewCompanies")) redirect("/dashboard");

  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const [sales, clients] = await Promise.all([
    prisma.sale.findMany({
      where: isGlobal ? {} : { companyId: agencyId ?? "__none__" },
      orderBy: { closedAt: "desc" },
      take: 300,
      include: {
        clientCompany: { select: { id: true, name: true } },
        lead: { select: { id: true } },
      },
    }),
    prisma.company.findMany({
      where: isGlobal ? { parentCompanyId: { not: null } } : { parentCompanyId: agencyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const data: EsteiraData = {
    isGlobal,
    clients,
    sales: sales.map((s) => ({
      id: s.id,
      title: s.title,
      valueCents: s.valueCents,
      kind: s.kind,
      closedAt: s.closedAt.toISOString(),
      sellerName: s.sellerName,
      leadId: s.lead?.id ?? null,
      client: s.clientCompany,
      contractStatus: s.contractStatus,
      billingStatus: s.billingStatus,
      productionStatus: s.productionStatus,
    })),
  };

  return <EsteiraPanel data={data} />;
}
