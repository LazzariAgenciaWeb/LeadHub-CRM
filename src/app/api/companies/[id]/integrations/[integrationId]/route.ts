import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";

// PATCH /api/companies/[id]/integrations/[integrationId]
// Atualiza accountId/accountLabel (após o usuário escolher a propriedade GA4 / site SC).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id: companyId, integrationId } = await params;

  // fix A3 — gate de módulo marketing
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const existing = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { companyId: true, provider: true },
  });
  if (!existing || existing.companyId !== companyId) {
    return NextResponse.json({ error: "Integração não encontrada" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if ("accountId" in body) data.accountId = body.accountId || null;
  if ("accountLabel" in body) data.accountLabel = body.accountLabel || null;
  if ("nickname" in body) {
    const nick = typeof body.nickname === "string" ? body.nickname.trim() : "";
    data.nickname = nick ? nick.slice(0, 60) : null;
  }

  // Com múltiplas conexões por empresa, dá pra tentar apontar duas pro MESMO
  // recurso — o que duplicaria todo número no modo "Todas". O banco barra pelo
  // @@unique(companyId, provider, accountId), mas o erro cru do Prisma não diz
  // nada pra quem está na tela.
  if (typeof data.accountId === "string") {
    const clash = await prisma.marketingIntegration.findFirst({
      where: {
        companyId,
        provider: existing.provider,
        accountId: data.accountId,
        id: { not: integrationId },
      },
      select: { accountLabel: true, nickname: true, status: true },
    });
    if (clash) {
      const nome = clash.nickname || clash.accountLabel || "outra conexão";
      return NextResponse.json(
        {
          error: `Esta empresa já tem uma conexão apontando pra esse recurso (${nome})${
            clash.status !== "ACTIVE" ? " — está desconectada, reconecte-a em vez de criar outra." : "."
          }`,
        },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.marketingIntegration.update({
    where: { id: integrationId },
    data,
    select: {
      id: true, provider: true, accountId: true, accountLabel: true, nickname: true,
      status: true, lastSyncAt: true,
    },
  });
  return NextResponse.json({ integration: updated });
}

// DELETE /api/companies/[id]/integrations/[integrationId][?purge=1]
//
// Padrão = DESCONECTAR (soft): apaga os tokens e marca DISCONNECTED, mantendo a
// linha. Não é preciosismo — é o que mantém o histórico correto agora que cada
// linha de dado carrega o `integrationId` que a gerou:
//
//   - hard delete deixaria os dados apontando pra um id morto. Reconectar a
//     MESMA propriedade criaria um id novo, e os mesmos dias apareceriam DUAS
//     vezes no modo "Todas" (antes isso não acontecia porque o upsert era por
//     companyId e simplesmente sobrescrevia);
//   - mantendo a linha, o callback do OAuth reencontra e revive a conexão —
//     mesmo id, mesmos dados, sem duplicata.
//
// ?purge=1 é a saída explícita pra quem quer sumir com tudo: apaga a conexão E
// o histórico sincronizado por ela.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id: companyId, integrationId } = await params;

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const existing = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { companyId: true },
  });
  if (!existing || existing.companyId !== companyId) {
    return NextResponse.json({ error: "Integração não encontrada" }, { status: 404 });
  }

  const purge = new URL(req.url).searchParams.get("purge") === "1";

  if (!purge) {
    await prisma.marketingIntegration.update({
      where: { id: integrationId },
      data: {
        status: "DISCONNECTED",
        accessTokenEnc: null,
        refreshTokenEnc: null,
        tokenExpiresAt: null,
        lastError: null,
      },
    });
    return NextResponse.json({ ok: true, mode: "disconnected" });
  }

  // Purga: histórico primeiro, conexão depois. Se algo falhar no meio, sobra
  // conexão sem dados (recuperável com um sync) e não dado órfão invisível.
  const scope = { companyId, integrationId };
  const purged = await prisma.$transaction([
    prisma.analyticsSnapshot.deleteMany({ where: scope }),
    prisma.analyticsTopPage.deleteMany({ where: scope }),
    prisma.analyticsTrafficSource.deleteMany({ where: scope }),
    prisma.analyticsGeoData.deleteMany({ where: scope }),
    prisma.analyticsEventDaily.deleteMany({ where: scope }),
    prisma.analyticsEventParamDaily.deleteMany({ where: scope }),
    prisma.searchConsoleQuery.deleteMany({ where: scope }),
    prisma.gbpInsight.deleteMany({ where: scope }),
    prisma.gbpReview.deleteMany({ where: scope }),
    prisma.gbpSearchKeyword.deleteMany({ where: scope }),
    prisma.gbpProfileSnapshot.deleteMany({ where: scope }),
    prisma.marketingIntegration.delete({ where: { id: integrationId } }),
  ]);

  const rowsDeleted = purged
    .slice(0, -1)
    .reduce((sum, r) => sum + (r as { count: number }).count, 0);

  return NextResponse.json({ ok: true, mode: "purged", rowsDeleted });
}
