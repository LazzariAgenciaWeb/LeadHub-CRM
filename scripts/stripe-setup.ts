/**
 * Cria (ou atualiza) os produtos e preços dos planos na conta Stripe.
 *
 * Lê `STRIPE_SECRET_KEY` do ambiente — a chave nunca passa por argumento nem
 * fica no repositório. Use a chave de TESTE (sk_test_…) primeiro.
 *
 * Idempotente: cada preço tem um `lookup_key` fixo (ex: leadhub_marketing_monthly).
 * Rodar de novo não duplica nada. Se o valor no plans.ts mudou, o script cria um
 * preço novo (preço na Stripe é imutável), transfere o lookup_key e ARQUIVA o
 * antigo — quem já assinava continua no preço velho, que é o comportamento
 * correto pra não reajustar cliente sem avisar.
 *
 * Uso:
 *   npx tsx scripts/stripe-setup.ts           # mostra o que faria
 *   npx tsx scripts/stripe-setup.ts --apply   # cria de verdade
 *
 * No fim ele imprime as linhas de env prontas pra colar no Portainer.
 */

import Stripe from "stripe";
import { PLANS, PLAN_ORDER, type PlanTier } from "../src/lib/plans";

const APPLY = process.argv.includes("--apply");

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("erro: STRIPE_SECRET_KEY não está no ambiente.");
  console.error('  export STRIPE_SECRET_KEY="sk_test_…"  (ou põe no .env e roda com dotenv)');
  process.exit(1);
}
const stripe = new Stripe(key, { apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion });

const MODE = key.startsWith("sk_live_") ? "AO VIVO ⚠️" : "TESTE";

/** reais → centavos, sem erro de ponto flutuante (49.9 * 100 = 4989.999…). */
function cents(v: number): number {
  return Math.round(v * 100);
}

interface Result { tier: PlanTier; monthly: string; annual: string }

async function upsertPrice(
  productId: string,
  lookupKey: string,
  unitAmount: number,
  interval: "month" | "year",
): Promise<string> {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const existing = found.data[0];

  if (existing) {
    if (existing.unit_amount === unitAmount && existing.currency === "brl") {
      console.log(`      = ${lookupKey} já existe (${existing.id})`);
      return existing.id;
    }
    console.log(
      `      ~ ${lookupKey} mudou de ${(existing.unit_amount ?? 0) / 100} para ${unitAmount / 100}` +
        ` — cria novo e arquiva o antigo (${existing.id})`
    );
    if (!APPLY) return "(novo)";
    const created = await stripe.prices.create({
      product: productId,
      currency: "brl",
      unit_amount: unitAmount,
      recurring: { interval },
      lookup_key: lookupKey,
      transfer_lookup_key: true,
    });
    await stripe.prices.update(existing.id, { active: false });
    return created.id;
  }

  console.log(`      + ${lookupKey} — R$ ${(unitAmount / 100).toFixed(2)} / ${interval === "month" ? "mês" : "ano"}`);
  if (!APPLY) return "(novo)";
  const created = await stripe.prices.create({
    product: productId,
    currency: "brl",
    unit_amount: unitAmount,
    recurring: { interval },
    lookup_key: lookupKey,
  });
  return created.id;
}

async function main() {
  console.log(`Conta em modo: ${MODE}`);
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN (nada é criado)"}\n`);

  // FREE não vira produto: não há cobrança.
  const paid = PLAN_ORDER.filter((t) => t !== "FREE" && PLANS[t].priceMonthly > 0);
  const results: Result[] = [];

  for (const tier of paid) {
    const plan = PLANS[tier];
    const slug = tier.toLowerCase();
    console.log(`· ${plan.label} (${tier})`);

    // Produto: procura por metadata.tier pra não duplicar entre execuções.
    const search = await stripe.products.search({ query: `metadata['tier']:'${tier}'`, limit: 1 });
    let productId = search.data[0]?.id;

    if (productId) {
      console.log(`      = produto já existe (${productId})`);
    } else {
      console.log(`      + produto "LeadHub ${plan.label}"`);
      productId = APPLY
        ? (await stripe.products.create({
            name: `LeadHub ${plan.label}`,
            description: plan.tagline,
            metadata: { tier },
          })).id
        : "(novo)";
    }

    const monthly = productId === "(novo)" && !APPLY
      ? "(novo)"
      : await upsertPrice(productId, `leadhub_${slug}_monthly`, cents(plan.priceMonthly), "month");

    // Anual cobra o TOTAL do ano de uma vez (priceAnnualPerMonth é só a vitrine).
    const annual = productId === "(novo)" && !APPLY
      ? "(novo)"
      : await upsertPrice(productId, `leadhub_${slug}_annual`, cents(plan.priceAnnualTotal), "year");

    results.push({ tier, monthly, annual });
    console.log("");
  }

  if (!APPLY) {
    console.log("Nada foi criado. Rode de novo com --apply.");
    return;
  }

  console.log("─".repeat(60));
  console.log("Envs pra colar no Portainer:\n");
  for (const r of results) {
    console.log(`STRIPE_PRICE_${r.tier}_MONTHLY: "${r.monthly}"`);
    console.log(`STRIPE_PRICE_${r.tier}_ANNUAL: "${r.annual}"`);
  }
  console.log(`\nFaltam ainda STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET.`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
