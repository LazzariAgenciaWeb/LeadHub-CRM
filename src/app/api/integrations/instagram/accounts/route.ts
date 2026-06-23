import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

// GET /api/integrations/instagram/accounts?companyId=X
//
// Lista as contas IG conectadas de uma empresa (sem expor o token).
// Ferramenta interina de admin — a UI da Fase 4 substitui isso.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "instagram");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const accounts = await prisma.instagramAccount.findMany({
    where: { companyId },
    select: {
      id: true,
      igUserId: true,
      username: true,
      name: true,
      status: true,
      tokenExpiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Anexa um link pronto de desconectar pra facilitar o uso pelo navegador.
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const withLinks = accounts.map((a) => ({
    ...a,
    disconnectUrl: `${base.replace(/\/$/, "")}/api/integrations/instagram/disconnect?companyId=${companyId}&accountId=${a.id}`,
  }));

  return NextResponse.json({ companyId, count: accounts.length, accounts: withLinks });
}
