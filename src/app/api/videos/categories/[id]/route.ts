import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { canManageCategory } from "@/lib/videos";

// Empresas que o ator pode liberar (destino das releases):
//   GLOBAL  → qualquer empresa com acesso ao sistema.
//   COMPANY → sub-empresas (clientes) da agência dona.
async function eligibleCompanyIds(scope: "GLOBAL" | "COMPANY", ownerId: string | null): Promise<Set<string>> {
  const rows = await prisma.company.findMany({
    where: scope === "GLOBAL" ? { hasSystemAccess: true } : { parentCompanyId: ownerId ?? undefined },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

// PATCH /api/videos/categories/[id]
// Body pode conter: title, description, emoji, accent, active, position,
//   visibility ("ALL"|"SELECTED"), releaseCompanyIds (string[] — substitui as liberações)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "videos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const category = await prisma.videoCategory.findUnique({
    where: { id },
    select: { id: true, scope: true, companyId: true },
  });
  if (!category) return NextResponse.json({ error: "Trilha não encontrada" }, { status: 404 });
  if (!canManageCategory(session, category)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const data: any = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if ("description" in body) data.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  if ("emoji" in body) data.emoji = typeof body.emoji === "string" && body.emoji.trim() ? body.emoji.trim() : null;
  if ("accent" in body) data.accent = typeof body.accent === "string" && body.accent.trim() ? body.accent.trim() : null;
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.position === "number" && Number.isFinite(body.position)) data.position = Math.trunc(body.position);
  if (body.visibility === "ALL" || body.visibility === "SELECTED") data.visibility = body.visibility;

  // Substitui as liberações se veio a lista (só as empresas elegíveis passam).
  let releaseOps: any = undefined;
  if (Array.isArray(body.releaseCompanyIds)) {
    const eligible = await eligibleCompanyIds(category.scope as "GLOBAL" | "COMPANY", category.companyId);
    const raw = body.releaseCompanyIds as unknown[];
    const ids = raw.filter((x): x is string => typeof x === "string");
    const targets = [...new Set(ids)].filter((cid) => eligible.has(cid));
    releaseOps = {
      deleteMany: {},
      create: targets.map((companyId) => ({ companyId })),
    };
  }

  const updated = await prisma.videoCategory.update({
    where: { id },
    data: { ...data, ...(releaseOps ? { releases: releaseOps } : {}) },
    include: {
      videos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      releases: { select: { companyId: true } },
    },
  });

  return NextResponse.json({
    category: { ...updated, releaseCompanyIds: updated.releases.map((r) => r.companyId) },
  });
}

// DELETE /api/videos/categories/[id] — apaga a trilha (cascade em vídeos + liberações).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "videos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const category = await prisma.videoCategory.findUnique({
    where: { id },
    select: { id: true, scope: true, companyId: true },
  });
  if (!category) return NextResponse.json({ error: "Trilha não encontrada" }, { status: 404 });
  if (!canManageCategory(session, category)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  await prisma.videoCategory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
