"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CompanyContacts from "./CompanyContacts";
import AddSystemUser from "./AddSystemUser";
import CompanyVault from "./CompanyVault";
import CompanyArquivos from "./CompanyArquivos";
import CompanyIntegrations from "./CompanyIntegrations";
import CompanyMarketing from "./CompanyMarketing";
import CompanySubscription from "./CompanySubscription";
import CompanyAchievements from "./CompanyAchievements";
import CompanyContractedServices from "./CompanyContractedServices";
import CompanyFinanceiro from "./CompanyFinanceiro";
import CompanyFinanceHistory, { type FinanceLogItem } from "./CompanyFinanceHistory";
import CompanyBillingNotes from "./CompanyBillingNotes";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  source: string;
  status: string;
  createdAt: string;
  _count: { leads: number; messages: number };
}

// Lead do CRM da AGÊNCIA que é este cliente (não um lead do painel dele).
interface Negociacao {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  pipeline: string | null;
  pipelineStage: string | null;
  value: number | null;
  outcome: "ABERTA" | "GANHA" | "PERDIDA";
  matchedBy: "venda" | "telefone" | "e-mail" | "nome";
  wonAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Venda {
  id: string;
  leadId: string | null;
  title: string;
  valueCents: number;
  kind: string;
  closedAt: string;
  sellerName: string | null;
  contractStatus: string;
  billingStatus: string;
  productionStatus: string;
  projectId: string | null;
}

interface Projeto {
  id: string;
  name: string;
  type: string | null;
  status: string;
  dueDate: string | null;
  deliveredAt: string | null;
  taskCount: number;
  taskCompleted: number;
  taskOverdue: number;
  createdAt: string;
  setorName: string | null;
  serviceName: string | null;
}

interface Chamado {
  id: string;
  title: string;
  priority: string;
  status: string;
  ticketStage: string | null;
  dueDate: string | null;
  createdAt: string;
  assigneeName: string | null;
  setorName: string | null;
}

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  isGroup: boolean;
  role: string;
  hasAccess: boolean;
  notes: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

interface Props {
  companyId: string;
  /** empresa-cliente (tem parentCompanyId) — libera a aba Arquivos */
  isClientCompany?: boolean;
  campaigns: Campaign[];
  // Relacionamento da agência com o cliente (vem do page.tsx já filtrado).
  negociacoes: Negociacao[];
  vendas: Venda[];
  projetos: Projeto[];
  chamados: Chamado[];
  contacts: Contact[];
  isSuperAdmin: boolean;
  // Financeiro do cliente — vinha solto acima da página; virou o primeiro
  // grupo de abas pra que o topo fique com a identificação do cliente.
  contracted: any[];
  catalog: { id: string; name: string }[];
  invoices: any[];
  financeLogs: FinanceLogItem[];
  billingNotes: string | null;
}

const SOURCE_ICON: Record<string, string> = {
  WHATSAPP: "💬", INSTAGRAM: "📸", FACEBOOK: "👥",
  GOOGLE: "🔍", LINK: "🔗", OTHER: "📌",
};

const PIPELINE_HREF: Record<string, string> = {
  PROSPECCAO: "/crm/prospeccao", LEADS: "/crm/leads", OPORTUNIDADES: "/crm/oportunidades",
};
const PIPELINE_BADGE: Record<string, { label: string; cls: string }> = {
  PROSPECCAO:    { label: "🔎 Prospecção",   cls: "text-violet-400 bg-violet-500/15" },
  LEADS:         { label: "🎯 Lead",         cls: "text-blue-400 bg-blue-500/15" },
  OPORTUNIDADES: { label: "💰 Oportunidade", cls: "text-amber-400 bg-amber-500/15" },
};
const OUTCOME_BADGE: Record<Negociacao["outcome"], { label: string; cls: string }> = {
  ABERTA:  { label: "Em aberto", cls: "text-amber-300 bg-amber-500/15 border-amber-500/30" },
  GANHA:   { label: "Ganha",     cls: "text-green-400 bg-green-500/15 border-green-500/30" },
  PERDIDA: { label: "Perdida",   cls: "text-red-400 bg-red-500/10 border-red-500/30" },
};
const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANEJAMENTO:       { label: "📝 Planejamento",       cls: "text-slate-300 bg-slate-500/15" },
  EM_ANDAMENTO:       { label: "🚧 Em andamento",       cls: "text-blue-400 bg-blue-500/15" },
  AGUARDANDO_CLIENTE: { label: "⏳ Aguardando cliente", cls: "text-amber-400 bg-amber-500/15" },
  PAUSADO:            { label: "⏸ Pausado",            cls: "text-slate-400 bg-slate-500/10" },
  ENTREGUE:           { label: "✅ Entregue",            cls: "text-green-400 bg-green-500/15" },
  CANCELADO:          { label: "❌ Cancelado",           cls: "text-red-400 bg-red-500/10" },
};
// Esteira pós-venda: cada etapa com sua cor, pra ler de relance o que falta.
const ESTEIRA_STEP: Record<string, { label: string; cls: string }> = {
  PENDENTE:   { label: "pendente",   cls: "text-amber-300 bg-amber-500/10" },
  ENVIADO:    { label: "enviado",    cls: "text-blue-300 bg-blue-500/10" },
  ASSINADO:   { label: "assinado",   cls: "text-green-400 bg-green-500/10" },
  FATURADO:   { label: "faturado",   cls: "text-green-400 bg-green-500/10" },
  LIBERADO:   { label: "em produção",cls: "text-blue-300 bg-blue-500/10" },
  ENTREGUE:   { label: "entregue",   cls: "text-green-400 bg-green-500/10" },
  DISPENSADO: { label: "dispensado", cls: "text-slate-500 bg-slate-500/10" },
};
const TICKET_STATUS: Record<string, { label: string; cls: string }> = {
  OPEN:        { label: "Aberto",       cls: "text-indigo-400" },
  IN_PROGRESS: { label: "Em andamento", cls: "text-blue-400" },
  RESOLVED:    { label: "Resolvido",    cls: "text-green-400" },
  CLOSED:      { label: "Fechado",      cls: "text-slate-500" },
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const fmtBRL = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const isOverdue = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

type TabId =
  | "servicos" | "cobrancas" | "historico"
  | "negociacoes" | "vendas" | "projetos" | "chamados"
  | "campanhas" | "contatos" | "cofre" | "integracoes" | "marketing" | "plano" | "conquistas"
  | "arquivos";

const TABS: { id: TabId; label: string; icon: string; superAdminOnly?: boolean }[] = [
  { id: "servicos",     label: "Serviços contratados", icon: "📦" },
  { id: "cobrancas",    label: "Cobranças",    icon: "🧾" },
  { id: "historico",    label: "Histórico",    icon: "🕓" },
  { id: "negociacoes",  label: "Negociações",  icon: "🤝" },
  { id: "vendas",       label: "Vendas fechadas", icon: "🏆" },
  { id: "projetos",     label: "Projetos",     icon: "🧩" },
  { id: "chamados",     label: "Chamados",     icon: "🎫" },
  { id: "marketing",    label: "Marketing",    icon: "📊" },
  { id: "campanhas",    label: "Campanhas",    icon: "📣" },
  { id: "contatos",     label: "Contatos WA",  icon: "📱" },
  { id: "conquistas",   label: "Conquistas",   icon: "🏆", superAdminOnly: true },
  { id: "cofre",        label: "Cofre",        icon: "🔐" },
  { id: "arquivos",     label: "Arquivos",     icon: "🗂" },
  { id: "integracoes",  label: "Integrações",  icon: "🔌" },
  { id: "plano",        label: "Plano",        icon: "💳", superAdminOnly: true },
];
const TAB_BY_ID = Object.fromEntries(TABS.map((t) => [t.id, t])) as Record<TabId, (typeof TABS)[number]>;

// Grupos de 1º nível. Grupo com >1 aba mostra uma barra de sub-abas embaixo;
// grupo com 1 aba abre direto.
// Financeiro vem primeiro: é o que se abre no dia a dia da conta. Depois vem
// o que a AGÊNCIA tem com o cliente (negociações, projetos, chamados) — o
// antigo grupo "CRM" mostrava os leads do painel DELE, que não é o que se
// procura no cadastro. O painel dele (marketing, integrações, campanhas)
// ficou agrupado em "Marketing".
const GROUPS: { id: string; label: string; icon: string; tabIds: TabId[] }[] = [
  { id: "financeiro",  label: "Financeiro",         icon: "💰", tabIds: ["servicos", "cobrancas", "historico"] },
  { id: "negociacoes", label: "Negociações",        icon: "🤝", tabIds: ["negociacoes", "vendas"] },
  { id: "projetos",    label: "Projetos",           icon: "🧩", tabIds: ["projetos"] },
  { id: "chamados",    label: "Chamados",           icon: "🎫", tabIds: ["chamados"] },
  { id: "acessos",     label: "Acessos & usuários", icon: "👥", tabIds: ["contatos"] },
  { id: "marketing",   label: "Marketing",          icon: "📊", tabIds: ["marketing", "integracoes", "campanhas", "conquistas"] },
  { id: "cofre",       label: "Cofre",              icon: "🔐", tabIds: ["cofre"] },
  { id: "arquivos",    label: "Arquivos",           icon: "🗂", tabIds: ["arquivos"] },
  { id: "plano",       label: "Plano & cobrança",   icon: "💳", tabIds: ["plano"] },
];

export default function CompanyDetailTabs({
  companyId,
  campaigns,
  negociacoes,
  vendas,
  projetos,
  chamados,
  contacts,
  isSuperAdmin,
  contracted,
  catalog,
  invoices,
  financeLogs,
  billingNotes,
  isClientCompany = false,
}: Props) {
  // Counts for tab labels
  const counts: Record<TabId, number> = {
    servicos:      contracted.length,
    // Só o que está em aberto: cobrança paga não é pendência, e o número na
    // aba serve pra dizer "tem coisa esperando aqui".
    cobrancas:     invoices.filter((i) => i.status === "ABERTO").length,
    historico:     0,
    campanhas:     campaigns.length,
    // Só o que está vivo: negociação em aberto, projeto não entregue, chamado
    // não resolvido. Ganhas/entregues/fechados ficam na lista, mas não no badge.
    negociacoes:   negociacoes.filter((n) => n.outcome === "ABERTA").length,
    vendas:        vendas.length,
    projetos:      projetos.filter((p) => p.status !== "ENTREGUE" && p.status !== "CANCELADO").length,
    chamados:      chamados.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS").length,
    contatos:      contacts.length,
    cofre:         0, // count carregado dinamicamente dentro do componente
    integracoes:   0, // count carregado dinamicamente dentro do componente
    marketing:     0, // count carregado dinamicamente dentro do componente
    plano:         0, // sem contagem
    conquistas:    0, // count carregado dinamicamente dentro do componente
    arquivos:      0,
  };

  // Abas visíveis (respeita superAdminOnly), agrupadas em 5 grupos de 1º nível.
  // Arquivos = biblioteca do Meu Espaço — só existe pra empresa-cliente.
  const isTabVisible = (id: TabId) =>
    (!TAB_BY_ID[id].superAdminOnly || isSuperAdmin) && (id !== "arquivos" || isClientCompany);
  const visibleGroups = GROUPS
    .map((g) => ({ ...g, tabs: g.tabIds.filter(isTabVisible) }))
    .filter((g) => g.tabs.length > 0);

  const [activeTab, setActiveTab] = useState<TabId>(visibleGroups[0]?.tabs[0] ?? "campanhas");
  const activeGroup = visibleGroups.find((g) => g.tabs.includes(activeTab)) ?? visibleGroups[0];

  // Âncoras vindas de fora (esteira, fila de faturamento) abrem a aba certa.
  // Sem isto, `/empresas/x#financeiro` caía na primeira aba e o link parecia
  // quebrado — o alvo deixou de ser um bloco na página e virou aba.
  useEffect(() => {
    const porAncora: Record<string, TabId> = {
      "#financeiro": "cobrancas",
      "#servicos": "servicos",
      "#historico": "historico",
      "#negociacoes": "negociacoes",
      "#vendas": "vendas",
      "#projetos": "projetos",
      "#chamados": "chamados",
      "#cofre": "cofre",
      "#arquivos": "arquivos",
    };
    const alvo = porAncora[window.location.hash];
    if (alvo) {
      setActiveTab(alvo);
      document.getElementById("empresa-abas")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  return (
    <div className="mt-6">
      {/* Barra de grupos (1º nível) — 5 grupos condensam as 10 abas */}
      <div className="flex gap-1 border-b border-[#1e2d45] mb-0 overflow-x-auto">
        {visibleGroups.map((g) => {
          const isActive = g.tabs.includes(activeTab);
          const single = g.tabs.length === 1;
          return (
            <button
              key={g.id}
              onClick={() => setActiveTab(g.tabs[0])}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-all border-b-2 -mb-px ${
                isActive
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              <span>{g.icon}</span>
              {g.label}
              {single && counts[g.tabs[0]] > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  isActive ? "bg-indigo-500/20 text-indigo-300" : "bg-white/5 text-slate-500"
                }`}>
                  {counts[g.tabs[0]]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-b-xl rounded-tr-xl">

        {/* Sub-abas (2º nível) — só quando o grupo ativo tem mais de uma aba */}
        {activeGroup && activeGroup.tabs.length > 1 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2.5 border-b border-[#1e2d45]">
            {activeGroup.tabs.map((id) => {
              const t = TAB_BY_ID[id];
              const on = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all ${
                    on
                      ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40"
                      : "text-slate-500 hover:text-slate-300 border border-transparent hover:bg-white/5"
                  }`}
                >
                  <span>{t.icon}</span>
                  {t.label}
                  {counts[id] > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      on ? "bg-indigo-500/30 text-indigo-100" : "bg-white/5 text-slate-500"
                    }`}>
                      {counts[id]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Serviços contratados ── */}
        {activeTab === "servicos" && (
          <div className="p-5">
            <CompanyContractedServices companyId={companyId} initial={contracted} catalog={catalog} />
          </div>
        )}

        {/* ── Cobranças ── */}
        {activeTab === "cobrancas" && (
          <div className="p-5">
            <CompanyBillingNotes companyId={companyId} initial={billingNotes} />
            <CompanyFinanceiro
              companyId={companyId}
              initial={invoices}
              services={contracted.map((c: any) => ({ id: c.id, label: c.label }))}
            />
          </div>
        )}

        {/* ── Histórico do financeiro ── */}
        {activeTab === "historico" && (
          <div className="p-5">
            <CompanyFinanceHistory logs={financeLogs} />
          </div>
        )}

        {/* ── Campanhas ── */}
        {activeTab === "campanhas" && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-sm">Campanhas ({campaigns.length})</h2>
              {isSuperAdmin && (
                <Link
                  href={`/empresas/${companyId}/campanhas/nova`}
                  className="text-indigo-400 text-xs font-medium hover:underline"
                >
                  + Nova campanha
                </Link>
              )}
            </div>
            {campaigns.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-3xl mb-2">📣</div>
                <div className="text-slate-500 text-sm">Nenhuma campanha cadastrada</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45]">
                      {["Campanha", "Origem", "Status", "Leads", "Mensagens", "Criada"].map((h) => (
                        <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                        <td className="py-2.5 px-2">
                          <Link href={`/campanhas/${c.id}`} className="text-white text-[13px] font-semibold hover:text-indigo-300 transition-colors">{c.name}</Link>
                          {c.description && <div className="text-slate-500 text-[11px] truncate max-w-[180px]">{c.description}</div>}
                        </td>
                        <td className="py-2.5 px-2">
                          <span className="text-sm">{SOURCE_ICON[c.source]} </span>
                          <span className="text-slate-400 text-xs">{c.source}</span>
                        </td>
                        <td className="py-2.5 px-2">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            c.status === "ACTIVE" ? "text-green-400 bg-green-500/12" :
                            c.status === "PAUSED" ? "text-yellow-400 bg-yellow-500/12" :
                            "text-slate-400 bg-slate-500/10"
                          }`}>
                            {c.status === "ACTIVE" ? "Ativa" : c.status === "PAUSED" ? "Pausada" : "Encerrada"}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-white font-semibold text-sm">{c._count.leads}</td>
                        <td className="py-2.5 px-2 text-slate-400 text-sm">{c._count.messages}</td>
                        <td className="py-2.5 px-2 text-slate-500 text-[11px]">{new Date(c.createdAt).toLocaleDateString("pt-BR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Negociações (leads do CRM da agência que são este cliente) ── */}
        {activeTab === "negociacoes" && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="text-white font-bold text-sm">🤝 Negociações com este cliente ({negociacoes.length})</h2>
              <Link href="/crm/oportunidades" className="text-indigo-400 text-xs font-medium hover:underline">Abrir CRM →</Link>
            </div>
            <p className="text-slate-500 text-xs mb-4">
              Leads e oportunidades do <b className="text-slate-400">nosso</b> CRM que são este cliente — casados por venda vinculada, telefone, e-mail ou nome.
            </p>
            {negociacoes.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-3xl mb-2">🤝</div>
                <div className="text-slate-500 text-sm">Nenhuma negociação encontrada com este cliente</div>
                <div className="text-slate-600 text-xs mt-1">
                  Cadastre o telefone ou e-mail do cliente, ou vincule a venda na esteira, pra ela aparecer aqui.
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45]">
                      {["Negociação", "Pipeline", "Etapa", "Valor", "Situação", "Última mexida"].map((h) => (
                        <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {negociacoes.map((n) => {
                      const pb = PIPELINE_BADGE[n.pipeline ?? ""];
                      const ob = OUTCOME_BADGE[n.outcome];
                      const href = `${PIPELINE_HREF[n.pipeline ?? ""] ?? "/crm/leads"}?lead=${n.id}`;
                      return (
                        <tr key={n.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                          <td className="py-2.5 px-2">
                            <Link href={href} className="text-white text-[13px] font-semibold hover:text-indigo-300 transition-colors">
                              {n.name ?? n.phone}
                            </Link>
                            <div className="text-slate-600 text-[10px]">
                              {n.name ? n.phone : n.email ?? ""}
                              <span className="ml-1.5 text-slate-700">· via {n.matchedBy}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-2">
                            {pb
                              ? <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${pb.cls}`}>{pb.label}</span>
                              : <span className="text-slate-600 text-xs">—</span>}
                          </td>
                          <td className="py-2.5 px-2 text-slate-400 text-xs">{n.pipelineStage ?? "—"}</td>
                          <td className="py-2.5 px-2">
                            {n.value != null
                              ? <span className="text-green-400 font-semibold text-sm">{fmtBRL(n.value)}</span>
                              : <span className="text-slate-600 text-xs">—</span>}
                          </td>
                          <td className="py-2.5 px-2">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ob.cls}`}>{ob.label}</span>
                            {n.outcome === "GANHA" && n.wonAt && <div className="text-slate-600 text-[10px] mt-0.5">{fmtDate(n.wonAt)}</div>}
                            {n.outcome === "PERDIDA" && n.lostAt && <div className="text-slate-600 text-[10px] mt-0.5">{fmtDate(n.lostAt)}</div>}
                          </td>
                          <td className="py-2.5 px-2 text-slate-500 text-[11px]">{fmtDate(n.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Vendas fechadas (esteira) ── */}
        {activeTab === "vendas" && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="text-white font-bold text-sm">
                🏆 Vendas fechadas ({vendas.length})
                {vendas.length > 0 && (
                  <span className="text-green-400 text-xs font-semibold ml-2">
                    {fmtBRL(vendas.reduce((a, v) => a + v.valueCents, 0) / 100)}
                  </span>
                )}
              </h2>
              <Link href="/financeiro/esteira" className="text-indigo-400 text-xs font-medium hover:underline">Abrir esteira →</Link>
            </div>
            <p className="text-slate-500 text-xs mb-4">Vendas da esteira pós-venda vinculadas a este cliente, com o andamento de contrato, faturamento e produção.</p>
            {vendas.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-3xl mb-2">🏆</div>
                <div className="text-slate-500 text-sm">Nenhuma venda vinculada a este cliente</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45]">
                      {["Venda", "Valor", "Fechada em", "Vendedor", "Contrato", "Faturamento", "Produção"].map((h) => (
                        <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vendas.map((v) => {
                      const step = (k: string) => {
                        const st = ESTEIRA_STEP[k] ?? { label: k.toLowerCase(), cls: "text-slate-400 bg-white/5" };
                        return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>;
                      };
                      return (
                        <tr key={v.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                          <td className="py-2.5 px-2">
                            <div className="text-white text-[13px] font-semibold">{v.title}</div>
                            <div className="text-slate-600 text-[10px] flex gap-2">
                              <span>{v.kind === "RECORRENTE" ? "🔁 Recorrente" : "⚡ Pontual"}</span>
                              {v.projectId && <Link href={`/projetos/${v.projectId}`} className="text-indigo-400 hover:underline">🧩 projeto</Link>}
                              {v.leadId && <Link href={`/crm/oportunidades?lead=${v.leadId}`} className="text-indigo-400 hover:underline">🤝 negociação</Link>}
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-green-400 font-semibold text-sm">{fmtBRL(v.valueCents / 100)}</td>
                          <td className="py-2.5 px-2 text-slate-400 text-xs">{fmtDate(v.closedAt)}</td>
                          <td className="py-2.5 px-2 text-slate-400 text-xs">{v.sellerName ?? "—"}</td>
                          <td className="py-2.5 px-2">{step(v.contractStatus)}</td>
                          <td className="py-2.5 px-2">{step(v.billingStatus)}</td>
                          <td className="py-2.5 px-2">{step(v.productionStatus)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Projetos do cliente ── */}
        {activeTab === "projetos" && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-white font-bold text-sm">🧩 Projetos ({projetos.length})</h2>
              <div className="flex items-center gap-3">
                <Link href="/projetos" className="text-indigo-400 text-xs font-medium hover:underline">Ver todos →</Link>
                <Link href="/projetos/novo" className="text-indigo-400 text-xs font-medium hover:underline">+ Novo projeto</Link>
              </div>
            </div>
            {projetos.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-3xl mb-2">🧩</div>
                <div className="text-slate-500 text-sm">Nenhum projeto para este cliente</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45]">
                      {["Projeto", "Status", "Tarefas", "Prazo", "Criado"].map((h) => (
                        <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {projetos.map((p) => {
                      const st = PROJECT_STATUS[p.status] ?? { label: p.status, cls: "text-slate-400 bg-white/5" };
                      const closed = p.status === "ENTREGUE" || p.status === "CANCELADO";
                      const late = !closed && isOverdue(p.dueDate);
                      return (
                        <tr key={p.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                          <td className="py-2.5 px-2">
                            <Link href={`/projetos/${p.id}`} className="text-white text-[13px] font-semibold hover:text-indigo-300 transition-colors">{p.name}</Link>
                            <div className="text-slate-600 text-[10px]">
                              {[p.type, p.serviceName, p.setorName].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </td>
                          <td className="py-2.5 px-2">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="py-2.5 px-2 text-xs">
                            {p.taskCount > 0
                              ? <span className="text-slate-300">{p.taskCompleted}/{p.taskCount}{p.taskOverdue > 0 && <span className="text-red-400 ml-1.5">⚠ {p.taskOverdue} atrasada{p.taskOverdue > 1 ? "s" : ""}</span>}</span>
                              : <span className="text-slate-600">—</span>}
                          </td>
                          <td className={`py-2.5 px-2 text-xs ${late ? "text-red-400 font-semibold" : "text-slate-400"}`}>
                            {closed && p.deliveredAt ? `entregue ${fmtDate(p.deliveredAt)}` : fmtDate(p.dueDate)}
                          </td>
                          <td className="py-2.5 px-2 text-slate-500 text-[11px]">{fmtDate(p.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Chamados abertos PARA este cliente ── */}
        {activeTab === "chamados" && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-white font-bold text-sm">🎫 Chamados ({chamados.length >= 60 ? "60+" : chamados.length})</h2>
              <div className="flex items-center gap-3">
                <Link href="/chamados" className="text-indigo-400 text-xs font-medium hover:underline">Ver todos →</Link>
                <Link href="/chamados/novo" className="text-indigo-400 text-xs font-medium hover:underline">+ Novo chamado</Link>
              </div>
            </div>
            {chamados.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-3xl mb-2">🎫</div>
                <div className="text-slate-500 text-sm">Nenhum chamado para este cliente</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45]">
                      {["Título", "Etapa", "Prioridade", "Responsável", "Prazo", "Aberto em"].map((h) => (
                        <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {chamados.map((t) => {
                      const st = TICKET_STATUS[t.status] ?? { label: t.status, cls: "text-slate-500" };
                      const open = t.status === "OPEN" || t.status === "IN_PROGRESS";
                      const late = open && isOverdue(t.dueDate);
                      return (
                        <tr key={t.id} className={`border-b border-[#1e2d45]/50 hover:bg-white/[0.02] ${open ? "" : "opacity-60"}`}>
                          <td className="py-2.5 px-2">
                            <Link href={`/chamados/${t.id}`} className="text-white text-[13px] font-semibold hover:text-indigo-300 transition-colors">
                              {t.title}
                            </Link>
                            <div className={`text-[10px] font-medium mt-0.5 ${st.cls}`}>
                              {st.label}{t.setorName && <span className="text-slate-600"> · {t.setorName}</span>}
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
                          <td className="py-2.5 px-2 text-slate-400 text-xs">{t.assigneeName ?? "—"}</td>
                          <td className={`py-2.5 px-2 text-xs ${late ? "text-red-400 font-semibold" : "text-slate-400"}`}>{fmtDate(t.dueDate)}</td>
                          <td className="py-2.5 px-2 text-slate-500 text-[11px]">{fmtDate(t.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Acessos & usuários (criar login + Contatos WhatsApp) ── */}
        {activeTab === "contatos" && (
          <div className="p-5">
            <AddSystemUser companyId={companyId} />
            <CompanyContacts companyId={companyId} initialContacts={contacts as any} />
          </div>
        )}

        {/* ── Cofre ── */}
        {activeTab === "arquivos" && (
          <div className="p-5">
            <CompanyArquivos clientId={companyId} />
          </div>
        )}

        {activeTab === "cofre" && (
          <CompanyVault companyId={companyId} />
        )}

        {/* ── Integrações ── */}
        {activeTab === "integracoes" && (
          <CompanyIntegrations companyId={companyId} />
        )}

        {/* ── Marketing (Dashboard) ── */}
        {activeTab === "marketing" && (
          <CompanyMarketing companyId={companyId} />
        )}

        {/* ── Plano (super admin) ── */}
        {activeTab === "plano" && isSuperAdmin && (
          <CompanySubscription companyId={companyId} />
        )}

        {/* ── Conquistas (super admin) ── */}
        {activeTab === "conquistas" && isSuperAdmin && (
          <CompanyAchievements companyId={companyId} />
        )}
      </div>
    </div>
  );
}
