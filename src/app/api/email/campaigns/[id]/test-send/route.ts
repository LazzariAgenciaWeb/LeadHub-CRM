import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/lib/email-render";
import { sendCompanyMail } from "@/lib/company-email";

// POST /api/email/campaigns/[id]/test-send { to?: string }
// Manda 1 email pro próprio user (ou pro `to` informado) usando o template
// da campanha + um conjunto de vars de exemplo. Não cria EmailRecipient.
// Cliente usa pra validar template/conexão antes de disparar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const userEmail = (session.user as any).email as string | undefined;

  const campaign = await prisma.emailCampaign.findUnique({
    where: { id },
    include: { template: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && campaign.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const to = (body.to as string)?.trim() || userEmail;
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "Email de destino inválido" }, { status: 400 });
  }

  // Vars de exemplo — qualquer {{var}} sem valor real fica em branco
  const sampleVars = {
    nome: "Teste LeadHub",
    primeiroNome: "Teste",
    email: to,
    phone: "5511999999999",
    empresa: "Empresa Exemplo",
  };

  const rendered = renderTemplate(
    { subject: campaign.subject || campaign.template.subject, html: campaign.template.html, text: campaign.template.text },
    sampleVars
  );

  // No test-send NÃO injetamos tracking (não tem recipient real — sem token).
  // Quem quer testar tracking, usa o "Enviar campanha" pra si mesmo via segment.

  try {
    await sendCompanyMail(campaign.companyId, {
      to,
      subject: `[TESTE] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
    });
    return NextResponse.json({ ok: true, sentTo: to });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao enviar" }, { status: 500 });
  }
}
