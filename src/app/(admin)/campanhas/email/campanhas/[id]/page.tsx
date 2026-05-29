import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import CampaignDetail from "./CampaignDetail";

export const dynamic = "force-dynamic";

export default async function CampanhaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) redirect("/campanhas/email");

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const campaign = await prisma.emailCampaign.findUnique({
    where: { id },
    include: {
      template: { select: { id: true, name: true, subject: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!campaign) notFound();
  if (role !== "SUPER_ADMIN" && campaign.companyId !== userCompanyId) notFound();

  return (
    <CampaignDetail
      campaign={{
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        status: campaign.status,
        scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
        startedAt: campaign.startedAt?.toISOString() ?? null,
        completedAt: campaign.completedAt?.toISOString() ?? null,
        totalRecipients: campaign.totalRecipients,
        sentCount: campaign.sentCount,
        openedCount: campaign.openedCount,
        clickedCount: campaign.clickedCount,
        bouncedCount: campaign.bouncedCount,
        unsubscribedCount: campaign.unsubscribedCount,
        failedCount: campaign.failedCount,
        templateName: campaign.template?.name ?? null,
        createdByName: campaign.createdBy?.name ?? null,
        createdAt: campaign.createdAt.toISOString(),
      }}
    />
  );
}
