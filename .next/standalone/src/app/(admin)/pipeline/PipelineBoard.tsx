"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Lead {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  value: number | null;
  createdAt: string;
  company: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
}

const COLUMNS = [
  { key: "NEW", label: "Novos", icon: "🎯", colorBar: "#6366f1", bg: "bg-indigo-500/5 border-indigo-500/20" },
  { key: "CONTACTED", label: "Em Contato", icon: "📞", colorBar: "#3b82f6", bg: "bg-blue-500/5 border-blue-500/20" },
  { key: "PROPOSAL", label: "Proposta", icon: "📋", colorBar: "#eab308", bg: "bg-yellow-500/5 border-yellow-500/20" },
  { key: "CLOSED", label: "Fechados", icon: "✅", colorBar: "#22c55e", bg: "bg-green-500/5 border-green-500/20" },
  { key: "LOST", label: "Perdidos", icon: "❌", colorBar: "#ef4444", bg: "bg-red-500/5 border-red-500/20" },
];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  NEW: { label: "Novo", color: "text-indigo-400 bg-indigo-500/15" },
  CONTACTED: { label: "Em Contato", color: "text-blue-400 bg-blue-500/15" },
  PROPOSAL: { label: "Proposta", color: "text-yellow-400 bg-yellow-500/15" },
  CLOSED: { label: "Fechado", color: "text-green-400 bg-green-500/15" },
  LOST: { label: "Perdido", color: "text-red-400 bg-red-500/10" },
};

const SOURCE_ICON: Record<string, string> = {
  whatsapp: "💬",
  instagram: "📸",
  facebook: "👥",
  google: "🔍",
  link: "🔗",
};

