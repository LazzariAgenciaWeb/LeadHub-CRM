import { prisma } from "@/lib/prisma";
import { getCompanyPlan } from "@/lib/limits";
import { bioPublicUrl } from "@/lib/bio-page-server";
import { bioShowsBadge, referrerLabel, visibleLeadCount } from "@/lib/bio-page";

// Números da Página do Negócio. Dois recortes, por decisão de produto:
//   - cliente do grátis: totais do mês + nome/telefone dos contatos até o
//     limite do plano (o excedente vira "+X contatos");
//   - admins da agência (e o Starter): o detalhe — funil, cliques por botão,
//     origem e as respostas de cada contato.

export function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  return d;
}

/**
 * Quem respondeu perguntas e não deixou contato (salvo etapa a etapa). Só
 * respostas — é anônimo.
 */
async function partialAnswers(pageId: string, since: Date) {
  const rows = await prisma.bioProgress.findMany({
    where: { pageId, convertedAt: null, updatedAt: { gte: since } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, answers: true, reachedForm: true, updatedAt: true, referrer: true, utmSource: true },
  });
  return rows
    .map((r) => ({
      id: r.id,
      answers: r.answers as { question: string; answer: string }[],
      reachedForm: r.reachedForm,
      updatedAt: r.updatedAt.toISOString(),
      origin: r.utmSource ? `utm: ${r.utmSource}` : referrerLabel(r.referrer),
    }))
    .filter((r) => r.answers.length > 0);
}

export type PartialAnswer = Awaited<ReturnType<typeof partialAnswers>>[number];

async function eventCounts(pageId: string, since: Date) {
  const rows = await prisma.bioEvent.groupBy({
    by: ["kind"],
    where: { pageId, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const by = Object.fromEntries(rows.map((r) => [r.kind, r._count._all])) as Partial<Record<string, number>>;
  return {
    views: by.VIEW ?? 0,
    clicks: by.CLICK ?? 0,
    quizStarts: by.QUIZ_START ?? 0,
    quizCompletes: by.QUIZ_COMPLETE ?? 0,
    leads: by.LEAD ?? 0,
  };
}

/**
 * O que o dono da página vê. `detailed` = plano pago (vê também as respostas).
 * `asAdmin`: quem olha é admin da agência (inclusive visualizando como
 * cliente) — vê tudo, sem o recorte do plano.
 */
export async function getOwnerSummary(companyId: string, pageId: string, { asAdmin = false } = {}) {
  const since = startOfMonth();
  const ctx = await getCompanyPlan(companyId);
  const limit = asAdmin ? -1 : ctx.effectiveLimits.leadsPerMonth;
  // Detalhe (respostas) é de plano pago — mesma régua do selo.
  const paid = !bioShowsBadge(ctx.tier);
  const detailed = paid || asAdmin;

  const [counts, contacts, partials] = await Promise.all([
    eventCounts(pageId, since),
    // Os primeiros do mês ficam visíveis; os que passam do limite, só no total.
    prisma.bioSubmission.findMany({
      where: { pageId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, phone: true, email: detailed, social: detailed, createdAt: true, answers: detailed },
    }),
    detailed ? partialAnswers(pageId, since) : Promise.resolve([]),
  ]);
  const { visible, hidden } = visibleLeadCount(contacts.length, limit);

  return {
    since: since.toISOString(),
    // Nome do mês no fuso do servidor, o mesmo que fez o corte — formatar a
    // data no navegador (fuso -3h) mostrava o mês anterior.
    monthLabel: new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(since),
    detailed,
    adminView: asAdmin && !paid,
    views: counts.views,
    clicks: counts.clicks,
    contactsTotal: contacts.length,
    hidden,
    partials,
    contacts: contacts
      .slice(0, visible)
      .reverse()
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        // E-mail vai junto do detalhe (plano pago ou admin); grátis vê nome e telefone.
        email: detailed ? (c.email ?? null) : null,
        social: detailed ? (c.social ?? null) : null,
        createdAt: c.createdAt.toISOString(),
        answers: detailed ? (c.answers as { question: string; answer: string }[]) : null,
      })),
  };
}

export type OwnerSummary = Awaited<ReturnType<typeof getOwnerSummary>>;

