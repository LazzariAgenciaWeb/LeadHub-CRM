import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { backfillExceptions, effectiveFeatures, MODULES, type CompanyModuleField } from "@/lib/modules";
import { PLANS, type PlanFeatures, type PlanTier } from "@/lib/plans";

/**
 * Backfill idempotente: converte `Company.module*` em exceções explícitas.
 *
 * Roda no BOOT do container (start.sh), antes de o servidor começar a atender.
 * Sem isso, o primeiro request com o código novo já negaria módulo pra toda
 * empresa cujo acesso vinha de flag manual fora do plano — `assertModule`
 * deixou de olhar as flags e passou a usar só plano + exceções.
 *
 * É seguro rodar quantas vezes quiser: só grava onde a flag atual diverge do
 * que o plano dá, e nunca sobrescreve exceção já registrada.
 *
 * Protegido por CRON_SECRET, igual aos demais jobs internos.
 */

const FLAG_FIELDS = Array.from(
  new Set(
    MODULES.flatMap((m) => [
      ...(m.companyField ? [m.companyField] : []),
      ...(m.advanced ?? []).flatMap((a) => (a.companyField ? [a.companyField] : [])),
    ])
  )
) as CompanyModuleField[];

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  const companies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      ...Object.fromEntries(FLAG_FIELDS.map((f) => [f, true])),
      subscription: { select: { id: true, plan: true, customFeatures: true } },
    } as any,
  });

  const migrated: string[] = [];
  let unchanged = 0;

  for (const c of companies as any[]) {
    const flags: Partial<Record<CompanyModuleField, boolean>> = {};
    for (const f of FLAG_FIELDS) flags[f] = c[f] ?? undefined;

    // Empresa sem assinatura: no modelo antigo a flag ligada bastava. Cria a
    // assinatura FREE carregando o acesso de hoje como exceção.
    if (!c.subscription) {
      const next = backfillExceptions("FREE", flags, null);
      await prisma.subscription.create({
        data: {
          companyId: c.id,
          plan: "FREE",
          status: "ACTIVE",
          customFeatures: Object.keys(next).length ? (next as any) : undefined,
        },
      });
      migrated.push(`${c.name} (criou FREE, ${Object.keys(next).length} exceções)`);
      continue;
    }

    const tier = (c.subscription.plan as PlanTier) ?? "FREE";
    const custom = (c.subscription.customFeatures as Partial<PlanFeatures> | null) ?? null;
    const next = backfillExceptions(tier, flags, custom);

    if (JSON.stringify(custom ?? {}) === JSON.stringify(next)) {
      unchanged++;
      continue;
    }
    await prisma.subscription.update({
      where: { id: c.subscription.id },
      data: { customFeatures: next as any },
    });
    migrated.push(`${c.name} (${Object.keys(next).length} exceções)`);
  }

  // ── Passe 2: direito adquirido do Dashboard de Marketing ────────────────
  //
  // Até 2026-08-23 TODOS os planos incluíam marketingDashboard (Free inclusive).
  // A reorganização tirou do Free e do Essencial pra virar argumento de upgrade
  // — mas quem já usava perderia a tela no instante do deploy, sem aviso.
  //
  // Regra: empresa criada ANTES do corte mantém o que tinha, como exceção
  // explícita (aparece na aba Plano como "exceção ON", e você pode revogar caso
  // a caso quando negociar o upgrade). Empresa nova entra na regra do plano.
  const CUTOFF = new Date("2026-08-23T00:00:00Z");
  const GRANDFATHER: (keyof PlanFeatures)[] = [
    "marketingDashboard", "googleAnalytics", "googleSearchConsole", "googleBusinessProfile",
  ];

  const antigas = await prisma.company.findMany({
    where: { createdAt: { lt: CUTOFF } },
    select: { id: true, name: true, subscription: { select: { id: true, plan: true, customFeatures: true } } },
  });

  const grandfathered: string[] = [];
  for (const c of antigas) {
    if (!c.subscription) continue;
    const tier = (c.subscription.plan as PlanTier) ?? "FREE";
    const custom = (c.subscription.customFeatures as Partial<PlanFeatures> | null) ?? {};
    const eff = effectiveFeatures(tier, custom);

    const next = { ...custom };
    let mudou = false;
    for (const k of GRANDFATHER) {
      // Só concede o que o plano novo NÃO dá e que ainda não tem exceção.
      if (!eff[k] && next[k] === undefined) { (next as any)[k] = true; mudou = true; }
    }
    if (!mudou) continue;

    await prisma.subscription.update({
      where: { id: c.subscription.id },
      data: { customFeatures: next as any },
    });
    grandfathered.push(`${c.name} [${tier}]`);
  }

  // ── Passe 2b: preserva cota de IA definida na mão ───────────────────────
  //
  // `aiMonthlyQuota` virou cache derivado do limite do plano. Empresa que teve
  // a cota ajustada manualmente pelo super admin perderia o ajuste no próximo
  // save da assinatura. Divergência vira exceção em customLimits.
  const comCota = await prisma.company.findMany({
    where: { aiMonthlyQuota: { gt: 0 } },
    select: { id: true, name: true, aiMonthlyQuota: true,
              subscription: { select: { id: true, plan: true, customLimits: true } } },
  });
  let cotasPreservadas = 0;
  for (const c of comCota) {
    if (!c.subscription) continue;
    const limits = (c.subscription.customLimits as Record<string, unknown> | null) ?? {};
    if (typeof limits.aiInteractions === "number") continue; // já tem exceção
    const doPlano = PLANS[(c.subscription.plan as PlanTier) ?? "FREE"]?.limits.aiInteractions ?? 0;
    if (c.aiMonthlyQuota === doPlano) continue;

    await prisma.subscription.update({
      where: { id: c.subscription.id },
      data: { customLimits: { ...limits, aiInteractions: c.aiMonthlyQuota } as any },
    });
    cotasPreservadas++;
  }

  // ── Passe 3: limpa exceção redundante ───────────────────────────────────
  //
  // Exceção que diz a mesma coisa que o plano só polui: aparece como
  // "exceção ON" na tela pra algo que o plano já dá, e infla o contador. Isso
  // acontece naturalmente quando um módulo é promovido pra dentro do plano
  // (foi o caso do marketing orgânico entrando no Free).
  const todas = await prisma.subscription.findMany({
    select: { id: true, plan: true, customFeatures: true, company: { select: { name: true } } },
  });
  let limpas = 0;
  for (const sub of todas) {
    const custom = (sub.customFeatures as Partial<PlanFeatures> | null) ?? null;
    if (!custom || Object.keys(custom).length === 0) continue;
    const planFeatures = effectiveFeatures((sub.plan as PlanTier) ?? "FREE", null);

    const next: Partial<PlanFeatures> = {};
    for (const [k, v] of Object.entries(custom)) {
      if (planFeatures[k as keyof PlanFeatures] !== v) (next as any)[k] = v;
    }
    if (Object.keys(next).length === Object.keys(custom).length) continue;

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { customFeatures: Object.keys(next).length ? (next as any) : Prisma.JsonNull },
    });
    limpas++;
  }

  return NextResponse.json({
    ok: true,
    redundantesLimpas: limpas,
    cotasIaPreservadas: cotasPreservadas,
    total: companies.length,
    migrated: migrated.length,
    unchanged,
    details: migrated,
    grandfatheredMarketing: grandfathered.length,
    grandfatheredDetails: grandfathered,
  });
}