export default function PipelineBoard({
  leads,
  isSuperAdmin,
  companies,
  campaigns,
  filterCompanyId,
  filterCampaignId,
}: {
  leads: Lead[];
  isSuperAdmin: boolean;
  companies: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  filterCompanyId: string;
  filterCampaignId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // Group leads by status
  const columns: Record<string, Lead[]> = {};
  for (const col of COLUMNS) columns[col.key] = [];
  for (const lead of leads) {
    if (columns[lead.status]) columns[lead.status].push(lead);
  }

  async function moveToStatus(leadId: string, newStatus: string) {
    setMovingId(leadId);
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setMovingId(null);
    startTransition(() => router.refresh());
  }

  function onDragStart(e: React.DragEvent, leadId: string) {
    e.dataTransfer.setData("leadId", leadId);
  }

  function onDrop(e: React.DragEvent, colKey: string) {
    e.preventDefault();
    setDragOverCol(null);
    const leadId = e.dataTransfer.getData("leadId");
    if (leadId) moveToStatus(leadId, colKey);
  }

  const totalValue = leads
    .filter((l) => l.status === "CLOSED" && l.value != null)
    .reduce((sum, l) => sum + (l.value ?? 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
        <div>
          <h1 className="text-white font-bold text-xl">Pipeline</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {leads.length} lead{leads.length !== 1 ? "s" : ""} ·{" "}
            <span className="text-green-400 font-medium">
              R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em fechados
            </span>
          </p>
        </div>

        {/* Filters */}
        <form className="flex gap-2">
          {isSuperAdmin && (
            <select
              name="companyId"
              defaultValue={filterCompanyId}
              className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Todas as empresas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <select
            name="campaignId"
            defaultValue={filterCampaignId}
            className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todas as campanhas</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-500 transition-colors"
          >
            Filtrar
          </button>
        </form>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto px-6 pb-6">
        <div className="flex gap-4 h-full min-w-[900px]">
          {COLUMNS.map((col) => {
            const colLeads = columns[col.key];
            const colValue = colLeads
              .filter((l) => l.value != null)
              .reduce((s, l) => s + (l.value ?? 0), 0);

            return (
              <div
                key={col.key}
                className={`flex flex-col flex-1 min-w-[200px] rounded-xl border ${col.bg} transition-all ${dragOverCol === col.key ? "ring-2 ring-white/20 scale-[1.01]" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={(e) => onDrop(e, col.key)}
              >
                {/* Column header */}
                <div className="px-3 pt-3 pb-2 flex items-center justify-between flex-shrink-0"
                  style={{ borderBottom: `2px solid ${col.colorBar}30` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{col.icon}</span>
                    <span className="text-white font-semibold text-sm">{col.label}</span>
                    <span className="bg-white/10 text-slate-300 text-[11px] font-bold px-1.5 py-0.5 rounded-full">
                      {colLeads.length}
                    </span>
                  </div>
                  {colValue > 0 && (
                    <span className="text-[10px] text-green-400 font-medium">
                      R$ {colValue.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                    </span>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {colLeads.length === 0 && (
                    <div className="text-center py-8 text-slate-600 text-xs">
                      Arraste leads aqui
                    </div>
                  )}
                  {colLeads.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, lead.id)}
                      onClick={() => setSelected(lead)}
                      className={`bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-white/20 transition-all ${movingId === lead.id ? "opacity-40" : ""}`}
                    >
                      <div className="text-white text-[13px] font-semibold mb-0.5 truncate">
                        {lead.name ?? "Sem nome"}
                      </div>
                      <div className="text-slate-500 text-[11px] mb-2">{lead.phone}</div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {lead.source && (
                            <span className="text-[12px]" title={lead.source}>
                              {SOURCE_ICON[lead.source] ?? "🔵"}
                            </span>
                          )}
                          {lead.campaign && (
                            <span className="text-[10px] text-slate-600 truncate max-w-[80px]" title={lead.campaign.name}>
                              {lead.campaign.name}
                            </span>
                          )}
                        </div>
                        {lead.value != null && (
                          <span className="text-[11px] text-green-400 font-semibold">
                            R$ {lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                          </span>
                        )}
                      </div>

                      {isSuperAdmin && lead.company && (
                        <div className="text-[10px] text-slate-600 mt-1 truncate">{lead.company.name}</div>
                      )}

                      {/* Move buttons */}
                      <div className="flex gap-1 mt-2 pt-2 border-t border-[#1e2d45]">
                        {COLUMNS.filter((c) => c.key !== col.key).map((target) => (
                          <button
                            key={target.key}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveToStatus(lead.id, target.key);
                            }}
                            title={`Mover para ${target.label}`}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                          >
                            {target.icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lead Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setSelected(null)} />
          <div className="relative bg-[#0f1623] border border-[#1e2d45] rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-lg">Detalhes do Lead</h2>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white text-xl">×</button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold flex-shrink-0">
                  {(selected.name ?? selected.phone).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-white font-semibold">{selected.name ?? "Sem nome"}</div>
                  <div className="text-slate-500 text-sm">{selected.phone}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="bg-[#161f30] rounded-lg p-3">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Status</div>
                  <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${STATUS_LABEL[selected.status]?.color ?? ""}`}>
                    {STATUS_LABEL[selected.status]?.label ?? selected.status}
                  </span>
                </div>
                <div className="bg-[#161f30] rounded-lg p-3">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Origem</div>
                  <div className="text-white text-sm">
                    {SOURCE_ICON[selected.source ?? ""] ?? "🔵"} {selected.source ?? "—"}
                  </div>
                </div>
                {selected.campaign && (
                  <div className="bg-[#161f30] rounded-lg p-3 col-span-2">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Campanha</div>
                    <div className="text-white text-sm">{selected.campaign.name}</div>
                  </div>
                )}
                {selected.value != null && (
                  <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 col-span-2">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Valor</div>
                    <div className="text-green-400 font-bold text-xl">
                      R$ {selected.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                )}
              </div>

              {selected.notes && (
                <div className="bg-[#161f30] rounded-lg p-3">
                  <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Notas</div>
                  <div className="text-slate-300 text-sm whitespace-pre-wrap">{selected.notes}</div>
                </div>
              )}

              <div className="text-slate-600 text-xs text-right">
                Entrada: {new Date(selected.createdAt).toLocaleString("pt-BR")}
              </div>

              {/* Quick move buttons */}
              <div>
                <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">Mover para</div>
                <div className="flex flex-wrap gap-2">
                  {COLUMNS.filter((c) => c.key !== selected.status).map((target) => (
                    <button
                      key={target.key}
                      onClick={async () => {
                        await moveToStatus(selected.id, target.key);
                        setSelected(null);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white hover:border-white/20 text-xs font-medium transition-colors"
                    >
                      {target.icon} {target.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
