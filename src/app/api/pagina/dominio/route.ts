import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureBioPage, requireBioEditor } from "@/lib/bio-page-server";
import { bioDomainTarget } from "@/lib/bio-domain";
import {
  DomainInputError,
  DomainPlanError,
  companyHasOwnSite,
  loadBioDomain,
  refreshBioDomain,
  removeBioDomain,
  setBioDomain,
} from "@/lib/bio-domain-server";

// Domínio próprio da Página do Negócio (plano com site próprio).
//   GET    — como está o domínio desta empresa
//   PUT    — grava/troca o domínio { hostname }
//   POST   — "Verificar agora": reconfere apontamento e certificado
//   DELETE — tira o domínio

async function contexto() {
  const auth = await requireBioEditor();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const pageId = await ensureBioPage(auth.companyId);
  return { ok: true as const, pageId, companyId: auth.companyId };
}

export async function GET() {
  const ctx = await contexto();
  if (!ctx.ok) return ctx.response;
  const [domain, allowed] = await Promise.all([
    loadBioDomain(ctx.pageId),
    companyHasOwnSite(ctx.companyId),
  ]);
  return NextResponse.json({ domain, allowed, target: bioDomainTarget() });
}

export async function PUT(req: NextRequest) {
  const ctx = await contexto();
  if (!ctx.ok) return ctx.response;

  const body = (await req.json().catch(() => null)) as { hostname?: unknown } | null;
  try {
    const domain = await setBioDomain(ctx.pageId, ctx.companyId, String(body?.hostname ?? ""));
    return NextResponse.json({ domain, allowed: true, target: bioDomainTarget() });
  } catch (e) {
    if (e instanceof DomainPlanError) return NextResponse.json({ error: e.message, upgrade: true }, { status: 403 });
    if (e instanceof DomainInputError) {
      return NextResponse.json({ error: e.message, problem: e.problem, suggestion: e.suggestion }, { status: 400 });
    }
    throw e;
  }
}

export async function POST() {
  const ctx = await contexto();
  if (!ctx.ok) return ctx.response;
  if (!(await companyHasOwnSite(ctx.companyId))) {
    return NextResponse.json({ error: new DomainPlanError().message, upgrade: true }, { status: 403 });
  }

  // Botão apertado em sequência não vira enxurrada de chamada na Cloudflare.
  const atual = await prisma.bioDomain.findUnique({
    where: { pageId: ctx.pageId },
    select: { lastCheckedAt: true },
  });
  if (!atual) return NextResponse.json({ error: "Esta página não tem domínio próprio." }, { status: 404 });
  if (atual.lastCheckedAt && Date.now() - atual.lastCheckedAt.getTime() < 8_000) {
    return NextResponse.json({ domain: await loadBioDomain(ctx.pageId), allowed: true, target: bioDomainTarget() });
  }

  const domain = await refreshBioDomain(ctx.pageId);
  return NextResponse.json({ domain, allowed: true, target: bioDomainTarget() });
}

export async function DELETE() {
  const ctx = await contexto();
  if (!ctx.ok) return ctx.response;
  await removeBioDomain(ctx.pageId);
  return NextResponse.json({ domain: null, allowed: await companyHasOwnSite(ctx.companyId), target: bioDomainTarget() });
}
