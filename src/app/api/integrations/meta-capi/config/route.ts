import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

// Resolve a empresa-alvo: SUPER_ADMIN pode mirar outra via ?companyId= / body;
// demais usuários só configuram a própria empresa.
function resolveCompanyId(session: any, override?: string | null): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return override || session.user.companyId || null;
  return session.user.companyId || null;
}

// GET /api/integrations/meta-capi/config?companyId=  → config sem expor o token
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = resolveCompanyId(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json(null);

  const cfg = await prisma.metaConversionConfig.findUnique({
    where: { companyId },
    select: {
      pixelId: true, testEventCode: true, eventName: true, currency: true,
      enabled: true, lastEventAt: true, lastStatus: true,
      // accessTokenEnc NUNCA é retornado
    },
  });
  return NextResponse.json(cfg ? { ...cfg, hasToken: true } : null);
}

// PUT /api/integrations/meta-capi/config  → cria/atualiza a config
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const companyId = resolveCompanyId(session, body?.companyId);
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const { pixelId, accessToken, testEventCode, eventName, currency, enabled } = body;

  if (!pixelId || !String(pixelId).trim()) {
    return NextResponse.json({ error: "pixelId é obrigatório" }, { status: 400 });
  }
  if (!/^\d{5,}$/.test(String(pixelId).trim())) {
    return NextResponse.json({ error: "pixelId deve ser numérico (ID do Pixel/Dataset)" }, { status: 400 });
  }

  const existing = await prisma.metaConversionConfig.findUnique({ where: { companyId } });
  // Token só é obrigatório na criação; no update, mantém o atual se vier vazio.
  if (!existing && (!accessToken || !String(accessToken).trim())) {
    return NextResponse.json({ error: "Token CAPI é obrigatório na primeira configuração" }, { status: 400 });
  }

  const data: any = {
    pixelId: String(pixelId).trim(),
    testEventCode: testEventCode?.trim() || null,
    eventName: (eventName && String(eventName).trim()) || "Purchase",
    currency: (currency && String(currency).trim()) || "BRL",
    enabled: enabled !== false,
  };
  if (accessToken && String(accessToken).trim()) {
    data.accessTokenEnc = encryptSecret(String(accessToken).trim());
  }

  await prisma.metaConversionConfig.upsert({
    where: { companyId },
    create: { companyId, accessTokenEnc: data.accessTokenEnc ?? "", ...data },
    update: data,
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/integrations/meta-capi/config?companyId=  → desconecta
export async function DELETE(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = resolveCompanyId(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  await prisma.metaConversionConfig.deleteMany({ where: { companyId } });
  return NextResponse.json({ ok: true });
}
