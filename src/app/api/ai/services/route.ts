import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

function resolveCompanyId(session: any, fallback?: string | null): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return fallback ?? session.user.companyId ?? null;
  return session.user.companyId ?? null;
}

// GET /api/ai/services[?companyId=]  → lista o catálogo da empresa
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const companyId = resolveCompanyId(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json([]);

  const services = await prisma.service.findMany({
    where: { companyId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(services);
}

// POST /api/ai/services  → cria um serviço
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const companyId = resolveCompanyId(session, body.companyId);
  if (!companyId) return NextResponse.json({ error: "companyId ausente" }, { status: 400 });

  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });

  const created = await prisma.service.create({
    data: {
      companyId,
      name,
      description:         (body.description ?? "").trim() || null,
      qualifyingQuestions: (body.qualifyingQuestions ?? "").trim() || null,
      salesArguments:      (body.salesArguments ?? "").trim() || null,
      references:          (body.references ?? "").trim() || null,
      priceRange:          (body.priceRange ?? "").trim() || null,
      isActive:            body.isActive ?? true,
      order:               typeof body.order === "number" ? body.order : 0,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
