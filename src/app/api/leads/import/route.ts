import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

const ALLOWED_PIPELINES = ["PROSPECCAO", "LEADS", "OPORTUNIDADES"] as const;
type Pipeline = (typeof ALLOWED_PIPELINES)[number];

interface LeadRecord {
  phone: string;
  name?: string | null;
  email?: string | null;
  source?: string | null;
  pipeline?: string;
  notes?: string | null;
}

// POST /api/leads/import
// Importação genérica de leads via planilha. Autenticado por sessão.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const body = await req.json();
  const { records, pipeline: defaultPipeline, companyId: bodyCompanyId } = body as {
    records: LeadRecord[];
    pipeline?: string;
    companyId?: string;
  };

  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: "Nenhum registro enviado" }, { status: 400 });
  }

  const companyId = userRole === "SUPER_ADMIN" ? (bodyCompanyId ?? userCompanyId) : userCompanyId;
  if (!companyId) return NextResponse.json({ error: "Empresa não identificada" }, { status: 400 });

  // Cache de primeira etapa por pipeline para evitar N+1
  const firstStageCache: Partial<Record<Pipeline, string | null>> = {};
  async function getFirstStage(pipeline: Pipeline) {
    if (pipeline in firstStageCache) return firstStageCache[pipeline];
    const stage = await prisma.pipelineStageConfig.findFirst({
      where: { companyId, pipeline },
      orderBy: { order: "asc" },
      select: { name: true },
    });
    firstStageCache[pipeline] = stage?.name ?? null;
    return firstStageCache[pipeline];
  }

  let imported = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (const row of records) {
    const phone = String(row.phone ?? "").trim().replace(/\D/g, "");
    if (!phone) { skipped++; continue; }

    const rawPipeline = String(row.pipeline ?? defaultPipeline ?? "PROSPECCAO").toUpperCase();
    const pipeline: Pipeline = ALLOWED_PIPELINES.includes(rawPipeline as Pipeline)
      ? (rawPipeline as Pipeline)
      : "PROSPECCAO";

    // Deduplicação por telefone + pipeline
    const exists = await prisma.lead.findFirst({
      where: { companyId, phone, pipeline },
      select: { id: true },
    });
    if (exists) { skipped++; continue; }

    try {
      const firstStage = await getFirstStage(pipeline);
      await prisma.lead.create({
        data: {
          phone,
          name:          row.name  ?? null,
          email:         row.email ?? null,
          companyId,
          source:        row.source ?? "importacao",
          status:        "NEW",
          pipeline,
          pipelineStage: firstStage ?? null,
          notes:         row.notes ?? null,
        },
      });
      imported++;
    } catch (err: any) {
      errors.push(`${phone}: ${err?.message}`);
    }
  }

  return NextResponse.json({ imported, skipped, total: records.length, errors });
}
