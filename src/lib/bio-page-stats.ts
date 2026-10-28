import { prisma } from "@/lib/prisma";
import { getCompanyPlan } from "@/lib/limits";
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

/** O que o dono da página vê. `detailed` = plano pago (vê também as respostas). */
export async function getOwnerSummary(companyId: string, pageId: string) {
  const since = startOfMonth();
  const ctx = await getCompanyPlan(companyId);
  const limit = ctx.effectiveLimits.leadsPerMonth;
  // Detalhe (respostas) é de plano pago — mesma régua do selo.
  const detailed = !bioShowsBadge(ctx.tier);

  const [counts, contacts] = await Promise.all([
    eventCounts(pageId, since),
    // Os primeiros do mês ficam visíveis; os que passam do limite, só no total.
    prisma.bioSubmission.findMany({
      where: { pageId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, phone: true, createdAt: true, answers: detailed },
    }),
  ]);
  const { visible, hidden } = visibleLeadCount(contacts.length, limit);

  return {
    since: since.toISOString(),
    detailed,
    views: counts.views,
    clicks: counts.clicks,
    contactsTotal: contacts.length,
    hidden,
    contacts: contacts
      .slice(0, visible)
      .reverse()
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
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

  const [funnel, clicks, origins, submissions] = await Promise.all([
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
        id: true, name: true, phone: true, email: true, answers: true, createdAt: true,
        referrer: true, utmSource: true, utmCampaign: true,
      },
    }),
  ]);

  // Origem: UTM manda (o dono marcou o link); sem UTM, o domínio do referrer.
  const originCount = new Map<string, number>();
  for (const o of origins) {
    const key = o.utmSource ? `utm: ${o.utmSource}` : referrerLabel(o.referrer);
    originCount.set(key, (originCount.get(key) ?? 0) + 1);
  }

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
    referrals: page.referrals.map((r) => ({ slug: r.slug, title: r.title, createdAt: r.createdAt.toISOString() })),
    submissions: submissions.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      email: s.email,
      createdAt: s.createdAt.toISOString(),
      origin: s.utmSource ? `utm: ${s.utmSource}${s.utmCampaign ? ` / ${s.utmCampaign}` : ""}` : referrerLabel(s.referrer),
      answers: s.answers as { question: string; answer: string }[],
    })),
  };
}

export type PageDetail = NonNullable<Awaited<ReturnType<typeof getPageDetail>>>;
