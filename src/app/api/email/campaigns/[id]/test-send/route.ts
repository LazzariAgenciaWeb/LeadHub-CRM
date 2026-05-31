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

  // Vars de exemplo — qualquer {{var}} sem valor real fica em branco.
  // Inclui um diagnóstico fake pra você ver como ficam as seções renderizadas.
  const sampleVars = {
    nome: "Teste LeadHub",
    primeiroNome: "Teste",
    email: to,
    phone: "5511999999999",
    empresa: "Empresa Exemplo",
    diagnosticoUrl: "https://exemplo.com/d/exemplo",
    diagnosticoSummary: "Sua empresa tem boa presença digital, mas há oportunidades de otimização que podem melhorar conversão.",
    diagnosticoPontosFortes: `<div style="background:#f9fafb;border-left:4px solid #10b981;padding:14px 18px;border-radius:6px;margin:14px 0;"><div style="font-size:12px;font-weight:bold;color:#10b981;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">✅ Pontos fortes</div><ul style="padding-left:20px;margin:0;"><li style="margin-bottom:10px;color:#333;line-height:1.5;"><strong style="color:#111;">Estrutura de SEO básica</strong><div style="color:#666;margin-top:4px;font-size:13px;">Título e meta description configurados.</div></li></ul></div>`,
    diagnosticoOportunidades: `<div style="background:#f9fafb;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:6px;margin:14px 0;"><div style="font-size:12px;font-weight:bold;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">⚠️ Oportunidades</div><ul style="padding-left:20px;margin:0;"><li style="margin-bottom:10px;color:#333;line-height:1.5;"><strong style="color:#111;">Otimização de imagens</strong><div style="color:#666;margin-top:4px;font-size:13px;">Algumas imagens sem texto ALT.</div></li></ul></div>`,
    diagnosticoQuickWins: `<div style="background:#f9fafb;border-left:4px solid #ef4444;padding:14px 18px;border-radius:6px;margin:14px 0;"><div style="font-size:12px;font-weight:bold;color:#ef4444;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">🔴 Quick wins (solução rápida)</div><ul style="padding-left:20px;margin:0;"><li style="margin-bottom:10px;color:#333;line-height:1.5;"><a href="https://exemplo.com/d/exemplo#criticals" style="color:#ef4444;text-decoration:none;font-weight:bold;">Pagespeed indisponível</a><div style="color:#666;margin-top:4px;font-size:13px;">Sem dados sobre velocidade do site.</div></li></ul></div>`,
    whatsappAvaliacaoUrl: "https://wa.me/5511999999999?text=Ol%C3%A1%21%20Acabei%20de%20ver%20o%20diagn%C3%B3stico%20de%20exemplo%20(ref%3A%20demo)",
    diagnosticoCtaDuplo: `<div style="text-align:center;margin:28px 0;"><a href="https://exemplo.com/d/exemplo" style="display:inline-block;background:#6366f1;color:#fff;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:6px 4px;font-size:14px;">📊 Ver diagnóstico</a><a href="https://wa.me/5511999999999?text=teste" style="display:inline-block;background:#10b981;color:#fff;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:6px 4px;font-size:14px;">💬 Solicitar via WhatsApp</a></div>`,
    diagnosticoCompleto: "",  // worker preenche com tudo junto
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
