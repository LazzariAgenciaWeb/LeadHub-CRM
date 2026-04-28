import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { IMPERSONATE_COOKIE } from "@/lib/effective-session";
import { getEffectiveSession } from "@/lib/effective-session";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import DeleteCompanyButton from "./DeleteCompanyButton";
import EditCompanyButton from "./EditCompanyButton";
import CompanyDetailTabs from "./CompanyDetailTabs";

export default async function EmpresaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Use effective session for general access control (respects impersonation role)
  // Use real session to determine if the actual logged-in user is SUPER_ADMIN
  const [session, realSession] = await Promise.all([
    getEffectiveSession(),
    getServerSession(authOptions),
  ]);
  const role = (session?.user as any)?.role;
  const realRole = (realSession?.user as any)?.role;
  const userCompanyId = (session?.user as any)?.companyId;

  if (!session) redirect("/login");

  // CLIENT sem canViewCompanies → sem acesso
  if (role === "CLIENT" && !can(session, "canViewCompanies")) redirect("/dashboard");

  const { id } = await params;
  // isSuperAdmin must be based on the REAL session, not the effective session.
  // When impersonating, getEffectiveSession() returns role="ADMIN", which would
  // prevent auto-exit and hide the module editing controls.
  const isSuperAdmin = realRole === "SUPER_ADMIN";

  // SUPER_ADMIN: clear impersonation so the page shows real SUPER_ADMIN context
  if (isSuperAdmin) {
    const cookieStore = await cookies();
    const impersonating = cookieStore.get(IMPERSONATE_COOKIE)?.value;
    if (impersonating) {
      redirect(`/api/admin/impersonate/exit?returnTo=/empresas/${id}`);
    }
  }

  const [company, contacts] = await Promise.all([
    prisma.company.findUnique({
      where: { id },
      include: {
        campaigns: {
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { leads: true, messages: true } } },
        },
        whatsappInstances: true,
        _count: { select: { leads: true, messages: true } },
        subCompanies: { select: { id: true, name: true }, take: 5 },
      },
    }),
    prisma.companyContact.findMany({
      where: { companyId: id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  if (!company) notFound();

  // ADMIN can only see sub-companies of their own company
  if (!isSuperAdmin && company.parentCompanyId !== userCompanyId) redirect("/empresas");

  const [prospeccaoCount, leadsCount, oportunidadesCount, totalLeads, recentLeads, recentOportunidades, recentChamados] = await Promise.all([
    prisma.lead.count({ where: { companyId: id, pipeline: "PROSPECCAO" } }),
    prisma.lead.count({ where: { companyId: id, pipeline: "LEADS" } }),
    prisma.lead.count({ where: { companyId: id, pipeline: "OPORTUNIDADES" } }),
    prisma.lead.count({ where: { companyId: id } }),
    prisma.lead.findMany({
      where: { companyId: id, pipeline: { in: ["PROSPECCAO", "LEADS"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, phone: true, pipeline: true, pipelineStage: true, status: true, createdAt: true },
    }),
    prisma.lead.findMany({
      where: { companyId: id, pipeline: "OPORTUNIDADES" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, phone: true, pipelineStage: true, value: true, createdAt: true },
    }),
    prisma.ticket.findMany({
      where: { companyId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, priority: true, status: true, ticketStage: true, createdAt: true },
    }),
  ]);

  const wonStages = await prisma.pipelineStageConfig.findMany({
    where: { companyId: id, pipeline: "OPORTUNIDADES", isFinal: true, NOT: [{ name: { contains: "Perdido" } }, { name: { contains: "❌" } }] },
    select: { name: true },
  });
  const vendas = wonStages.length > 0
    ? await prisma.lead.count({ where: { companyId: id, pipeline: "OPORTUNIDADES", pipelineStage: { in: wonStages.map(s => s.name) } } })
    : 0;

  const pipelineFunnel = [
    { label: "Prospectos",    value: prospeccaoCount,   color: "text-violet-400" },
    { label: "Leads",         value: leadsCount,         color: "text-indigo-400" },
    { label: "Oportunidades", value: oportunidadesCount, color: "text-amber-400"  },
    { label: "Vendas",        value: vendas,             color: "text-green-400"  },
  ];

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-sm">
        <Link href="/empresas" className="text-slate-500 hover:text-white transition-colors">
          {isSuperAdmin ? "Empresas" : "Meus Clientes"}
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-300">{company.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-white font-bold text-xl">{company.name}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {company.segment ?? "Sem segmento"} •{" "}
            <span className={company.status === "ACTIVE" ? "text-green-400" : "text-slate-500"}>
              {company.status === "ACTIVE" ? "Ativo" : "Inativo"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && <DeleteCompanyButton id={company.id} name={company.name} />}
          <EditCompanyButton company={company as any} isSuperAdmin={isSuperAdmin} />
          {isSuperAdmin && (
            <>
              <Link
                href={`/api/admin/impersonate/${id}`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-medium hover:bg-amber-500/20 transition-colors"
              >
                👁 Acessar Painel
              </Link>
              <Link
                href={`/empresas/${id}/campanhas/nova`}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
              >
                + Nova Campanha
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Badge de acesso e módulos */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(company as any).hasSystemAccess ? (
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">
            🔐 Acesso ao sistema
          </span>
        ) : (
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-500/10 border border-slate-500/20 text-slate-400">
            📋 Apenas CRM
          </span>
        )}
        {(company as any).hasSystemAccess && (
          <>
            {(company as any).moduleWhatsapp  && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">WhatsApp</span>}
            {(company as any).moduleCrm       && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">CRM</span>}
            {(company as any).moduleTickets   && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400">Chamados</span>}
            {(company as any).moduleAI        && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">Assistente IA</span>}
          </>
        )}
        {(company as any).subCompanies?.length > 0 && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            👥 {(company as any).subCompanies.length} cliente{(company as any).subCompanies.length !== 1 ? "s" : ""} cadastrado{(company as any).subCompanies.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Info + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Contato */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Informações</h3>
          <div className="flex flex-col gap-2 text-sm">
            {company.email && (
              <div className="flex gap-2">
                <span className="text-slate-500">✉️</span>
                <span className="text-slate-300">{company.email}</span>
              </div>
            )}
            {company.phone && (
              <div className="flex gap-2">
                <span className="text-slate-500">📱</span>
                <span className="text-slate-300">{company.phone}</span>
              </div>
            )}
            {company.website && (
              <div className="flex gap-2">
                <span className="text-slate-500">🌐</span>
                <a href={company.website} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline truncate">
                  {company.website}
                </a>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-slate-500">📅</span>
              <span className="text-slate-400 text-xs">Criado em {new Date(company.createdAt).toLocaleDateString("pt-BR")}</span>
            </div>
          </div>
        </div>

        {/* Funil CRM */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Funil CRM</h3>
          <div className="flex flex-col gap-2">
            {pipelineFunnel.map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">{row.label}</span>
                <span className={`font-bold text-sm ${row.color}`}>{row.value}</span>
              </div>
            ))}
            <div className="border-t border-[#1e2d45] pt-2 mt-1 flex items-center justify-between">
              <span className="text-slate-400 text-xs font-semibold">Total</span>
              <span className="text-white font-bold text-sm">{totalLeads}</span>
            </div>
          </div>
        </div>

        {/* WhatsApp */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">WhatsApp</h3>
          {company.whatsappInstances.length === 0 ? (
            <div className="text-center py-3">
              <div className="text-slate-500 text-sm">Nenhuma instância conectada</div>
              <div className="text-slate-600 text-xs mt-1">Configure na Evolution API e adicione aqui</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {company.whatsappInstances.map((inst) => (
                <div key={inst.id} className="flex items-center gap-2 bg-[#161f30] rounded-lg px-3 py-2">
                  <div className={`w-2 h-2 rounded-full ${inst.status === "CONNECTED" ? "bg-green-400" : inst.status === "CONNECTING" ? "bg-yellow-400" : "bg-red-400"}`} />
                  <div className="flex-1">
                    <div className="text-white text-xs font-semibold">{inst.instanceName}</div>
                    <div className="text-slate-500 text-[10px]">{inst.phone ?? "Sem número"}</div>
                  </div>
                  <span className={`text-[10px] font-semibold ${inst.status === "CONNECTED" ? "text-green-400" : "text-slate-500"}`}>
                    {inst.status === "CONNECTED" ? "Ativo" : inst.status === "CONNECTING" ? "Conectando" : "Off"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {isSuperAdmin && (
            <div className="mt-3 pt-3 border-t border-[#1e2d45] text-xs text-slate-500">
              Webhook: <code className="text-indigo-400 text-[10px]">/api/webhook/whatsapp</code>
            </div>
          )}
        </div>
      </div>

      {/* Tabs: Campanhas | Leads | Oportunidades | Chamados | Contatos */}
      <CompanyDetailTabs
        companyId={id}
        campaigns={company.campaigns as any}
        recentLeads={recentLeads as any}
        leadsCount={leadsCount}
        prospeccaoCount={prospeccaoCount}
        recentOportunidades={recentOportunidades as any}
        oportunidadesCount={oportunidadesCount}
        recentChamados={recentChamados as any}
        contacts={contacts as any}
        isSuperAdmin={isSuperAdmin}
      />
    </div>
  );
}
