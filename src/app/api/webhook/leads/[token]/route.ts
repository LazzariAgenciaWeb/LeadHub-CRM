import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_PIPELINES = ["PROSPECCAO", "LEADS", "OPORTUNIDADES"] as const;

// POST /api/webhook/leads/[token]
// Endpoint público — autenticado pelo token da empresa, sem sessão de usuário.
// Aceita JSON com: name, phone, email, source, pipeline, notes, tags (qualquer combinação).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const company = await prisma.company.findUnique({
    where: { webhookToken: token },
    select: { id: true, name: true },
  });

  if (!company) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Aceita variações de nome de campo (inglês / português)
  const phone = String(body.phone ?? body.telefone ?? body.cel ?? "").trim().replace(/\D/g, "");
  const name  = String(body.name  ?? body.nome    ?? body.empresa ?? "").trim() || null;
  const email = String(body.email ?? "").trim() || null;
  const source = String(body.source ?? body.origem ?? body.utm_source ?? "webhook").trim();
  const notes  = String(body.notes ?? body.observacoes ?? body.mensagem ?? "").trim() || null;

  const rawPipeline = String(body.pipeline ?? "PROSPECCAO").toUpperCase();
  const pipeline = ALLOWED_PIPELINES.includes(rawPipeline as any)
    ? (rawPipeline as (typeof ALLOWED_PIPELINES)[number])
    : "PROSPECCAO";

  if (!phone) {
    return NextResponse.json({ error: "Campo obrigatório: phone (ou telefone)" }, { status: 400 });
  }

  // Busca primeira etapa do pipeline da empresa
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId: company.id, pipeline },
    orderBy: { order: "asc" },
    select: { name: true },
  });

  // Checa duplicata (mesmo telefone + pipeline na empresa)
  const existing = await prisma.lead.findFirst({
    where: { companyId: company.id, phone, pipeline },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({
      ok: false,
      message: "Lead já existe neste pipeline",
      leadId: existing.id,
    });
  }

  const lead = await prisma.lead.create({
    data: {
      phone,
      name,
      email,
      companyId:     company.id,
      source,
      status:        "NEW",
      pipeline,
      pipelineStage: firstStage?.name ?? null,
      notes,
    },
    select: { id: true, name: true, phone: true, pipeline: true, pipelineStage: true },
  });

  return NextResponse.json({ ok: true, lead }, { status: 201 });
}

// GET /api/webhook/leads/[token] — verificação de saúde do endpoint
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const company = await prisma.company.findUnique({
    where: { webhookToken: token },
    select: { name: true },
  });

  if (!company) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    company: company.name,
    message: "Webhook ativo. Envie um POST com os dados do lead.",
    fields: {
      required: ["phone"],
      optional: ["name", "email", "source", "pipeline", "notes"],
      pipeline_values: ["PROSPECCAO", "LEADS", "OPORTUNIDADES"],
    },
  });
}
