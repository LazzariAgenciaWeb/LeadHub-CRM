import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PLANS, PLAN_ORDER, type PlanTier } from "@/lib/plans";

/**
 * POST /api/billing/checkout
 *   body: { tier: "MARKETING", cycle: "monthly" | "annual", coupon?: "..." }
 *
 * Cria a sessão de Checkout hospedada da Stripe e devolve a URL. Hospedado, e
 * não formulário próprio, porque assim nenhum dado de cartão passa pelo nosso
 * servidor — o escopo de PCI fica com a Stripe.
 *
 * O `metadata.companyId` é o que amarra o pagamento à empresa: é por ele que o
 * webhook encontra quem assinou (ver handleSubscriptionUpsert). Sem ele o
 * pagamento entra na Stripe e não vira plano aqui dentro.
 *
 * Reusa o `stripeCustomerId` quando a empresa já tem — evita criar cliente
 * duplicado na Stripe a cada tentativa de assinatura.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = session.user as any;
  const companyId = user?.companyId as string | undefined;
  const role = user?.role as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sessão sem empresa" }, { status: 400 });
  // Assinar é decisão de dono: atendente não contrata plano.
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Só o administrador da empresa pode contratar" }, { status: 403 });
  }

  let body: { tier?: string; cycle?: string; coupon?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tier = String(body.tier ?? "").toUpperCase() as PlanTier;
  const cycle = body.cycle === "annual" ? "annual" : "monthly";

  if (!PLAN_ORDER.includes(tier) || tier === "FREE") {
    return NextResponse.json({ error: "Plano inválido para contratação" }, { status: 400 });
  }

  const priceId = process.env[`STRIPE_PRICE_${tier}_${cycle === "annual" ? "ANNUAL" : "MONTHLY"}`];
  if (!priceId) {
    return NextResponse.json(
      { error: `Preço do plano ${tier} (${cycle}) não configurado. Rode scripts/stripe-setup.ts e preencha as envs.` },
      { status: 503 }
    );
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, email: true, subscription: { select: { stripeCustomerId: true } } },
  });
  if (!company) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });

  const base = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

  try {
    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // Cliente existente é reusado; senão a Stripe cria e o webhook grava o id.
      ...(company.subscription?.stripeCustomerId
        ? { customer: company.subscription.stripeCustomerId }
        : { customer_email: company.email ?? user.email ?? undefined }),
      // Vai no metadata da SESSÃO e da ASSINATURA: o webhook lê o da assinatura.
      metadata: { companyId },
      subscription_data: { metadata: { companyId } },
      ...(body.coupon ? { discounts: [{ coupon: body.coupon }] } : { allow_promotion_codes: true }),
      success_url: `${base}/configuracoes?secao=minha-empresa-plano&assinatura=ok`,
      cancel_url: `${base}/precos?assinatura=cancelada`,
      locale: "pt-BR",
    });

    return NextResponse.json({ url: checkout.url, plan: PLANS[tier].label });
  } catch (e: any) {
    console.error("[Stripe checkout]", e?.message);
    return NextResponse.json({ error: e?.message ?? "Falha ao criar checkout" }, { status: 500 });
  }
}
