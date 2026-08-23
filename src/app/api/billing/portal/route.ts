import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/billing/portal
 *
 * Abre o Portal de Cobrança da Stripe: trocar cartão, ver faturas, baixar
 * recibo, cancelar. Tudo isso hospedado pela Stripe — não recriamos essas telas
 * (e não tocamos em dado de cartão).
 *
 * O cancelamento feito lá chega de volta por webhook
 * (customer.subscription.deleted → status CANCELED), então o sistema não
 * precisa de nenhum fluxo próprio de cancelamento.
 */
export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = session.user as any;
  const companyId = user?.companyId as string | undefined;
  const role = user?.role as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sessão sem empresa" }, { status: 400 });
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Só o administrador da empresa acessa a cobrança" }, { status: 403 });
  }

  const sub = await prisma.subscription.findUnique({
    where: { companyId },
    select: { stripeCustomerId: true },
  });

  if (!sub?.stripeCustomerId) {
    return NextResponse.json(
      { error: "Esta empresa ainda não tem assinatura paga na Stripe." },
      { status: 400 }
    );
  }

  const base = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

  try {
    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${base}/configuracoes?secao=minha-empresa-plano`,
      locale: "pt-BR",
    });
    return NextResponse.json({ url: portal.url });
  } catch (e: any) {
    console.error("[Stripe portal]", e?.message);
    return NextResponse.json({ error: e?.message ?? "Falha ao abrir o portal" }, { status: 500 });
  }
}
