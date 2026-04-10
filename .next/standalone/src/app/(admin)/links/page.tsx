import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import LinksManager from "./LinksManager";

export default async function LinksPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session.user as any)?.companyId as string | undefined;

  // Para CLIENT: links da própria empresa
  // Para SUPER_ADMIN: todos os links
  const links = await prisma.trackingLink.findMany({
    where: isSuperAdmin ? {} : { companyId: userCompanyId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { leads: true, clickEvents: true } },
      campaign: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      clickEvents: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, targetUrl: true, targetLabel: true, createdAt: true } },
    },
  });

  const campaigns = isSuperAdmin
    ? await prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, companyId: true } })
    : await prisma.campaign.findMany({
        where: { companyId: userCompanyId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, companyId: true },
      });

  const companies = isSuperAdmin
    ? await prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } })
    : userCompanyId
    ? await prisma.company.findMany({ where: { id: userCompanyId }, select: { id: true, name: true, phone: true } })
    : [];

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const totalClicks = links.reduce((s, l) => s + l.clicks, 0);
  const totalLeads = links.reduce((s, l) => s + l._count.leads, 0);

  // Agrega cliques internos dos últimos 30 dias por dia
  const since30 = new Date();
  since30.setDate(since30.getDate() - 29);
  since30.setHours(0, 0, 0, 0);

  const allClickEvents = await prisma.clickEvent.findMany({
    where: {
      createdAt: { gte: since30 },
      trackingLink: isSuperAdmin ? {} : { companyId: userCompanyId },
    },
    select: { createdAt: true, trackingLinkId: true },
    orderBy: { createdAt: "asc" },
  });

  // Cliques por dia (internos)
  const clicksByDayMap: Record<string, number> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(since30);
    d.setDate(d.getDate() + i);
    clicksByDayMap[d.toISOString().slice(0, 10)] = 0;
  }
  allClickEvents.forEach((ev) => {
    const day = ev.createdAt.toISOString().slice(0, 10);
    if (day in clicksByDayMap) clicksByDayMap[day]++;
  });
  const clicksByDay = Object.entries(clicksByDayMap).map(([date, count]) => ({
    date: date.slice(5), // MM-DD
    internos: count,
  }));

  // Cliques por link (top 10)
  const clicksByLink = links
    .map((l) => ({
      label: l.label ?? l.code,
      cliques: l.clicks,
      internos: l._count.clickEvents,
    }))
    .sort((a, b) => b.cliques + b.internos - (a.cliques + a.internos))
    .slice(0, 10);

  return (
    <LinksManager
      isSuperAdmin={isSuperAdmin}
      initialLinks={links as any}
      campaigns={campaigns}
      companies={companies}
      defaultCompanyId={userCompanyId}
      baseUrl={baseUrl}
      totalClicks={totalClicks}
      totalLeads={totalLeads}
      clicksByDay={clicksByDay}
      clicksByLink={clicksByLink}
    />
  );

}
