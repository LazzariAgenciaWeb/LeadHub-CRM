import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/whatsapp/convert-lead
// Converte manualmente uma conversa WhatsApp em lead
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const body = await req.json();
  const { phone, companyId, name, status, campaignId } = body;

  if (!phone) return NextResponse.json({ error: "phone é obrigatório" }, { status: 400 });

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;
  if (!effectiveCompanyId) return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });

  // Verifica se já existe lead
  const existing = await prisma.lead.findFirst({
    where: { phone, companyId: effectiveCompanyId },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return NextResponse.json({ lead: existing, alreadyExists: true });
  }

  // Cria o lead — entra automaticamente no pipeline LEADS com primeira etapa
  const firstLeadStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId: effectiveCompanyId, pipeline: "LEADS" },
    orderBy: { order: "asc" },
  });

  const lead = await prisma.lead.create({
    data: {
      phone,
      name: name || null,
      companyId: effectiveCompanyId,
      campaignId: campaignId || null,
      source: "whatsapp",
      status: status ?? "NEW",
      pipeline: "LEADS",
      pipelineStage: firstLeadStage?.name ?? null,
    },
  });

  // Vincula todas as mensagens desse telefone ao lead
  await prisma.message.updateMany({
    where: { phone, companyId: effectiveCompanyId, leadId: null },
    data: { leadId: lead.id },
  });

  return NextResponse.json({ lead, alreadyExists: false }, { status: 201 });
}
