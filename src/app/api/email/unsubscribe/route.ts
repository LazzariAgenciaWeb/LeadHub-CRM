import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/email/unsubscribe { token, reason? }  — público, sem auth
// Adiciona à suppression list da empresa + marca o recipient como UNSUBSCRIBED.
// Aceita também 1-click via header List-Unsubscribe-Post (POST sem body por
// alguns clientes — mailto-style também aceito).
export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* sem body é OK no 1-click */ }

  // 1-click pode também passar token na query
  const token = (body.token as string) ?? req.nextUrl.searchParams.get("token");
  const reason = (body.reason as string) ?? null;

  if (!token) return NextResponse.json({ error: "Token obrigatório" }, { status: 400 });

  const recipient = await prisma.emailRecipient.findUnique({
    where: { token },
    select: {
      id: true, email: true, campaign: { select: { companyId: true } },
    },
  });
  if (!recipient) return NextResponse.json({ error: "Token inválido" }, { status: 404 });

  const email = recipient.email.toLowerCase();
  const companyId = recipient.campaign.companyId;

  // Suppression list (unique por email+company)
  await prisma.emailUnsubscribe.upsert({
    where: { email_companyId: { email, companyId } },
    create: { email, companyId, reason: reason || null },
    update: { reason: reason || undefined },
  });

  // Evento + counter
  await prisma.emailEvent.create({
    data: { recipientId: recipient.id, type: "UNSUBSCRIBE" },
  }).catch(() => null);

  await prisma.emailCampaign.update({
    where: { id: (await prisma.emailRecipient.findUnique({ where: { id: recipient.id }, select: { campaignId: true } }))!.campaignId },
    data: { unsubscribedCount: { increment: 1 } },
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
