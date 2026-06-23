import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/integrations/instagram/admin/accounts
//
// Lista TODAS as contas IG conectadas, de TODAS as empresas. Apenas SUPER_ADMIN.
// Usa a sessão REAL (getServerSession), então impersonação não interfere.
// Ferramenta de diagnóstico/admin — útil pra achar onde uma conexão foi parar.
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const accounts = await prisma.instagramAccount.findMany({
    select: {
      id: true,
      igUserId: true,
      username: true,
      name: true,
      status: true,
      tokenExpiresAt: true,
      createdAt: true,
      companyId: true,
      company: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const out = accounts.map((a) => ({
    id: a.id,
    username: a.username,
    igUserId: a.igUserId,
    status: a.status,
    companyId: a.companyId,
    companyName: a.company?.name ?? null,
    createdAt: a.createdAt,
    disconnectUrl: `${base.replace(/\/$/, "")}/api/integrations/instagram/disconnect?companyId=${a.companyId}&accountId=${a.id}`,
  }));

  return NextResponse.json({ count: out.length, accounts: out });
}
