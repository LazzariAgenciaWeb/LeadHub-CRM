import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { dayKeyInTZ, monthRangeUTC, parseYm } from "@/lib/ponto";

// POST /api/ponto/sign — colaborador assina eletronicamente o próprio espelho
// do mês. Body: { ym: "2026-08" }. A assinatura registra quem/quando/IP e sai
// impressa no espelho. Se um ajuste for aprovado depois, ela é invalidada
// automaticamente (ver /api/ponto/adjustments/[id]).
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const { year, month } = parseYm(body?.ym as string | undefined);

  const todayKey = dayKeyInTZ(new Date());
  const ymKey = `${year}-${String(month).padStart(2, "0")}`;
  if (ymKey > todayKey.slice(0, 7)) {
    return NextResponse.json({ error: "Não dá pra assinar um mês futuro" }, { status: 400 });
  }

  // Ajuste pendente do mês trava a assinatura — resolve primeiro, assina depois
  const pending = await prisma.punchAdjustRequest.count({
    where: {
      userId,
      status: "PENDENTE",
      date: monthRangeUTC(year, month),
    },
  });
  if (pending > 0) {
    return NextResponse.json(
      { error: "Você tem solicitação de ajuste pendente neste mês — aguarde a revisão antes de assinar" },
      { status: 409 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  const signature = await prisma.timesheetSignature.upsert({
    where: { userId_year_month: { userId, year, month } },
    create: { companyId, userId, year, month, ip },
    update: { signedAt: new Date(), ip },
  });

  return NextResponse.json({ ok: true, signature });
}
