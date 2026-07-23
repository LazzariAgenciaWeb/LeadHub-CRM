/**
 * Lógica de cupons promocionais.
 *
 * Cupons são criados pelo SUPER_ADMIN e aplicados no checkout. Suportam:
 *  - Desconto em % ou valor fixo (BRL)
 *  - Recorrência: 1º pagamento (padrão) ou vitalício
 *  - Validade opcional (validFrom / validUntil)
 *  - Limite de usos opcional (maxUses)
 *  - Restrição a planos específicos (appliesToPlans)
 */

import { prisma } from "./prisma";
import type { PlanTier } from "./plans";

export interface CouponValidation {
  valid: boolean;
  reason?: string;
  coupon?: {
    id: string;
    code: string;
    discountType: "PERCENT" | "FIXED";
    discountValue: number;
    recurring: boolean;
  };
  /** Preço já com desconto aplicado (BRL). */
  discountedPrice?: number;
  /** Valor do desconto em BRL. */
  amountOff?: number;
}

/**
 * Valida um cupom pra uma empresa + plano + preço, sem consumir.
 * Use no checkout pra mostrar o preço com desconto antes de confirmar.
 */
export async function validateCoupon(
  code: string,
  opts: { companyId: string; plan: PlanTier; basePrice: number },
): Promise<CouponValidation> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { valid: false, reason: "Código vazio" };

  const coupon = await prisma.coupon.findFirst({
    where: { code: { equals: normalized, mode: "insensitive" } },
  });
  if (!coupon) return { valid: false, reason: "Cupom não encontrado" };
  if (!coupon.active) return { valid: false, reason: "Cupom inativo" };

  const now = new Date();
  if (coupon.validFrom && coupon.validFrom > now) {
    return { valid: false, reason: "Cupom ainda não está válido" };
  }
  if (coupon.validUntil && coupon.validUntil < now) {
    return { valid: false, reason: "Cupom expirado" };
  }
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, reason: "Cupom esgotado" };
  }
  if (coupon.appliesToPlans.length > 0 && !coupon.appliesToPlans.includes(opts.plan)) {
    return { valid: false, reason: "Cupom não vale pra este plano" };
  }

  // Já usado por esta empresa?
  const already = await prisma.couponRedemption.findUnique({
    where: { couponId_companyId: { couponId: coupon.id, companyId: opts.companyId } },
  });
  if (already) return { valid: false, reason: "Cupom já utilizado por esta conta" };

  // Calcula desconto
  let amountOff = 0;
  if (coupon.discountType === "PERCENT") {
    amountOff = (opts.basePrice * coupon.discountValue) / 100;
  } else {
    amountOff = coupon.discountValue;
  }
  amountOff = Math.min(amountOff, opts.basePrice); // nunca negativo
  const discountedPrice = Math.max(0, opts.basePrice - amountOff);

  return {
    valid: true,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      recurring: coupon.recurring,
    },
    discountedPrice,
    amountOff,
  };
}

/**
 * Consome o cupom (registra redemption + incrementa usedCount).
 * Chamar DEPOIS de confirmar o pagamento/checkout.
 */
export async function redeemCoupon(
  couponId: string,
  opts: { companyId: string; plan: PlanTier; amountOff: number },
): Promise<void> {
  await prisma.$transaction([
    prisma.couponRedemption.create({
      data: {
        couponId,
        companyId: opts.companyId,
        planAtApply: opts.plan,
        amountOff: opts.amountOff,
      },
    }),
    prisma.coupon.update({
      where: { id: couponId },
      data: { usedCount: { increment: 1 } },
    }),
  ]);
}
