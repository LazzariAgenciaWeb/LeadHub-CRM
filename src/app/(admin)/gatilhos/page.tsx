import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import GatilhosManager from "./GatilhosManager";

export default async function GatilhosPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const companyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");

  const [rules, campaigns, companies, company] = await Promise.all([
    companyId
      ? prisma.keywordRule.findMany({
          where: { companyId },
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
          include: { campaign: { select: { id: true, name: true } } },
        })
      : [],
    companyId
      ? prisma.campaign.findMany({
          where: { companyId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, source: true },
        })
      : [],
    isSuperAdmin
      ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [],
    companyId
      ? prisma.company.findUnique({
          where: { id: companyId },
          select: { id: true, name: true, triggerOnly: true },
        })
      : null,
  ]);

  return (
    <GatilhosManager
      rules={rules as any}
      campaigns={campaigns as any}
      companies={companies}
      company={company as any}
      isSuperAdmin={isSuperAdmin}
      selectedCompanyId={companyId}
    />
  );
}
