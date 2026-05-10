import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

const DEFAULT_COLOR = "#6366f1";

// GET /api/tags?companyId=  → tags da empresa (default = empresa do user)
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const queryCompanyId = req.nextUrl.searchParams.get("companyId") ?? undefined;

  let companyId: string | undefined;
  if (role === "SUPER_ADMIN") {
    if (!queryCompanyId) {
      return NextResponse.json({ error: "companyId obrigatório para SUPER_ADMIN" }, { status: 400 });
    }
    companyId = queryCompanyId;
  } else {
    companyId = userCompanyId;
  }
  if (!companyId) return NextResponse.json([]);

  const tags = await prisma.tag.findMany({
    where: { companyId },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: { _count: { select: { leads: true } } },
  });
  return NextResponse.json(tags);
}

// POST /api/tags  → cria tag {name, color?, companyId?}
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const body = await req.json();

  const name: string = (body.name ?? "").trim();
  const color: string = (body.color ?? DEFAULT_COLOR).trim();
  let companyId: string | undefined;

  if (role === "SUPER_ADMIN") {
    companyId = body.companyId;
    if (!companyId) {
      return NextResponse.json({ error: "companyId obrigatório para SUPER_ADMIN" }, { status: 400 });
    }
  } else {
    companyId = userCompanyId;
  }
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });

  // Idempotência: se tag com mesmo nome já existe na empresa, retorna ela
  // (UI pode chamar "criar" com nome digitado livre sem se preocupar).
  const existing = await prisma.tag.findUnique({
    where: { companyId_name: { companyId, name } },
  });
  if (existing) return NextResponse.json(existing);

  const tag = await prisma.tag.create({
    data: { name, color, companyId },
  });
  return NextResponse.json(tag, { status: 201 });
}
