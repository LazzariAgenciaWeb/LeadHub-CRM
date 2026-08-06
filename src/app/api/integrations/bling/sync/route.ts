import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { runBlingSync } from "@/lib/bling-sync";

// POST /api/integrations/bling/sync
//
// Dispara o sync manual ("Sincronizar agora") pra empresa da sessão. Só
// ADMIN/SUPER_ADMIN e só se a empresa tiver conexão Bling ativa.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const sessionCompanyId = (session.user as any)?.companyId as string | undefined;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // SUPER_ADMIN alveja a empresa via ?companyId=; ADMIN usa a própria.
  const queryCompanyId = new URL(req.url).searchParams.get("companyId") || undefined;
  const companyId = role === "SUPER_ADMIN" ? queryCompanyId : sessionCompanyId;
  if (!companyId) {
    return NextResponse.json({ error: "Selecione a empresa (a AZZ)." }, { status: 400 });
  }

  const integ = await prisma.blingIntegration.findUnique({
    where: { companyId },
    select: { id: true },
  });
  if (!integ) {
    return NextResponse.json({ error: "Bling não conectado para esta empresa." }, { status: 400 });
  }

  try {
    const result = await runBlingSync(companyId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Falha no sync" }, { status: 500 });
  }
}
