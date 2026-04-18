import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { IMPERSONATE_COOKIE } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import DeleteCompanyButton from "./DeleteCompanyButton";
import EditCompanyButton from "./EditCompanyButton";
import CompanyContacts from "./CompanyContacts";

export default async function EmpresaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "SUPER_ADMIN") redirect("/dashboard");

  const { id } = await params;

  // If a SUPER_ADMIN arrives here with an active impersonation cookie, clear it
  // so the sidebar (which uses getEffectiveSession) shows global data, not a client view.
  // "Ver Detalhes" should never change the dashboard context.
  const cookieStore = await cookies();
  const impersonating = cookieStore.get(IMPERSONATE_COOKIE)?.value;
  if (impersonating) {
    redirect(`/api/admin/impersonate/exit?returnTo=/empresas/${id}`);
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
      },
    }),
    prisma.companyContact.findMany({
      where: { companyId: id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  if (!company) notFound();

  const [prospeccaoCount, leadsCount, oportunidadesCount, totalLeads, recentLeads, recentOportunidades, recentChamados] = await Promise.all([
    prisma.lead.count({ where: { companyId: id, pipeline: "PROSPECCAO" } }),
    prisma.lead.count({ where: { companyId: id, pipeline: "LEADS" } }),
    prisma.lead.count({ where: { companyId: id, pipeline: "OPORTUNIDADES" } }),
    prisma.lead.count({ where: { companyId: id } }),
    // Leads recentes (excl. oportunidades — essas têm seção própria)
    prisma.lead.findMany({
      where: { companyId: id, pipeline: { in: ["PROSPECCAO", "LEADS"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, phone: true, pipeline: true, pipelineStage: true, status: true, createdAt: true },
    }),
    // Oportunidades recentes
    prisma.lead.findMany({
      where: { companyId: id, pipeline: "OPORTUNIDADES" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, phone: true, pipelineStage: true, value: true, createdAt: true },
    }),
    // Chamados recentes
    prisma.ticket.findMany({
      where: { companyId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, priority: true, status: true, ticketStage: true, createdAt: true },
    }),
  ]);

  // Vendas = oportunidades em etapas finais positivas
  const wonStages = await prisma.pipelineStageConfig.findMany({
    where: { companyId: id, pipeline: "OPORTUNIDADES", isFinal: true, NOT: [{ name: { contains: "Perdido" } }, { name: { contains: "❌" } }] },
    select: { name: true },
  });
  const vendas = wonStages.length > 0
    ? await prisma.lead.count({ where: { companyId: id, pipeline: "OPORTUNIDADES", pipelineStage: { in: wonStages.map(s => s.name) } } })
    : 0;

  const pipelineFunnel = [
    { label: "Prospectos",    value: prospeccaoCount,    color: "text-violet-400" },
    { label: "Leads",         value: leadsCount,          color: "text-indigo-400" },
    { label: "Oportunidades", value: oportunidadesCount,  color: "text-amber-400"  },
    { label: "Vendas",        value: vendas,              color: "text-green-400"  },
  ];

  const sourceIcon: Record<string, string> = {
    WHATSAPP: "💬",
    INSTAGRAM: "📸",
    FACEBOOK: "👥",
    GOOGLE: "🔍",
    LINK: "🔗",
    OTHER: "📌",
  };

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-sm">
        <Link href="/empresas" className="text-slate-500 hover:text-white transition-colors">
          Empresas
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-300">{company.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">{company.name}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {company.segment ?? "Sem segmento"} •{" "}
            <span className={company.status === "ACTIVE" ? "text-green-400" : "text-slate-500"}>
              {company.status === "ACTIVE" ? "Ativo" : "Inativo"}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <DeleteCompanyButton id={company.id} name={company.name} />
          <EditCompanyButton company={company} />
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
        </div>
      </div>

      {/* Info + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Contato */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">
            Informações
          </h3>
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
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:underline truncate"
                >
                  {company.website}
                </a>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-slate-500">📅</span>
              <span className="text-slate-400 text-xs">
                Criado em {new Date(company.createdAt).toLocaleDateString("pt-BR")}
              </span>
            </div>
          </div>
        </div>

        {/* Funil CRM */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">
            Funil CRM
          </h3>
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
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">
            WhatsApp
          </h3>
          {company.whatsappInstances.length === 0 ? (
            <div className="text-center py-3">
              <div className="text-slate-500 text-sm">Nenhuma instância conectada</div>
              <div className="text-slate-600 text-xs mt-1">
                Configure na Evolution API e adicione aqui
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {company.whatsappInstances.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center gap-2 bg-[#161f30] rounded-lg px-3 py-2"
                >
                  <div
                    className={`w-2 h-2 rounded-full ${
                      inst.status === "CONNECTED"
                        ? "bg-green-400"
                        : inst.status === "CONNECTING"
                        ? "bg-yellow-400"
                        : "bg-red-400"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="text-white text-xs font-semibold">
                      {inst.instanceName}
                    </div>
                    <div className="text-slate-500 text-[10px]">
                      {inst.phone ?? "Sem número"}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-semibold ${
                      inst.status === "CONNECTED" ? "text-green-400" : "text-slate-500"
                    }`}
                  >
                    {inst.status === "CONNECTED" ? "Ativo" : inst.status === "CONNECTING" ? "Conectando" : "Off"}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-[#1e2d45] text-xs text-slate-500">
            Webhook:{" "}
            <code className="text-indigo-400 text-[10px]">
              /api/webhook/whatsapp
            </code>
          </div>
        </div>
      </div>

      {/* Campanhas */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-sm">
            Campanhas ({company.campaigns.length})
          </h2>
          <Link
            href={`/empresas/${id}/campanhas/nova`}
            className="text-indigo-400 text-xs font-medium hover:underline"
          >
            + Nova campanha
          </Link>
        </div>

        {company.campaigns.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📣</div>
            <div className="text-slate-500 text-sm">Nenhuma campanha cadastrada</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Campanha</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Origem</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Status</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Leads</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Mensagens</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Criada</th>
                </tr>
              </thead>
              <tbody>
                {company.campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                    <td className="py-2.5 px-2">
                      <Link href={`/campanhas/${c.id}`} className="text-white text-[13px] font-semibold hover:text-indigo-300 transition-colors">{c.name}</Link>
                      {c.description && (
                        <div className="text-slate-500 text-[11px] truncate max-w-[180px]">{c.description}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-2">
                      <span className="text-sm">{sourceIcon[c.source]} </span>
                      <span className="text-slate-400 text-xs">{c.source}</span>
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          c.status === "ACTIVE"
                            ? "text-green-400 bg-green-500/12"
                            : c.status === "PAUSED"
                            ? "text-yellow-400 bg-yellow-500/12"
                            : "text-slate-400 bg-slate-500/10"
                        }`}
                      >
                        {c.status === "ACTIVE" ? "Ativa" : c.status === "PAUSED" ? "Pausada" : "Encerrada"}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-white font-semibold text-sm">
                      {c._count.leads}
                    </td>
                    <td className="py-2.5 px-2 text-slate-400 text-sm">
                      {c._count.messages}
                    </td>
                    <td className="py-2.5 px-2 text-slate-500 text-[11px]">
                      {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leads & Prospectos */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-sm">🎯 Leads & Prospectos ({leadsCount + prospeccaoCount})</h2>
          <Link href={`/crm/leads`} className="text-indigo-400 text-xs font-medium hover:underline">Ver todos →</Link>
        </div>
        {recentLeads.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-6">Nenhum lead cadastrado</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Nome / Telefone</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Pipeline</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Etapa</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((l) => (
                  <tr key={l.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                    <td className="py-2.5 px-2">
                      <div className="text-white text-[13px] font-semibold">{l.name ?? l.phone}</div>
                      {l.name && <div className="text-slate-600 text-[10px]">{l.phone}</div>}
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        l.pipeline === "PROSPECCAO" ? "text-violet-400 bg-violet-500/15" :
                        l.pipeline === "LEADS" ? "text-blue-400 bg-blue-500/15" :
                        "text-slate-500 bg-white/5"
                      }`}>
                        {l.pipeline === "PROSPECCAO" ? "🔎 Prospecção" : l.pipeline === "LEADS" ? "🎯 Lead" : "📥 Entrada"}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-slate-400 text-xs">{l.pipelineStage ?? "—"}</td>
                    <td className="py-2.5 px-2 text-slate-500 text-[11px]">{new Date(l.createdAt).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Oportunidades */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-sm">💰 Oportunidades ({oportunidadesCount})</h2>
          <Link href={`/crm/oportunidades`} className="text-indigo-400 text-xs font-medium hover:underline">Ver todas →</Link>
        </div>
        {recentOportunidades.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-6">Nenhuma oportunidade cadastrada</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Nome / Telefone</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Etapa</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Valor</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {recentOportunidades.map((l) => (
                  <tr key={l.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                    <td className="py-2.5 px-2">
                      <div className="text-white text-[13px] font-semibold">{l.name ?? l.phone}</div>
                      {l.name && <div className="text-slate-600 text-[10px]">{l.phone}</div>}
                    </td>
                    <td className="py-2.5 px-2 text-slate-400 text-xs">{l.pipelineStage ?? "—"}</td>
                    <td className="py-2.5 px-2">
                      {l.value != null
                        ? <span className="text-green-400 font-semibold text-sm">R$ {l.value.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}</span>
                        : <span className="text-slate-600 text-xs">—</span>
                      }
                    </td>
                    <td className="py-2.5 px-2 text-slate-500 text-[11px]">{new Date(l.createdAt).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Chamados */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-sm">🎫 Chamados ({recentChamados.length >= 10 ? "10+" : recentChamados.length})</h2>
          <Link href="/chamados" className="text-indigo-400 text-xs font-medium hover:underline">Ver todos →</Link>
        </div>
        {recentChamados.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-6">Nenhum chamado registrado</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Título</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Etapa</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Prioridade</th>
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {recentChamados.map((t) => (
                  <tr key={t.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                    <td className="py-2.5 px-2">
                      <Link href={`/chamados/${t.id}`} className="text-white text-[13px] font-semibold hover:text-indigo-300 transition-colors">
                        {t.title}
                      </Link>
                      <div className={`text-[10px] font-medium mt-0.5 ${
                        t.status === "OPEN" ? "text-indigo-400" :
                        t.status === "IN_PROGRESS" ? "text-blue-400" :
                        t.status === "RESOLVED" ? "text-green-400" : "text-slate-500"
                      }`}>
                        {t.status === "OPEN" ? "Aberto" : t.status === "IN_PROGRESS" ? "Em Andamento" : t.status === "RESOLVED" ? "Resolvido" : "Fechado"}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-slate-400 text-xs">{t.ticketStage ?? "—"}</td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[10px] font-semibold ${
                        t.priority === "URGENT" ? "text-red-400" :
                        t.priority === "HIGH" ? "text-orange-400" :
                        t.priority === "MEDIUM" ? "text-yellow-400" : "text-slate-400"
                      }`}>
                        {t.priority === "URGENT" ? "🔴 Urgente" : t.priority === "HIGH" ? "🟠 Alta" : t.priority === "MEDIUM" ? "🟡 Média" : "🟢 Baixa"}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-slate-500 text-[11px]">{new Date(t.createdAt).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Contatos WhatsApp */}
      <CompanyContacts
        companyId={id}
        initialContacts={contacts as any}
      />
    </div>
  );
}
