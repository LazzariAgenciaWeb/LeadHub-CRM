import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/keyword-rules?companyId=
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const rules = await prisma.keywordRule.findMany({
    where: effectiveCompanyId ? { companyId: effectiveCompanyId } : {},
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: {
      campaign: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(rules);
}

// POST /api/keyword-rules
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const body = await req.json();
  const { keyword, mapTo, matchMode, priority, companyId, campaignId } = body;

  if (!keyword || !mapTo) {
    return NextResponse.json({ error: "keyword e mapTo são obrigatórios" }, { status: 400 });
  }

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const rule = await prisma.keywordRule.create({
    data: {
      keyword: keyword.trim().toLowerCase(),
      mapTo,
      matchMode: matchMode === "EXACT" ? "EXACT" : "CONTAINS",
      priority: priority ?? 0,
      companyId: effectiveCompanyId ?? undefined,
      campaignId: campaignId || null,
    },
    include: {
      campaign: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(rule, { status: 201 });
}
