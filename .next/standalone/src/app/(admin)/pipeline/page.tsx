import { getEffectiveSession } from "@/lib/effective-session";


import { prisma } from "@/lib/prisma";
import PipelineBoard from "./PipelineBoard";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; campaignId?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const companyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");
  const campaignId = sp.campaignId ?? "";

  const where: any = {};
  if (companyId) where.companyId = companyId;
  if (campaignId) where.campaignId = campaignId;

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      company: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
    },
  });

  const [companies, campaigns] = await Promise.all([
    isSuperAdmin
      ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [],
    prisma.campaign.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <PipelineBoard
      leads={leads as any}
      isSuperAdmin={isSuperAdmin}
      companies={companies}
      campaigns={campaigns}
      filterCompanyId={companyId}
      filterCampaignId={campaignId}
    />
  );
}
