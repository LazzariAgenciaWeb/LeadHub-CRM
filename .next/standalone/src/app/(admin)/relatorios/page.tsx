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

  // ── Leads brutos do período ──────────────────────────────────────────────
  const leads = await prisma.lead.findMany({
    where: { ...companyFilter, createdAt: { gte: since } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      companyId: true,
      campaignId: true,
      campaign: { select: { name: true } },
      company: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // ── Leads por dia ────────────────────────────────────────────────────────
  const dayMap: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    dayMap[key] = 0;
  }
  for (const lead of leads) {
    const key = new Date(lead.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    if (key in dayMap) dayMap[key]++;
  }
  const leadsPerDay = Object.entries(dayMap).map(([date, count]) => ({ date, leads: count }));

  // ── Leads por status ─────────────────────────────────────────────────────
  const statusCount: Record<string, number> = { NEW: 0, CONTACTED: 0, PROPOSAL: 0, CLOSED: 0, LOST: 0 };
  for (const lead of leads) statusCount[lead.status] = (statusCount[lead.status] ?? 0) + 1;
  const leadsPerStatus = [
    { name: "Novos", value: statusCount.NEW, color: "#6366f1" },
    { name: "Em Contato", value: statusCount.CONTACTED, color: "#3b82f6" },
    { name: "Proposta", value: statusCount.PROPOSAL, color: "#eab308" },
    { name: "Fechados", value: statusCount.CLOSED, color: "#22c55e" },
    { name: "Perdidos", value: statusCount.LOST, color: "#ef4444" },
  ];

  // ── Leads por campanha (top 8) ───────────────────────────────────────────
  const campaignMap: Record<string, { name: string; leads: number; closed: number }> = {};
  for (const lead of leads) {
    if (!lead.campaignId) continue;
    const name = lead.campaign?.name ?? "Sem nome";
    if (!campaignMap[lead.campaignId]) campaignMap[lead.campaignId] = { name, leads: 0, closed: 0 };
    campaignMap[lead.campaignId].leads++;
    if (lead.status === "CLOSED") campaignMap[lead.campaignId].closed++;
  }
  const leadsPerCampaign = Object.values(campaignMap)
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 8);

  // ── Leads por empresa (SUPER_ADMIN) ──────────────────────────────────────
  let leadsPerCompany: { name: string; leads: number; closed: number }[] = [];
  if (isSuperAdmin) {
    const companyMap: Record<string, { name: string; leads: number; closed: number }> = {};
    for (const lead of leads) {
      const name = lead.company?.name ?? "Sem empresa";
      if (!companyMap[lead.companyId]) companyMap[lead.companyId] = { name, leads: 0, closed: 0 };
      companyMap[lead.companyId].leads++;
      if (lead.status === "CLOSED") companyMap[lead.companyId].closed++;
    }
    leadsPerCompany = Object.values(companyMap).sort((a, b) => b.leads - a.leads);
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const totalLeads = leads.length;
  const totalClosed = leads.filter((l) => l.status === "CLOSED").length;
  const convRate = totalLeads > 0 ? ((totalClosed / totalLeads) * 100).toFixed(1) : "0";

  // leads no período anterior para comparação
  const prevSince = new Date(since);
  prevSince.setDate(prevSince.getDate() - days);
  const prevCount = await prisma.lead.count({
    where: { ...companyFilter, createdAt: { gte: prevSince, lt: since } },
  });
  const growth = prevCount > 0 ? (((totalLeads - prevCount) / prevCount) * 100).toFixed(0) : null;

  return (
    <RelatoriosDashboard
      days={days}
      isSuperAdmin={isSuperAdmin}
      kpis={{ totalLeads, totalClosed, convRate, growth, prevCount }}
      leadsPerDay={leadsPerDay}
      leadsPerStatus={leadsPerStatus}
      leadsPerCampaign={leadsPerCampaign}
      leadsPerCompany={leadsPerCompany}
    />
  );
}
