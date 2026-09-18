import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";

// GET /api/companies/[id]/integrations
// Lista integrações da empresa (sem expor tokens).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;

  // fix A3 — gate de módulo marketing (integrações fazem parte do dashboard)
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const integrations = await prisma.marketingIntegration.findMany({
    where: { companyId },
    orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, provider: true, accountId: true, accountLabel: true, nickname: true,
      scopes: true, googleEmail: true, googleName: true,
      status: true, lastSyncAt: true, lastSyncStatus: true, lastError: true,
      tokenExpiresAt: true, createdAt: true,
    },
  });

  return NextResponse.json({ integrations, canWrite: auth.canWrite });
}

// POST /api/companies/[id]/integrations
// body: { provider, fromIntegrationId }
//
// Cria uma SEGUNDA conexão do mesmo provider reaproveitando a autorização que
// já existe. É o caminho do caso comum — uma conta Google que administra duas
// propriedades GA4 (site institucional + loja), dois sites no Search Console ou
// duas unidades no Meu Negócio.
//
// Sem isso não dava pra adicionar a segunda: refazer o OAuth com a MESMA conta
// Google cai no ramo de renovação do callback (`sameAccount`), que atualiza os
// tokens da conexão existente e não cria registro novo — de propósito, senão
// toda reconexão viraria duplicata. Pra outra conta Google, o fluxo continua
// sendo /api/integrations/google/connect.
//
// A conexão nasce sem accountId; a tela abre o seletor de propriedade em seguida.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const fromIntegrationId = typeof body.fromIntegrationId === "string" ? body.fromIntegrationId : null;
  if (!fromIntegrationId) {
    return NextResponse.json({ error: "fromIntegrationId é obrigatório" }, { status: 400 });
  }

  const source = await prisma.marketingIntegration.findUnique({
    where: { id: fromIntegrationId },
    select: {
      companyId: true, provider: true, scopes: true,
      accessTokenEnc: true, refreshTokenEnc: true, tokenExpiresAt: true,
      googleEmail: true, googleName: true, status: true,
    },
  });
  if (!source || source.companyId !== companyId) {
    return NextResponse.json({ error: "Conexão de origem não encontrada" }, { status: 404 });
  }
  if (source.status !== "ACTIVE" || !source.refreshTokenEnc) {
    return NextResponse.json(
      { error: "A conexão de origem não está ativa. Reconecte-a antes de adicionar outra propriedade." },
      { status: 409 }
    );
  }

  // Já existe uma conexão deste provider esperando seleção de propriedade —
  // criar outra só encheria a tela de linhas "⚠️ selecione a propriedade".
  const pending = await prisma.marketingIntegration.findFirst({
    where: { companyId, provider: source.provider, accountId: null },
    select: { id: true },
  });
  if (pending) {
    return NextResponse.json({ integration: { id: pending.id }, reused: true });
  }

  const created = await prisma.marketingIntegration.create({
    data: {
      companyId,
      provider: source.provider,
      accountId: null,
      // Tokens são copiados ainda cifrados — nada é decifrado aqui. As duas
      // conexões compartilham o mesmo consentimento Google, e cada uma renova
      // o próprio access token pelo refresh (ver src/lib/google/token.ts).
      accessTokenEnc: source.accessTokenEnc,
      refreshTokenEnc: source.refreshTokenEnc,
      tokenExpiresAt: source.tokenExpiresAt,
      scopes: source.scopes,
      googleEmail: source.googleEmail,
      googleName: source.googleName,
      status: "ACTIVE",
      createdById: auth.userId,
    },
    select: { id: true, provider: true, googleEmail: true },
  });

  return NextResponse.json({ integration: created, reused: false });
}