/** Lista de todas as páginas com números dos últimos 30 dias (painel da agência). */
export async function getAdminOverview() {
  const since = daysAgo(30);
  const pages = await prisma.bioPage.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, slug: true, title: true, published: true, createdAt: true,
      company: { select: { id: true, name: true, tradeName: true, subscription: { select: { plan: true } } } },
      referredBy: { select: { slug: true } },
      _count: { select: { referrals: true } },
    },
  });
  const [views, leads, leadsAll] = await Promise.all([
    prisma.bioEvent.groupBy({ by: ["pageId"], where: { kind: "VIEW", createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.bioSubmission.groupBy({ by: ["pageId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.bioSubmission.groupBy({ by: ["pageId"], _count: { _all: true } }),
  ]);
  const map = (rows: { pageId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.pageId, r._count._all]));
  const v = map(views), l = map(leads), la = map(leadsAll);

  return pages.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    company: p.company.tradeName ?? p.company.name,
    companyId: p.company.id,
    plan: p.company.subscription?.plan ?? null,
    published: p.published,
    createdAt: p.createdAt.toISOString(),
    referredBy: p.referredBy?.slug ?? null,
    referrals: p._count.referrals,
    views30: v.get(p.id) ?? 0,
    leads30: l.get(p.id) ?? 0,
    leadsAll: la.get(p.id) ?? 0,
  }));
}

/** Detalhe de uma página: funil, cliques por botão, origem e contatos com respostas. */
export async function getPageDetail(pageId: string, days = 30) {
  const since = daysAgo(days);
  const page = await prisma.bioPage.findUnique({
    where: { id: pageId },
    select: {
      id: true, slug: true, title: true, published: true,
      company: { select: { name: true, tradeName: true, subscription: { select: { plan: true } } } },
      referrals: { select: { slug: true, title: true, createdAt: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!page) return null;

  const [funnel, clicks, origins, submissions, partials] = await Promise.all([
    eventCounts(pageId, since),
    prisma.bioEvent.groupBy({
      by: ["targetLabel"],
      where: { pageId, kind: "CLICK", createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { targetLabel: "desc" } },
    }),
    prisma.bioEvent.findMany({
      where: { pageId, kind: "VIEW", createdAt: { gte: since } },
      select: { referrer: true, utmSource: true },
    }),
    prisma.bioSubmission.findMany({
      where: { pageId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, name: true, phone: true, email: true, social: true, answers: true, createdAt: true,
        referrer: true, utmSource: true, utmCampaign: true,
      },
    }),
    partialAnswers(pageId, since),
  ]);

  // Origem: UTM manda (o dono marcou o link); sem UTM, o domínio do referrer.
  const originCount = new Map<string, number>();
  for (const o of origins) {
    const key = o.utmSource ? `utm: ${o.utmSource}` : referrerLabel(o.referrer);
    originCount.set(key, (originCount.get(key) ?? 0) + 1);
  }
  // Mesma chave nos contatos, pra cruzar visitas × conversões por origem.
  const contactCount = new Map<string, number>();
  for (const s of submissions) {
    const key = s.utmSource ? `utm: ${s.utmSource}` : referrerLabel(s.referrer);
    contactCount.set(key, (contactCount.get(key) ?? 0) + 1);
  }
  const conversionByOrigin = [...new Set([...originCount.keys(), ...contactCount.keys()])]
    .map((label) => ({ label, views: originCount.get(label) ?? 0, contacts: contactCount.get(label) ?? 0 }))
    .sort((a, b) => b.contacts - a.contacts || b.views - a.views);

  return {
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      published: page.published,
      company: page.company.tradeName ?? page.company.name,
      plan: page.company.subscription?.plan ?? null,
    },
    days,
    funnel,
    clicks: clicks.map((c) => ({ label: c.targetLabel ?? "(item apagado)", count: c._count._all })),
    origins: [...originCount.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    conversionByOrigin,
    partials,
    referrals: page.referrals.map((r) => ({ slug: r.slug, title: r.title, createdAt: r.createdAt.toISOString() })),
    submissions: submissions.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      email: s.email,
      social: s.social,
      createdAt: s.createdAt.toISOString(),
      origin: s.utmSource ? `utm: ${s.utmSource}${s.utmCampaign ? ` / ${s.utmCampaign}` : ""}` : referrerLabel(s.referrer),
      answers: s.answers as { question: string; answer: string }[],
    })),
  };
}

export type PageDetail = NonNullable<Awaited<ReturnType<typeof getPageDetail>>>;

/**
 * Bloco "Página do Negócio" dentro do relatório de marketing. `detailed`
 * decide se vão origem e cliques por botão (agência sempre; cliente só em
 * plano pago). Respostas dos contatos nunca entram aqui — o relatório é de
 * desempenho, não de lista de contatos.
 */
export async function getPageMarketingStats(companyId: string, days: number, viewerIsClient: boolean) {
  const page = await prisma.bioPage.findUnique({
    where: { companyId },
    select: { id: true, slug: true, title: true, published: true },
  });
  const ctx = await getCompanyPlan(companyId).catch(() => null);
  const paid = !!ctx && !bioShowsBadge(ctx.tier);
  if (!page) return { hasPage: false as const, paid };

  const detailed = !viewerIsClient || paid;
  const since = daysAgo(days);
  const [totals, detail] = await Promise.all([
    eventCounts(page.id, since),
    detailed ? getPageDetail(page.id, days) : Promise.resolve(null),
  ]);
  return {
    hasPage: true as const,
    paid,
    page: { slug: page.slug, title: page.title, published: page.published, url: bioPublicUrl(page.slug) },
    totals,
    detailed,
    clicks: detail?.clicks ?? [],
    origins: detail?.origins ?? [],
  };
}

export type PageMarketingStats = Awaited<ReturnType<typeof getPageMarketingStats>>;
