import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// PUT /api/financeiro/meta
// Body: { month: "YYYY-MM", revenueTargetCents, newSalesTargetCents }
//
// A meta é da AGÊNCIA (a empresa da sessão), nunca de um cliente dela — por
// isso o companyId vem da sessão e não do corpo: quem edita só consegue editar
// a própria meta, sem gate extra.
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const companyId = (session.user as any)?.companyId as string | undefined;
  if (!companyId) {
    return NextResponse.json(
      { error: "Meta é definida por agência. Esta sessão não está vinculada a uma empresa." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Competência inválida (use YYYY-MM)" }, { status: 400 });
  }

  const toCents = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const revenueTargetCents = toCents(body?.revenueTargetCents);
  const newSalesTargetCents = toCents(body?.newSalesTargetCents);

  const saved = await prisma.monthlyTarget.upsert({
    where: { companyId_month: { companyId, month } },
    create: { companyId, month, revenueTargetCents, newSalesTargetCents },
    update: { revenueTargetCents, newSalesTargetCents },
  });

  return NextResponse.json(saved);
}
