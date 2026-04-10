"use client";

import { useState } from "react";
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

const STATUS_CONFIG: Record<string, { label: string; color: string; next?: string }> = {
  NEW: { label: "Novo", color: "text-indigo-400 bg-indigo-500/15", next: "CONTACTED" },
  CONTACTED: { label: "Em Contato", color: "text-blue-400 bg-blue-500/15", next: "PROPOSAL" },
  PROPOSAL: { label: "Proposta", color: "text-yellow-400 bg-yellow-500/15", next: "CLOSED" },
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

export default function LeadsTable({
  leads,
  isSuperAdmin,
  total,
  page,
  limit,
}: {
  leads: Lead[];
  isSuperAdmin: boolean;
  total: number;
  page: number;
  limit: number;
}) {
  const router = useRouter();
  const [updating, setUpdating] = useState<string | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);

  async function updateStatus(leadId: string, status: string) {
    setUpdating(leadId);
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setUpdating(null);
    router.refresh();
  }

  const totalPages = Math.ceil(total / limit);

  if (leads.length === 0) {
    return (
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
        <div className="text-4xl mb-3">🎯</div>
        <div className="text-white font-semibold mb-1">Nenhum lead encontrado</div>
        <div className="text-slate-500 text-sm">Ajuste os filtros ou aguarde mensagens via WhatsApp.</div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e2d45]">
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Contato</th>
                {isSuperAdmin && (
                  <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Empresa</th>
                )}
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Campanha</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Origem</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Status</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Valor</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Entrada</th>
                <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const s = STATUS_CONFIG[lead.status] ?? { label: lead.status, color: "text-slate-400 bg-slate-500/15" };
                const srcIcon = SOURCE_ICON[lead.source ?? ""] ?? "🔵";
                return (
                  <tr
                    key={lead.id}
                    className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="text-white text-[13px] font-semibold">{lead.name ?? "Sem nome"}</div>
                      <div className="text-slate-500 text-[11px]">{lead.phone}</div>
                      {lead.email && <div className="text-slate-600 text-[10px]">{lead.email}</div>}
                    </td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3 text-slate-400 text-[12.5px]">
                        {lead.company?.name ?? "—"}
                      </td>
                    )}
                    <td className="px-4 py-3 text-slate-400 text-[12.5px]">
                      {lead.campaign?.name ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm" title={lead.source ?? ""}>{srcIcon}</span>
                      {lead.source && (
                        <span className="text-[11px] text-slate-500 ml-1">{lead.source}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={lead.status}
                        disabled={updating === lead.id}
                        onChange={(e) => updateStatus(lead.id, e.target.value)}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 ${s.color} bg-transparent`}
                      >
                        <option value="NEW">Novo</option>
                        <option value="CONTACTED">Em Contato</option>
                        <option value="PROPOSAL">Proposta</option>
                        <option value="CLOSED">Fechado</option>
                        <option value="LOST">Perdido</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-[12.5px]">
                      {lead.value != null
                        ? `R$ ${lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                        : <span className="text-slate-600">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[11px]">
                      {new Date(lead.createdAt).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelected(lead)}
                        className="text-slate-500 hover:text-indigo-400 text-xs transition-colors"
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e2d45]">
            <span className="text-slate-500 text-xs">
              Página {page} de {totalPages} — {total} leads
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <a
                  href={`?page=${page - 1}`}
                  className="px-3 py-1 rounded bg-[#161f30] text-slate-400 text-xs hover:text-white transition-colors"
                >
                  ← Anterior
                </a>
              )}
              {page < totalPages && (
                <a
                  href={`?page=${page + 1}`}
                  className="px-3 py-1 rounded bg-[#161f30] text-slate-400 text-xs hover:text-white transition-colors"
                >
                  Próxima →
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lead Detail Drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={() => setSelected(null)} />
          <div className="w-[420px] bg-[#0f1623] border-l border-[#1e2d45] flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[#1e2d45]">
              <h2 className="text-white font-bold">Detalhes do Lead</h2>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white text-xl">×</button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">Nome</div>
                <div className="text-white font-semibold">{selected.name ?? "Sem nome"}</div>
              </div>
              <div>
                <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">Telefone</div>
                <div className="text-white">{selected.phone}</div>
              </div>
              {selected.email && (
                <div>
                  <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">E-mail</div>
                  <div className="text-white">{selected.email}</div>
                </div>
              )}
              <div>
                <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">Status</div>
                <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CONFIG[selected.status]?.color ?? ""}`}>
                  {STATUS_CONFIG[selected.status]?.label ?? selected.status}
                </span>
              </div>
              {selected.campaign && (
                <div>
                  <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">Campanha</div>
                  <div className="text-white">{selected.campaign.name}</div>
                </div>
              )}
              {selected.source && (
                <div>
                  <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">Origem</div>
                  <div className="text-white">{SOURCE_ICON[selected.source] ?? "🔵"} {selected.source}</div>
                </div>
              )}
              {selected.value != null && (
                <div>
                  <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">Valor</div>
                  <div className="text-green-400 font-semibold text-lg">
                    R$ {selected.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </div>
                </div>
              )}
              {selected.notes && (
                <div>
                  <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">Notas</div>
                  <div className="text-slate-300 text-sm bg-[#161f30] rounded-lg p-3 whitespace-pre-wrap">
                    {selected.notes}
                  </div>
                </div>
              )}
              <div>
                <div className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">Entrada</div>
                <div className="text-slate-400 text-sm">
                  {new Date(selected.createdAt).toLocaleString("pt-BR")}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
