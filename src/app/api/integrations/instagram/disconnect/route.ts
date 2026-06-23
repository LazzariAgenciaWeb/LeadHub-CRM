import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

// GET /api/integrations/instagram/disconnect?companyId=X&accountId=Y
//
// Remove uma conta IG conectada (e, por cascade, suas automações/runs).
// Ferramenta interina de admin — a UI da Fase 4 fará isso via DELETE.
// Mantido como GET pra dar pra acionar do navegador autenticado por enquanto.
//
// Segurança: exige permissão de escrita no cofre da empresa E confere que a
// conta pertence à empresa informada (não dá pra apagar conta de outra empresa).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const accountId = url.searchParams.get("accountId");
  if (!companyId || !accountId) {
    return NextResponse.json({ error: "companyId e accountId obrigatórios" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "instagram");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) {
    return NextResponse.json({ error: "Sem permissão para desconectar" }, { status: 403 });
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true, companyId: true, username: true, igUserId: true },
  });
  if (!account || account.companyId !== companyId) {
    return NextResponse.json({ error: "Conta não encontrada nesta empresa" }, { status: 404 });
  }

  await prisma.instagramAccount.delete({ where: { id: account.id } });

  return NextResponse.json({
    ok: true,
    deleted: { id: account.id, username: account.username, igUserId: account.igUserId },
  });
}
