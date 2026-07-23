import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { validateCoupon } from "@/lib/coupons";
import { PLANS, type PlanTier } from "@/lib/plans";

// POST /api/billing/validate-coupon  body: { code, plan, cycle }
// Retorna o preço com desconto (sem consumir o cupom). Usado no checkout.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const code = String(body.code || "");
  const plan = body.plan as PlanTier;
  const cycle = body.cycle === "annual" ? "annual" : "monthly";

  if (!PLANS[plan]) return NextResponse.json({ error: "plano inválido" }, { status: 400 });

  const basePrice = cycle === "annual"
    ? PLANS[plan].priceAnnualPerMonth
    : PLANS[plan].priceMonthly;

  const result = await validateCoupon(code, { companyId, plan, basePrice });
  return NextResponse.json(result);
}
