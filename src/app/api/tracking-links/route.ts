import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function generateCode(length = 7) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// GET /api/tracking-links?campaignId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const companyId = searchParams.get("companyId");

  const where: any = {};
  if (campaignId) where.campaignId = campaignId;
  else if (companyId) where.companyId = companyId;

  const links = await prisma.trackingLink.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { leads: true } },
      campaign: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(links);
}

// POST /api/tracking-links
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const { campaignId, companyId, destination, label, destType, waMessage, ogTitle, ogDescription, ogImage } = body;

  if (!destination) {
    return NextResponse.json({ error: "destination é obrigatório" }, { status: 400 });
  }
  if (!campaignId && !companyId) {
    return NextResponse.json({ error: "campaignId ou companyId são obrigatórios" }, { status: 400 });
  }

  // Resolve companyId a partir da campanha se necessário
  let resolvedCompanyId = companyId;
  if (campaignId && !resolvedCompanyId) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { companyId: true } });
    resolvedCompanyId = campaign?.companyId;
  }

  // Gera código único
  let code = generateCode();
  let attempts = 0;
  while (await prisma.trackingLink.findUnique({ where: { code } })) {
    code = generateCode();
    if (++attempts > 10) code = generateCode(10);
  }

  const link = await prisma.trackingLink.create({
    data: {
      code,
      destination,
      label: label || null,
      destType: destType || "url",
      ogTitle: ogTitle || null,
      ogDescription: ogDescription || null,
      ogImage: ogImage || null,
      ...(campaignId && { campaignId }),
      ...(resolvedCompanyId && { companyId: resolvedCompanyId }),
    },
    include: { _count: { select: { leads: true } }, campaign: { select: { id: true, name: true } } },
  });

  // Auto-cria gatilho quando link é WhatsApp com mensagem pré-preenchida e tem campanha
  if (destType === "whatsapp" && waMessage?.trim() && campaignId && resolvedCompanyId) {
    const exists = await prisma.keywordRule.findFirst({
      where: { campaignId, keyword: waMessage.trim() },
    });
    if (!exists) {
      await prisma.keywordRule.create({
        data: {
          keyword: waMessage.trim(),
          mapTo: "NEW",
          priority: 0,
          campaignId,
          companyId: resolvedCompanyId,
        },
      });
    }
  }

  return NextResponse.json(link, { status: 201 });
}
