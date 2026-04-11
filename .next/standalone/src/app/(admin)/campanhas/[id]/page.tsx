import { getEffectiveSession } from "@/lib/effective-session";


import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import CampaignTriggers from "./CampaignTriggers";
import CampaignEdit from "./CampaignEdit";
import CampaignLinks from "./CampaignLinks";

const SOURCE_ICON: Record<string, string> = {
  WHATSAPP: "💬", INSTAGRAM: "📸", FACEBOOK: "👥", GOOGLE: "🔍", LINK: "🔗", OTHER: "📌",
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  NEW: { label: "Novos", color: "text-indigo-400" },
  CONTACTED: { label: "Em Contato", color: "text-blue-400" },
  PROPOSAL: { label: "Proposta", color: "text-yellow-400" },
  CLOSED: { label: "Fechados", color: "text-green-400" },
  LOST: { label: "Perdidos", color: "text-red-400" },
};

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, phone: true } },
      keywordRules: { orderBy: [{ priority: "desc" }, { createdAt: "asc" }] },
      links: { orderBy: { createdAt: "desc" }, include: { _count: { select: { leads: true } } } },
      _count: { select: { leads: true, messages: true, links: true } },
    },
  });

  if (!campaign) notFound();
  if (!isSuperAdmin && campaign.companyId !== userCompanyId) notFound();

  // Leads por status
  const leadsByStatus = await prisma.lead.groupBy({
    by: ["status"],
    where: { campaignId: id },
    _count: true,
  });
  const statusMap: Record<string, number> = {};
  for (const l of leadsByStatus) statusMap[l.status] = l._count;

  // Leads recentes
  const recentLeads = await prisma.lead.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const conversionRate = campaign._count.leads > 0
    ? (((statusMap["CLOSED"] ?? 0) / campaign._count.leads) * 100).toFixed(1)
    : "0";

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-sm">
        {isSuperAdmin && (
          <>
            <Link href="/empresas" className="text-slate-500 hover:text-white transition-colors">Empresas</Link>
            <span className="text-slate-700">/</span>
            <Link href={`/empresas/${campaign.companyId}`} className="text-slate-500 hover:text-white transition-colors">{campaign.company.name}</Link>
            <span className="text-slate-700">/</span>
          </>
        )}
        {!isSuperAdmin && (
          <>
            <Link href="/campanhas" className="text-slate-500 hover:text-white transition-colors">Campanhas</Link>
            <span className="text-slate-700">/</span>
          </>
        )}
        <span className="text-slate-300">{campaign.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{SOURCE_ICON[campaign.source] ?? "📌"}</span>
            <div>
              <h1 className="text-white font-bold text-xl">{campaign.name}</h1>
              <p className="text-slate-500 text-sm mt-0.5">{campaign.company.name}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CampaignEdit campaign={campaign as any} />
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
            campaign.status === "ACTIVE" ? "text-green-400 bg-green-500/15"
            : campaign.status === "PAUSED" ? "text-yellow-400 bg-yellow-500/15"
            : "text-slate-400 bg-slate-500/10"
          }`}>
            {campaign.status === "ACTIVE" ? "Ativa" : campaign.status === "PAUSED" ? "Pausada" : "Encerrada"}
          </span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">Total Leads</div>
          <div className="text-2xl font-bold text-white">{campaign._count.leads}</div>
        </div>
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">Fechados</div>
          <div className="text-2xl font-bold text-green-400">{statusMap["CLOSED"] ?? 0}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{conversionRate}% conversão</div>
        </div>
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">Mensagens WA</div>
          <div className="text-2xl font-bold text-white">{campaign._count.messages}</div>
        </div>
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-2">Links</div>
          <div className="text-2xl font-bold text-indigo-400">{campaign._count.links}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{campaign.keywordRules.length} gatilhos</div>
        </div>
      </div>

      {/* ── Links de Rastreamento ── */}
      <div className="mb-6">
        <CampaignLinks
          campaignId={campaign.id}
          campaignName={campaign.name}
          campaignSlug={campaign.slug}
          companyPhone={campaign.company.phone ?? null}
          baseUrl={baseUrl}
          initialLinks={campaign.links as any}
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* ── Gatilhos ── */}
        <div>
          <CampaignTriggers
            campaignId={campaign.id}
            companyId={campaign.companyId}
            initialRules={campaign.keywordRules as any}
          />
        </div>

        {/* ── Leads recentes + funil ── */}
        <div className="space-y-4">
          {/* Funil */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
            <h3 className="text-white font-bold text-sm mb-3">Funil de Leads</h3>
            <div className="space-y-2">
              {Object.entries(STATUS_LABEL).map(([key, s]) => {
                const count = statusMap[key] ?? 0;
                const pct = campaign._count.leads > 0 ? (count / campaign._count.leads) * 100 : 0;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-400 text-xs">{s.label}</span>
                      <span className={`font-bold text-sm ${s.color}`}>{count}</span>
                    </div>
                    <div className="h-1.5 bg-[#1e2d45] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${s.color.replace("text-", "bg-")}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Leads recentes */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-bold text-sm">Leads Recentes</h3>
              <Link href={`/leads?campaignId=${campaign.id}`} className="text-indigo-400 text-xs hover:underline">
                Ver todos →
              </Link>
            </div>
            {recentLeads.length === 0 ? (
              <div className="text-slate-500 text-sm text-center py-4">Nenhum lead ainda</div>
            ) : (
              <div className="space-y-2">
                {recentLeads.map((lead) => {
                  const s = STATUS_LABEL[lead.status];
                  return (
                    <div key={lead.id} className="flex items-center justify-between py-1.5 border-b border-[#1e2d45]/50 last:border-0">
                      <div>
                        <div className="text-white text-[13px] font-medium">{lead.name ?? "Sem nome"}</div>
                        <div className="text-slate-500 text-[11px]">{lead.phone}</div>
                      </div>
                      <span className={`text-[11px] font-semibold ${s?.color ?? "text-slate-400"}`}>
                        {s?.label ?? lead.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
