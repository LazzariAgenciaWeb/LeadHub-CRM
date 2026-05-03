import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { BadgeType } from "@/generated/prisma";

// POST /api/admin/grant-badge — concede badge manual (admin only)
// Body: { userId, badge: BadgeType, tier: 1-6 }
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role           = (session.user as any).role as string;
  const userCompanyId  = (session.user as any).companyId as string | undefined;
  const canManageUsers = !!(session.user as any).permissions?.canManageUsers;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN" && !canManageUsers) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { userId, badge, tier } = await req.json();
  if (!userId || !badge || !tier || tier < 1 || tier > 6) {
    return NextResponse.json({ error: "userId, badge e tier (1-6) obrigatórios" }, { status: 400 });
  }

  // ADMIN só pode conceder pra users da própria empresa
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
  if (!target) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && target.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão (empresa diferente)" }, { status: 403 });
  }
  const targetCompanyId = target.companyId;
  if (!targetCompanyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });

  await prisma.userBadge.upsert({
    where:  { userId_badge_tier: { userId, badge: badge as BadgeType, tier } },
    create: { userId, companyId: targetCompanyId, badge: badge as BadgeType, tier },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/grant-badge?userId=&badge=&tier=
export async function DELETE(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role           = (session.user as any).role as string;
  const userCompanyId  = (session.user as any).companyId as string | undefined;
  const canManageUsers = !!(session.user as any).permissions?.canManageUsers;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN" && !canManageUsers) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const sp     = req.nextUrl.searchParams;
  const userId = sp.get("userId");
  const badge  = sp.get("badge");
  const tier   = parseInt(sp.get("tier") ?? "0", 10);
  if (!userId || !badge || !tier) {
    return NextResponse.json({ error: "params obrigatórios" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
  if (!target) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && target.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão (empresa diferente)" }, { status: 403 });
  }

  await prisma.userBadge.deleteMany({
    where: { userId, badge: badge as BadgeType, tier },
  });

  return NextResponse.json({ ok: true });
}
