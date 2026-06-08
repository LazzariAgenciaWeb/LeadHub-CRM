import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// POST /api/leads/bulk
// Ações em massa sobre uma lista de leads. Body:
//   { leadIds: string[], action: "addTag", tagId }
//   { leadIds: string[], action: "removeTag", tagId }
//   { leadIds: string[], action: "setStage", pipelineStage }
//   { leadIds: string[], action: "setPipeline", pipeline, pipelineStage? }
//
// Todos os leads precisam ser da empresa do usuário (SUPER_ADMIN ignora o gate).
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = role === "SUPER_ADMIN";

  const body = await req.json().catch(() => ({}));
  const leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds.filter((x: any) => typeof x === "string") : [];
  const action = String(body.action ?? "");

  if (leadIds.length === 0) {
    return NextResponse.json({ error: "Nenhum lead informado" }, { status: 400 });
  }
  if (leadIds.length > 200) {
    return NextResponse.json({ error: "Máximo de 200 leads por operação" }, { status: 400 });
  }

  // Carrega os leads pra validar ownership numa tacada só.
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, companyId: true },
  });
  if (leads.length === 0) {
    return NextResponse.json({ error: "Leads não encontrados" }, { status: 404 });
  }
  // Gate: cliente só mexe nos próprios leads.
  const allowed = isSuperAdmin
    ? leads
    : leads.filter((l) => l.companyId === userCompanyId);
  if (allowed.length === 0) {
    return NextResponse.json({ error: "Sem permissão para esses leads" }, { status: 403 });
  }
  const allowedIds = allowed.map((l) => l.id);

  switch (action) {
    case "addTag": {
      const tagId = String(body.tagId ?? "");
      if (!tagId) return NextResponse.json({ error: "tagId obrigatório" }, { status: 400 });
      const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { companyId: true } });
      if (!tag) return NextResponse.json({ error: "Tag não encontrada" }, { status: 404 });
      // Só aplica nos leads da MESMA empresa da tag (tag é por empresa).
      const sameCompanyIds = allowed.filter((l) => l.companyId === tag.companyId).map((l) => l.id);
      if (sameCompanyIds.length === 0) {
        return NextResponse.json({ error: "Nenhum lead da mesma empresa da tag" }, { status: 400 });
      }
      // createMany com skipDuplicates — idempotente.
      await prisma.leadTag.createMany({
        data: sameCompanyIds.map((leadId) => ({ leadId, tagId })),
        skipDuplicates: true,
      });
      return NextResponse.json({ ok: true, affected: sameCompanyIds.length });
    }

    case "removeTag": {
      const tagId = String(body.tagId ?? "");
      if (!tagId) return NextResponse.json({ error: "tagId obrigatório" }, { status: 400 });
      const result = await prisma.leadTag.deleteMany({
        where: { leadId: { in: allowedIds }, tagId },
      });
      return NextResponse.json({ ok: true, affected: result.count });
    }

    case "setStage": {
      const pipelineStage = String(body.pipelineStage ?? "");
      if (!pipelineStage) return NextResponse.json({ error: "pipelineStage obrigatório" }, { status: 400 });
      const result = await prisma.lead.updateMany({
        where: { id: { in: allowedIds } },
        data: { pipelineStage },
      });
      return NextResponse.json({ ok: true, affected: result.count });
    }

    case "setPipeline": {
      const pipeline = String(body.pipeline ?? "");
      if (!pipeline) return NextResponse.json({ error: "pipeline obrigatório" }, { status: 400 });
      const pipelineStage = body.pipelineStage != null ? String(body.pipelineStage) : null;
      const result = await prisma.lead.updateMany({
        where: { id: { in: allowedIds } },
        data: { pipeline, pipelineStage },
      });
      return NextResponse.json({ ok: true, affected: result.count });
    }

    default:
      return NextResponse.json({ error: `Ação desconhecida: ${action}` }, { status: 400 });
  }
}
