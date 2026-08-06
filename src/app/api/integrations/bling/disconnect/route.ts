import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// POST /api/integrations/bling/disconnect
//
// Desconecta o Bling da empresa: apaga os tokens e marca DISCONNECTED. Não
// mexe nos vínculos já criados (Company.blingContactId / faturas importadas) —
// reconectar volta a sincronizar por cima.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const sessionCompanyId = (session.user as any)?.companyId as string | undefined;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const queryCompanyId = new URL(req.url).searchParams.get("companyId") || undefined;
  const companyId = role === "SUPER_ADMIN" ? queryCompanyId : sessionCompanyId;
  if (!companyId) {
    return NextResponse.json({ error: "Selecione a empresa." }, { status: 400 });
  }

  await prisma.blingIntegration.updateMany({
    where: { companyId },
    data: {
      status: "DISCONNECTED",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
    },
  });

  return NextResponse.json({ ok: true });
}
