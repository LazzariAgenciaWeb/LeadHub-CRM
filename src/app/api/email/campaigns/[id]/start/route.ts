import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { buildLeadWhereFromSegment, type SegmentFilter } from "@/lib/email-segment";
import { defaultVarsFromLead } from "@/lib/email-render";
import { getCompanyEmailConfig } from "@/lib/company-email";

// POST /api/email/campaigns/[id]/start
// Materializa EmailRecipient pra cada lead do segmento e marca status=SENDING.
// O worker (cron /api/cron/email-worker) começa a processar na próxima rodada.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const campaign = await prisma.emailCampaign.findUnique({
    where: { id },
    include: { template: { select: { id: true } } },
  });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && campaign.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (campaign.status === "SENDING") return NextResponse.json({ error: "Campanha já está enviando" }, { status: 409 });
  if (campaign.status === "COMPLETED") return NextResponse.json({ error: "Campanha já finalizada" }, { status: 409 });

  // Pré-flight: SMTP da empresa precisa estar configurado
  const smtp = await getCompanyEmailConfig(campaign.companyId);
  if (!smtp) {
    return NextResponse.json({ error: "Configure o SMTP da empresa antes de disparar" }, { status: 400 });
  }

  // Carrega suppression list pra excluir
  const suppressed = await prisma.emailUnsubscribe.findMany({
    where: { companyId: campaign.companyId },
    select: { email: true },
  });
  const suppressedSet = new Set(suppressed.map((u) => u.email.toLowerCase()));

  // Resolve segmento
  const segment = (campaign.segmentFilter ?? {}) as SegmentFilter;
  const where = buildLeadWhereFromSegment(campaign.companyId, segment);

  const leads = await prisma.lead.findMany({
    where,
    include: { company: { select: { name: true } } },
    // diagnosis + diagnosisToken vão direto via select (são escalares na Lead)
    take: 5000, // hard cap MVP
  });

  // Idempotência: descobre quem já está na campanha
  const existing = await prisma.emailRecipient.findMany({
    where: { campaignId: id },
    select: { email: true },
  });
  const existingEmails = new Set(existing.map((r) => r.email.toLowerCase()));

  // Filtra: tem email, não está suprimido, não está duplicado na campanha
  const toCreate = leads
    .filter((l) => !!l.email)
    .filter((l) => !suppressedSet.has(l.email!.toLowerCase()))
    .filter((l) => !existingEmails.has(l.email!.toLowerCase()));

  let created = 0;
  if (toCreate.length > 0) {
    // createMany pra eficiência (sem returning, ok pro MVP)
    const data = toCreate.map((l) => ({
      campaignId: id,
      leadId: l.id,
      email: l.email!,
      name: l.name ?? null,
      vars: defaultVarsFromLead(l) as any,
    }));
    const result = await prisma.emailRecipient.createMany({ data, skipDuplicates: true });
    created = result.count;
  }

  // Total final de recipients da campanha
  const totalRecipients = await prisma.emailRecipient.count({ where: { campaignId: id } });

  if (totalRecipients === 0) {
    return NextResponse.json({ error: "Nenhum destinatário válido no segmento" }, { status: 400 });
  }

  await prisma.emailCampaign.update({
    where: { id },
    data: {
      status: "SENDING",
      startedAt: campaign.startedAt ?? new Date(),
      totalRecipients,
    },
  });

  return NextResponse.json({
    ok: true,
    totalRecipients,
    created,
    suppressed: leads.filter((l) => l.email && suppressedSet.has(l.email.toLowerCase())).length,
  });
}
