import { redirect, notFound } from "next/navigation";
import { getEffectiveSession, isImpersonating } from "@/lib/effective-session";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import DeleteCompanyButton from "./DeleteCompanyButton";
import EditCompanyButton from "./EditCompanyButton";
import CompanyDetailTabs from "./CompanyDetailTabs";
import CompanyCustomFields from "./CompanyCustomFields";
import { getCompanyPlan } from "@/lib/limits";
import { PLANS, ADDONS, formatPriceBRL } from "@/lib/plans";
import { MODULES } from "@/lib/modules";
import { getViewer, ticketVisibilityWhere, projectVisibilityWhere } from "@/lib/visibility";
import { phoneMatchVariants } from "@/lib/phone-match";

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
  // Super admin só é super admin aqui quando NÃO está impersonando. Dentro de
  // um cliente, esta tela se comporta como a do ADMIN daquele cliente (vê só
  // sub-empresas dele, sem "Acessar Painel" nem edição de plano/módulos) —
  // assim um clique num cliente nunca troca a impersonação. Trocar/sair é
  // sempre pelo banner.
  const isSuperAdmin = realRole === "SUPER_ADMIN" && !isImpersonating(session);

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
  const [contractedRaw, catalogRaw, invoicesRaw, financeLogsRaw] = await Promise.all([
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
    // Trilha de auditoria do financeiro deste cliente (quem/quando/por quê).
    prisma.financeLog.findMany({
      where: { clientCompanyId: id },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
  ]);
  const contracted = contractedRaw.map((c) => ({
    id: c.id, serviceId: c.serviceId, serviceName: c.service?.name ?? null,
    label: c.label, status: c.status, renewsAt: c.renewsAt?.toISOString() ?? null,
    url: c.url, notes: c.notes, details: (c.details as any) ?? null,
    amountCents: c.amountCents, isRecurring: c.isRecurring,
    // Sem isto o form abria sempre com "Gera bonificação" marcado e um simples
    // salvar reativava, em silêncio, o serviço que estava fora do fechamento.
    bonusEligible: c.bonusEligible,
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

  // ─── Relacionamento da agência com ESTE cliente ───────────────────────────
  // O que aparece aqui é o que NÓS temos com o cliente — não os dados do
  // painel dele. Projetos e chamados já apontam pro cliente (clientCompanyId).
  // Negociação (Lead do CRM da agência) não tem esse vínculo, então o casamento
  // é por: venda da esteira ligada ao cliente, telefone (empresa + contatos),
  // e-mail e nome exato. Agência = parentCompany; pra empresa top-level vista
  // pelo super admin, é a empresa do próprio super admin.
  const superAdminCompanyId = (realSession?.user as any)?.companyId as string | undefined;
  const agencyId = company.parentCompanyId ?? (isSuperAdmin ? superAdminCompanyId : undefined) ?? null;
  const viewer = await getViewer(session);
  const ticketVis = ticketVisibilityWhere(viewer);
  const projectVis = projectVisibilityWhere(viewer);

  const [salesRaw, projetosRaw, chamadosRaw] = await Promise.all([
    prisma.sale.findMany({
      where: { clientCompanyId: id },
      orderBy: { closedAt: "desc" },
      select: {
        id: true, leadId: true, title: true, valueCents: true, kind: true, closedAt: true,
        sellerName: true, contractStatus: true, billingStatus: true, productionStatus: true,
        projectId: true,
      },
    }),
    prisma.setorClickupList.findMany({
      where: { clientCompanyId: id, ...(projectVis ? { AND: [projectVis] } : {}) },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, name: true, type: true, status: true, dueDate: true, deliveredAt: true,
        taskCount: true, taskCompleted: true, taskOverdue: true, createdAt: true,
        setor: { select: { name: true } },
        service: { select: { name: true } },
      },
    }),
    prisma.ticket.findMany({
      where: {
        clientCompanyId: id,
        ...(realRole !== "SUPER_ADMIN" ? { isInternal: false } : {}),
        ...(ticketVis ? { AND: [ticketVis] } : {}),
      },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 60,
      select: {
        id: true, title: true, priority: true, status: true, ticketStage: true,
        dueDate: true, createdAt: true,
        assignee: { select: { name: true } },
        setor: { select: { name: true } },
      },
    }),
  ]);

  const saleLeadIds = salesRaw.map((v) => v.leadId).filter((x): x is string => !!x);
  const phoneVariants = phoneMatchVariants([
    company.phone,
    ...contacts.filter((c) => !c.isGroup).map((c) => c.phone),
  ]);
  const emailMatches = Array.from(new Set(
    [company.email, ...contacts.map((c) => c.user?.email)]
      .filter((e): e is string => !!e && e.includes("@"))
      .map((e) => e.trim().toLowerCase()),
  ));
  const leadOr: any[] = [];
  if (saleLeadIds.length)   leadOr.push({ id: { in: saleLeadIds } });
  if (phoneVariants.length) leadOr.push({ phone: { in: phoneVariants } });
  if (emailMatches.length)  leadOr.push({ email: { in: emailMatches, mode: "insensitive" } });
  if (company.name.trim())  leadOr.push({ name: { equals: company.name.trim(), mode: "insensitive" } });

  const negociacoesRaw = agencyId && agencyId !== id && leadOr.length > 0
    ? await prisma.lead.findMany({
        where: { companyId: agencyId, OR: leadOr },
        orderBy: { updatedAt: "desc" },
        take: 60,
        select: {
          id: true, name: true, phone: true, email: true, pipeline: true, pipelineStage: true,
          status: true, value: true, wonAt: true, lostAt: true, createdAt: true, updatedAt: true,
        },
      })
    : [];

  const saleLeadSet = new Set(saleLeadIds);
  const phoneSet = new Set(phoneVariants);
  const emailSet = new Set(emailMatches);
  const negociacoes = negociacoesRaw.map((l) => {
    const outcome: "ABERTA" | "GANHA" | "PERDIDA" =
      l.wonAt || l.status === "CLOSED" ? "GANHA" :
      l.lostAt || l.status === "LOST"  ? "PERDIDA" : "ABERTA";
    const matchedBy: "venda" | "telefone" | "e-mail" | "nome" =
      saleLeadSet.has(l.id) ? "venda" :
      phoneSet.has(l.phone) ? "telefone" :
      l.email && emailSet.has(l.email.trim().toLowerCase()) ? "e-mail" : "nome";
    return {
      id: l.id, name: l.name, phone: l.phone, email: l.email, pipeline: l.pipeline,
      pipelineStage: l.pipelineStage, value: l.value, outcome, matchedBy,
      wonAt: l.wonAt?.toISOString() ?? null, lostAt: l.lostAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString(),
    };
  });
  // Em aberto primeiro; dentro de cada grupo, a mexida mais recente no topo.
  const OUTCOME_ORDER = { ABERTA: 0, GANHA: 1, PERDIDA: 2 } as const;
  negociacoes.sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || b.updatedAt.localeCompare(a.updatedAt));

  const vendas = salesRaw.map((v) => ({
    id: v.id, leadId: v.leadId, title: v.title, valueCents: v.valueCents, kind: v.kind,
    closedAt: v.closedAt.toISOString(), sellerName: v.sellerName,
    contractStatus: v.contractStatus, billingStatus: v.billingStatus, productionStatus: v.productionStatus,
    projectId: v.projectId,
  }));
  const projetos = projetosRaw.map((pj) => ({
    id: pj.id, name: pj.name, type: pj.type, status: pj.status,
    dueDate: pj.dueDate?.toISOString() ?? null, deliveredAt: pj.deliveredAt?.toISOString() ?? null,
    taskCount: pj.taskCount, taskCompleted: pj.taskCompleted, taskOverdue: pj.taskOverdue,
    createdAt: pj.createdAt.toISOString(), setorName: pj.setor?.name ?? null, serviceName: pj.service?.name ?? null,
  }));
  const chamados = chamadosRaw.map((t) => ({
    id: t.id, title: t.title, priority: t.priority, status: t.status, ticketStage: t.ticketStage,
    dueDate: t.dueDate?.toISOString() ?? null, createdAt: t.createdAt.toISOString(),
    assigneeName: t.assignee?.name ?? null, setorName: t.setor?.name ?? null,
  }));

  const negAbertas = negociacoes.filter((n) => n.outcome === "ABERTA").length;
  const negGanhas  = negociacoes.filter((n) => n.outcome === "GANHA").length;
  const vendasTotalCents = vendas.reduce((acc, v) => acc + v.valueCents, 0);
  const projetosAbertos = projetos.filter((pj) => pj.status !== "ENTREGUE" && pj.status !== "CANCELADO").length;
  const chamadosAbertos = chamados.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS").length;

  const relacionamento = [
    { label: "Negociações em aberto", value: negAbertas,      color: "text-amber-400" },
    { label: "Negociações ganhas",    value: negGanhas,       color: "text-green-400" },
    { label: "Projetos em andamento", value: projetosAbertos, color: "text-indigo-400" },
    { label: "Chamados em aberto",    value: chamadosAbertos, color: "text-orange-400" },
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

      {/* Info + Stats — identificação do cliente vem antes das abas */}
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

        {/* Com este cliente — o que a agência tem em andamento com ele */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Com este cliente</h3>
          <div className="flex flex-col gap-2">
            {relacionamento.map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">{row.label}</span>
                <span className={`font-bold text-sm ${row.color}`}>{row.value}</span>
              </div>
            ))}
            <div className="border-t border-[#1e2d45] pt-2 mt-1 flex items-center justify-between">
              <span className="text-slate-400 text-xs font-semibold">Vendas fechadas</span>
              <span className="text-white font-bold text-sm">
                {vendas.length}
                {vendasTotalCents > 0 && (
                  <span className="text-green-400 text-xs font-semibold ml-1.5">
                    R$ {(vendasTotalCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                )}
              </span>
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
          negociacoes={negociacoes}
          vendas={vendas}
          projetos={projetos}
          chamados={chamados}
          contacts={contactsWithUsers as any}
          isSuperAdmin={isSuperAdmin}
          isClientCompany={!!company.parentCompanyId}
          contracted={contracted}
          catalog={catalogRaw}
          invoices={invoices}
          billingNotes={(company as any).billingNotes ?? null}
          financeLogs={financeLogsRaw.map((l) => ({
            id: l.id,
            entity: l.entity,
            action: l.action,
            description: l.description,
            userName: l.userName,
            createdAt: l.createdAt.toISOString(),
            meta: (l.meta as Record<string, unknown> | null) ?? null,
          }))}
        />
      </div>
    </div>
  );
}
