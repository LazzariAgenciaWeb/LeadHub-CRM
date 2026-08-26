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
import CompanyCustomFields from "./CompanyCustomFields";
import CompanyContractedServices from "./CompanyContractedServices";
import CompanyFinanceiro from "./CompanyFinanceiro";
import { getCompanyPlan } from "@/lib/limits";
import { PLANS, ADDONS, formatPriceBRL } from "@/lib/plans";
import { MODULES } from "@/lib/modules";

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
        _count: { select: { leads: true, messages: true, campaigns: true, subCompanies: true } },
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

  // ADMIN pode deletar/mesclar suas próprias sub-empresas; SUPER_ADMIN qualquer uma.
  const canDeleteOrMerge =
    isSuperAdmin || (role === "ADMIN" && company.parentCompanyId === userCompanyId);

  // Agência com o módulo Espaço do Cliente → pode liberar o painel da sub-empresa sozinha.
  const canOfferPanel = (session?.user as any)?.modules?.espacoCliente === true;

  // Empresas elegíveis como destino do merge.
  // SUPER_ADMIN: todas as outras. ADMIN: outras sub-empresas do mesmo parent.
  const eligibleTargets = canDeleteOrMerge
    ? await prisma.company.findMany({
        where: isSuperAdmin
          ? { id: { not: id } }
          : { parentCompanyId: userCompanyId, id: { not: id } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  // Serviços contratados + catálogo da agência (seletor) + financeiro do cliente.
  const catalogOwnerId = company.parentCompanyId ?? id;
  const [contractedRaw, catalogRaw, invoicesRaw] = await Promise.all([
    prisma.clientService.findMany({
      where:   { clientCompanyId: id },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: { service: { select: { id: true, name: true } } },
    }),
    prisma.service.findMany({
      where:   { companyId: catalogOwnerId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select:  { id: true, name: true },
    }),
    prisma.clientInvoice.findMany({
      where:   { clientCompanyId: id },
      orderBy: [{ status: "asc" }, { dueDate: "desc" }],
      include: { clientService: { select: { id: true, label: true } } },
    }),
  ]);
  const contracted = contractedRaw.map((c) => ({
    id: c.id, serviceId: c.serviceId, serviceName: c.service?.name ?? null,
    label: c.label, status: c.status, renewsAt: c.renewsAt?.toISOString() ?? null,
    url: c.url, notes: c.notes, details: (c.details as any) ?? null,
    amountCents: c.amountCents, isRecurring: c.isRecurring,
    billingCycle: c.billingCycle, billingDay: c.billingDay,
    startedAt: c.startedAt?.toISOString() ?? null, endedAt: c.endedAt?.toISOString() ?? null,
  }));
  const invoices = invoicesRaw.map((v) => ({
    id: v.id, clientServiceId: v.clientServiceId, serviceLabel: v.clientService?.label ?? null,
    description: v.description, referenceMonth: v.referenceMonth, amountCents: v.amountCents,
    dueDate: v.dueDate.toISOString(), status: v.status, paidAt: v.paidAt?.toISOString() ?? null,
    boletoUrl: v.boletoUrl, invoiceUrl: v.invoiceUrl, externalId: v.externalId, notes: v.notes,
  }));

  // Plano da empresa — pro widget dedicado no topo (super admin).
  let planCtx: Awaited<ReturnType<typeof getCompanyPlan>> | null = null;
  if (isSuperAdmin) {
    try { planCtx = await getCompanyPlan(id); } catch { planCtx = null; }
  }
  const planDef = planCtx ? PLANS[planCtx.tier] : null;
  // Resumo pro editor da empresa: o catálogo inteiro com o estado efetivo, pra
  // a aba "Módulos ativos" refletir o que o plano entrega (inclusive Marketing
  // e Cofre, que não têm campo `Company.module*` e por isso sumiam da lista).
  const moduleSummary = planCtx
    ? MODULES.map((m) => ({
        id: m.id,
        label: m.label,
        group: m.group,
        enabled: [m.primary, ...(m.alsoEnabledBy ?? [])].some(
          (k) => (planCtx!.effectiveFeatures as any)[k],
        ),
      }))
    : [];
  const planAddonCount = planCtx && planDef
    ? Object.values(ADDONS).filter((a) => (planCtx!.effectiveFeatures as any)[a.feature] && !(planDef.features as any)[a.feature]).length
    : 0;
  const PLAN_STATUS: Record<string, { label: string; cls: string }> = {
    TRIALING:        { label: "Em teste",     cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    ACTIVE:          { label: "Ativo",        cls: "text-green-400 bg-green-500/10 border-green-500/20" },
    PAST_DUE:        { label: "Atrasado",     cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    UNPAID:          { label: "Inadimplente", cls: "text-red-400 bg-red-500/10 border-red-500/20" },
    CANCELED:        { label: "Cancelado",    cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
    INCOMPLETE:      { label: "Incompleto",   cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
    NO_SUBSCRIPTION: { label: "Sem assinatura", cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
  };

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

  // Usuários da empresa sem Contato vinculado (órfãos) → viram linhas "virtual:"
  // na aba Acessos & usuários, pra logins criados direto também aparecerem.
  const linkedUserIds = new Set(contacts.map((c) => c.userId).filter(Boolean) as string[]);
  const companyUsers = await prisma.user.findMany({
    where: { companyId: id, role: { not: "SUPER_ADMIN" } },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  const orphanUserRows = companyUsers
    .filter((u) => !linkedUserIds.has(u.id))
    .map((u) => ({
      id: `virtual:${u.id}`,
      name: u.name,
      phone: "",
      isGroup: false,
      role: "CONTACT",
      hasAccess: true,
      notes: null,
      createdAt: u.createdAt.toISOString(),
      user: { id: u.id, name: u.name, email: u.email, role: u.role },
    }));
  const contactsWithUsers = [...contacts, ...orphanUserRows];

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
          {canDeleteOrMerge && (
            <DeleteCompanyButton
              id={company.id}
              name={company.name}
              counts={{
                leads: company._count.leads,
                campaigns: (company._count as any).campaigns ?? 0,
                whatsappInstances: company.whatsappInstances.length,
                subCompanies: (company._count as any).subCompanies ?? 0,
              }}
              eligibleTargets={eligibleTargets}
            />
          )}
          <EditCompanyButton company={company as any} isSuperAdmin={isSuperAdmin} canOfferPanel={canOfferPanel} modules={moduleSummary} />
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

      {/* ─── Contratado (topo): Plano + Serviços + Financeiro ─── */}
      {isSuperAdmin && planCtx && (
        <div className="bg-gradient-to-br from-[#131a2b] to-[#0f1623] border border-indigo-500/30 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-indigo-500/15 flex items-center justify-center text-xl">💳</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">Plano</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${(PLAN_STATUS[planCtx.status] ?? PLAN_STATUS.NO_SUBSCRIPTION).cls}`}>
                    {(PLAN_STATUS[planCtx.status] ?? PLAN_STATUS.NO_SUBSCRIPTION).label}
                  </span>
                </div>
                <div className="text-white font-bold text-lg leading-tight">{planDef?.label ?? "Sem assinatura"}</div>
                <div className="text-slate-400 text-xs">
                  {planDef ? `${formatPriceBRL(planDef.priceMonthly)}/mês` : "—"}
                  {planAddonCount > 0 && <> · <span className="text-indigo-300">{planAddonCount} add-on{planAddonCount > 1 ? "s" : ""}</span></>}
                  {planCtx.hasCustomOverrides && <> · <span className="text-amber-300">ajustes manuais</span></>}
                </div>
              </div>
            </div>
            <a href="#empresa-abas" className="text-indigo-400 text-xs font-semibold px-3 py-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors">
              Gerenciar plano →
            </a>
          </div>
        </div>
      )}

      {/* Serviços contratados + Financeiro — sobem do rodapé pro topo */}
      <div id="servicos" className="mb-4">
        <CompanyContractedServices companyId={id} initial={contracted} catalog={catalogRaw} />
      </div>
      <div id="financeiro" className="mb-6">
        <CompanyFinanceiro companyId={id} initial={invoices} services={contracted.map((c) => ({ id: c.id, label: c.label }))} />
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

          <div className="mt-4 pt-3 border-t border-[#1e2d45]">
            <h4 className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide mb-2">
              Informações personalizadas
            </h4>
            <CompanyCustomFields companyId={id} />
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

      {/* Abas do painel (âncora do "Gerenciar plano") */}
      <div id="empresa-abas">
        <CompanyDetailTabs
          companyId={id}
          campaigns={company.campaigns as any}
          recentLeads={recentLeads as any}
          leadsCount={leadsCount}
          prospeccaoCount={prospeccaoCount}
          recentOportunidades={recentOportunidades as any}
          oportunidadesCount={oportunidadesCount}
          recentChamados={recentChamados as any}
          contacts={contactsWithUsers as any}
          isSuperAdmin={isSuperAdmin}
        />
      </div>
    </div>
  );
}
