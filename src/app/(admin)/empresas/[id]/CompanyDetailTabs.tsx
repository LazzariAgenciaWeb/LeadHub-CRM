"use client";

import { useState } from "react";
import Link from "next/link";
import CompanyContacts from "./CompanyContacts";
import CompanyVault from "./CompanyVault";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  source: string;
  status: string;
  createdAt: string;
  _count: { leads: number; messages: number };
}

interface Lead {
  id: string;
  name: string | null;
  phone: string;
  pipeline: string;
  pipelineStage: string | null;
  status: string;
  createdAt: string;
}

interface Oportunidade {
  id: string;
  name: string | null;
  phone: string;
  pipelineStage: string | null;
  value: number | null;
  createdAt: string;
}

interface Chamado {
  id: string;
  title: string;
  priority: string;
  status: string;
  ticketStage: string | null;
  createdAt: string;
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
  campaigns: Campaign[];
  recentLeads: Lead[];
  leadsCount: number;
  prospeccaoCount: number;
  recentOportunidades: Oportunidade[];
  oportunidadesCount: number;
  recentChamados: Chamado[];
  contacts: Contact[];
  isSuperAdmin: boolean;
}

const SOURCE_ICON: Record<string, string> = {
  WHATSAPP: "💬", INSTAGRAM: "📸", FACEBOOK: "👥",
  GOOGLE: "🔍", LINK: "🔗", OTHER: "📌",
};

type TabId = "campanhas" | "leads" | "oportunidades" | "chamados" | "contatos" | "cofre";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "campanhas",    label: "Campanhas",    icon: "📣" },
  { id: "leads",        label: "Leads",        icon: "🎯" },
  { id: "oportunidades",label: "Oportunidades",icon: "💰" },
  { id: "chamados",     label: "Chamados",     icon: "🎫" },
  { id: "contatos",     label: "Contatos WA",  icon: "📱" },
  { id: "cofre",        label: "Cofre",        icon: "🔐" },
];

export default function CompanyDetailTabs({
  companyId,
  campaigns,
  recentLeads,
  leadsCount,
  prospeccaoCount,
  recentOportunidades,
  oportunidadesCount,
  recentChamados,
  contacts,
  isSuperAdmin,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("campanhas");

  // Counts for tab labels
  const counts: Record<TabId, number> = {
    campanhas:     campaigns.length,
    leads:         leadsCount + prospeccaoCount,
    oportunidades: oportunidadesCount,
    chamados:      recentChamados.length,
    contatos:      contacts.length,
    cofre:         0, // count carregado dinamicamente dentro do componente
  };

  return (
    <div className="mt-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[#1e2d45] mb-0 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-all border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
            {counts[tab.id] > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                activeTab === tab.id
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "bg-white/5 text-slate-500"
              }`}>
                {counts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-b-xl rounded-tr-xl">

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

        {/* ── Leads ── */}
        {activeTab === "leads" && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-sm">🎯 Leads & Prospectos ({leadsCount + prospeccaoCount})</h2>
              <Link href="/crm/leads" className="text-indigo-400 text-xs font-medium hover:underline">Ver todos →</Link>
            </div>
            {recentLeads.length === 0 ? (
              <div className="text-slate-500 text-sm text-center py-8">Nenhum lead cadastrado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45]">
                      {["Nome / Telefone", "Pipeline", "Etapa", "Data"].map((h) => (
                        <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                      ))}
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
        )}

        {/* ── Oportunidades ── */}
        {activeTab === "oportunidades" && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-sm">💰 Oportunidades ({oportunidadesCount})</h2>
              <Link href="/crm/oportunidades" className="text-indigo-400 text-xs font-medium hover:underline">Ver todas →</Link>
            </div>
            {recentOportunidades.length === 0 ? (
              <div className="text-slate-500 text-sm text-center py-8">Nenhuma oportunidade cadastrada</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45]">
                      {["Nome / Telefone", "Etapa", "Valor", "Data"].map((h) => (
                        <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                      ))}
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
        )}

        {/* ── Chamados ── */}
        {activeTab === "chamados" && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-sm">🎫 Chamados ({recentChamados.length >= 10 ? "10+" : recentChamados.length})</h2>
              <Link href="/chamados" className="text-indigo-400 text-xs font-medium hover:underline">Ver todos →</Link>
            </div>
            {recentChamados.length === 0 ? (
              <div className="text-slate-500 text-sm text-center py-8">Nenhum chamado registrado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e2d45]">
                      {["Título", "Etapa", "Prioridade", "Data"].map((h) => (
                        <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                      ))}
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
        )}

        {/* ── Contatos WhatsApp ── */}
        {activeTab === "contatos" && (
          <CompanyContacts companyId={companyId} initialContacts={contacts as any} />
        )}

        {/* ── Cofre ── */}
        {activeTab === "cofre" && (
          <CompanyVault companyId={companyId} />
        )}
      </div>
    </div>
  );
}
