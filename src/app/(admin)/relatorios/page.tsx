import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import RelatoriosDashboard from "./RelatoriosDashboard";

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const days = Math.min(parseInt(sp.days ?? "30"), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const companyFilter = isSuperAdmin ? {} : { companyId: userCompanyId };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function buildDays<T>(defaultVal: () => T): Record<string, T> {
    const map: Record<string, T> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      map[d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })] = defaultVal();
    }
    return map;
  }
  const dk = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  // ── Leads do período ────────────────────────────────────────────────────────
  const leads = await prisma.lead.findMany({
    where: { ...companyFilter, createdAt: { gte: since } },
    select: {
      id: true, status: true, createdAt: true, companyId: true,
      pipeline: true, campaignId: true,
      campaign: { select: { name: true } },
      company:  { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // ── CRM por dia (3 pipelines) ─────────────────────────────────────────────
  const crmMap = buildDays(() => ({ prospeccao: 0, leads: 0, oportunidades: 0 }));
  for (const l of leads) {
    const key = dk(new Date(l.createdAt));
    if (!crmMap[key]) continue;
    if      (l.pipeline === "PROSPECCAO")    crmMap[key].prospeccao++;
    else if (l.pipeline === "OPORTUNIDADES") crmMap[key].oportunidades++;
    else                                     crmMap[key].leads++; // LEADS ou null
  }
  const crmPerDay = Object.entries(crmMap).map(([date, v]) => ({ date, ...v }));

  // ── Funil de conversão (totais all-time) ──────────────────────────────────
  const [prospeccaoAll, leadsAll, opAll, fechadosAll] = await Promise.all([
    prisma.lead.count({ where: { ...companyFilter, pipeline: "PROSPECCAO" } }),
    prisma.lead.count({ where: { ...companyFilter, pipeline: "LEADS" } }),
    prisma.lead.count({ where: { ...companyFilter, pipeline: "OPORTUNIDADES" } }),
    prisma.lead.count({ where: { ...companyFilter, status: "CLOSED" } }),
  ]);
  const funnelCounts = { prospeccao: prospeccaoAll, leads: leadsAll, oportunidades: opAll, fechados: fechadosAll };

  // ── KPIs de leads ──────────────────────────────────────────────────────────
  const totalLeads  = leads.length;
  const totalClosed = leads.filter(l => l.status === "CLOSED").length;
  const convRate    = totalLeads > 0 ? ((totalClosed / totalLeads) * 100).toFixed(1) : "0";
  const prevSince   = new Date(since);
  prevSince.setDate(prevSince.getDate() - days);
  const prevCount = await prisma.lead.count({
    where: { ...companyFilter, createdAt: { gte: prevSince, lt: since } },
  });
  const growth = prevCount > 0 ? (((totalLeads - prevCount) / prevCount) * 100).toFixed(0) : null;

  // ── Leads por status ───────────────────────────────────────────────────────
  const sc: Record<string, number> = { NEW: 0, CONTACTED: 0, PROPOSAL: 0, CLOSED: 0, LOST: 0 };
  for (const l of leads) sc[l.status] = (sc[l.status] ?? 0) + 1;
  const leadsPerStatus = [
    { name: "Novos",      value: sc.NEW,       color: "#6366f1" },
    { name: "Em Contato", value: sc.CONTACTED,  color: "#3b82f6" },
    { name: "Proposta",   value: sc.PROPOSAL,   color: "#eab308" },
    { name: "Fechados",   value: sc.CLOSED,     color: "#22c55e" },
    { name: "Perdidos",   value: sc.LOST,       color: "#ef4444" },
  ];

  // ── Leads por campanha ────────────────────────────────────────────────────
  const campMap: Record<string, { name: string; leads: number; closed: number }> = {};
  for (const l of leads) {
    if (!l.campaignId) continue;
    const name = l.campaign?.name ?? "Sem nome";
    if (!campMap[l.campaignId]) campMap[l.campaignId] = { name, leads: 0, closed: 0 };
    campMap[l.campaignId].leads++;
    if (l.status === "CLOSED") campMap[l.campaignId].closed++;
  }
  const leadsPerCampaign = Object.values(campMap).sort((a, b) => b.leads - a.leads).slice(0, 8);

  // ── Leads por empresa (SUPER_ADMIN) ──────────────────────────────────────
  let leadsPerCompany: { name: string; leads: number; closed: number }[] = [];
  if (isSuperAdmin) {
    const coMap: Record<string, { name: string; leads: number; closed: number }> = {};
    for (const l of leads) {
      const name = l.company?.name ?? "Sem empresa";
      if (!coMap[l.companyId]) coMap[l.companyId] = { name, leads: 0, closed: 0 };
      coMap[l.companyId].leads++;
      if (l.status === "CLOSED") coMap[l.companyId].closed++;
    }
    leadsPerCompany = Object.values(coMap).sort((a, b) => b.leads - a.leads);
  }

  // ── Tracking links + ClickEvents por dia ──────────────────────────────────
  const trackingLinks = await prisma.trackingLink.findMany({
    where: companyFilter,
    select: {
      id: true, label: true, code: true, clicks: true, destType: true,
      _count: { select: { leads: true, clickEvents: true } },
      campaign: { select: { name: true } },
    },
    orderBy: { clicks: "desc" },
    take: 10,
  });

  const clickEventWhere: any = { createdAt: { gte: since } };
  if (!isSuperAdmin && userCompanyId) clickEventWhere.trackingLink = { companyId: userCompanyId };

  const clickEventsRaw = await prisma.clickEvent.findMany({
    where: clickEventWhere,
    select: {
      createdAt: true,
      trackingLink: { select: { label: true, code: true } },
    },
  });

  const linkDayMap = buildDays<{ internos: number; byLink: Record<string, number> }>(
    () => ({ internos: 0, byLink: {} })
  );
  for (const ev of clickEventsRaw) {
    const key = dk(new Date(ev.createdAt));
    if (!linkDayMap[key]) continue;
    linkDayMap[key].internos++;
    const lbl = ev.trackingLink.label ?? ev.trackingLink.code;
    linkDayMap[key].byLink[lbl] = (linkDayMap[key].byLink[lbl] ?? 0) + 1;
  }
  const linkClicksByDay = Object.entries(linkDayMap).map(([date, v]) => ({
    date,
    internos: v.internos,
    byLink: Object.entries(v.byLink).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
  }));

  const totalLinkClicks   = trackingLinks.reduce((s, l) => s + l.clicks, 0);
  const totalLinkLeads    = trackingLinks.reduce((s, l) => s + l._count.leads, 0);
  const totalLinkInternal = trackingLinks.reduce((s, l) => s + l._count.clickEvents, 0);

  // ── WhatsApp mensagens por dia ─────────────────────────────────────────────
  const msgWhere: any = { receivedAt: { gte: since } };
  if (!isSuperAdmin && userCompanyId) msgWhere.companyId = userCompanyId;

  const msgRaw = await prisma.message.findMany({
    where: msgWhere,
    select: { receivedAt: true, direction: true },
  });
  const msgDayMap = buildDays(() => ({ inbound: 0, outbound: 0 }));
  for (const m of msgRaw) {
    const key = dk(new Date(m.receivedAt));
    if (!msgDayMap[key]) continue;
    if (m.direction === "INBOUND") msgDayMap[key].inbound++;
    else                           msgDayMap[key].outbound++;
  }
  const msgPerDay = Object.entries(msgDayMap).map(([date, v]) => ({ date, ...v }));
  const totalInbound  = msgRaw.filter(m => m.direction === "INBOUND").length;
  const totalOutbound = msgRaw.filter(m => m.direction === "OUTBOUND").length;

  // ── Chamados ──────────────────────────────────────────────────────────────
  const [tickOpen, tickResolved, tickInProgress, tickClosed] = await Promise.all([
    prisma.ticket.count({ where: { ...companyFilter, status: "OPEN" } }),
    prisma.ticket.count({ where: { ...companyFilter, status: "RESOLVED" } }),
    prisma.ticket.count({ where: { ...companyFilter, status: "IN_PROGRESS" } }),
    prisma.ticket.count({ where: { ...companyFilter, status: "CLOSED" } }),
  ]);
  const ticketsTotal = tickOpen + tickResolved + tickInProgress + tickClosed;

  const ticketWhere: any = { createdAt: { gte: since } };
  if (!isSuperAdmin && userCompanyId) ticketWhere.companyId = userCompanyId;

  const ticketRaw = await prisma.ticket.findMany({
    where: ticketWhere,
    select: { createdAt: true, status: true },
  });
  const tickDayMap = buildDays(() => ({ abertos: 0, resolvidos: 0 }));
  for (const t of ticketRaw) {
    const key = dk(new Date(t.createdAt));
    if (!tickDayMap[key]) continue;
    tickDayMap[key].abertos++;
    if (t.status === "RESOLVED" || t.status === "CLOSED") tickDayMap[key].resolvidos++;
  }
  const ticketsPerDay = Object.entries(tickDayMap).map(([date, v]) => ({ date, ...v }));

  return (
    <RelatoriosDashboard
      days={days}
      isSuperAdmin={isSuperAdmin}
      kpis={{ totalLeads, totalClosed, convRate, growth, prevCount }}
      crmPerDay={crmPerDay}
      funnelCounts={funnelCounts}
      leadsPerStatus={leadsPerStatus}
      leadsPerCampaign={leadsPerCampaign}
      leadsPerCompany={leadsPerCompany}
      trackingLinks={trackingLinks.map(l => ({
        label:    l.label ?? l.code,
        clicks:   l.clicks,
        leads:    l._count.leads,
        internal: l._count.clickEvents,
        destType: l.destType,
        campaign: l.campaign?.name ?? null,
      }))}
      linkKpis={{ totalClicks: totalLinkClicks, totalLeads: totalLinkLeads, totalInternal: totalLinkInternal }}
      linkClicksByDay={linkClicksByDay}
      msgPerDay={msgPerDay}
      whatsappKpis={{ inbound: totalInbound, outbound: totalOutbound, total: msgRaw.length }}
      ticketKpis={{ open: tickOpen, inProgress: tickInProgress, resolved: tickResolved, closed: tickClosed, total: ticketsTotal }}
      ticketsPerDay={ticketsPerDay}
    />
  );
}
