import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import NewCampaignWizard from "./NewCampaignWizard";

export const dynamic = "force-dynamic";

export default async function NovaCampanhaPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) redirect("/campanhas/email");

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const sp = await searchParams;
  const companyId = isSuperAdmin
    ? (sp.companyId ?? (session.user as any).companyId)
    : (session.user as any).companyId;

  // Carregar templates + tags + pipeline stages pra alimentar o wizard
  const [templates, tags, stages] = await Promise.all([
    prisma.emailTemplate.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, subject: true },
    }),
    prisma.tag.findMany({
      where: { companyId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true },
    }),
    prisma.pipelineStageConfig.findMany({
      where: { companyId, pipeline: { in: ["PROSPECCAO", "LEADS", "OPORTUNIDADES"] } },
      orderBy: [{ pipeline: "asc" }, { order: "asc" }],
      select: { name: true, pipeline: true },
    }),
  ]);

  return (
    <NewCampaignWizard
      companyId={isSuperAdmin ? companyId : undefined}
      templates={templates}
      tags={tags}
      stages={stages}
    />
  );
}
