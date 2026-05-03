import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { RankingCategory } from "@/generated/prisma";

// PATCH /api/users/[id]/ranking-category
// Body: { rankingCategory: "PRODUCAO" | "GESTAO" }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role           = (session.user as any).role as string;
  const userCompanyId  = (session.user as any).companyId as string | undefined;
  const canManageUsers = !!(session.user as any).permissions?.canManageUsers;

  // SUPER_ADMIN, ADMIN, ou CLIENT com canManageUsers (gerente/líder)
  const isAuthorized =
    role === "SUPER_ADMIN" || role === "ADMIN" || canManageUsers;
  if (!isAuthorized) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id }, select: { companyId: true } });
  if (!target) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Não-super-admin só edita usuários da própria empresa
  if (role !== "SUPER_ADMIN" && target.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão (empresa diferente)" }, { status: 403 });
  }

  const { rankingCategory } = await req.json();
  if (rankingCategory !== "PRODUCAO" && rankingCategory !== "GESTAO") {
    return NextResponse.json({ error: "rankingCategory inválido" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id },
    data:  { rankingCategory: rankingCategory as RankingCategory },
  });

  return NextResponse.json({ ok: true });
}
