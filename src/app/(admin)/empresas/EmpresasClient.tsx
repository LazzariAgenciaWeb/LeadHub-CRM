"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Company {
  id: string;
  name: string;
  segment: string | null;
  status: string;
  _count: { leads: number; campaigns: number; whatsappInstances: number };
}

const PINNED_KEY = "pinned_company_ids";

function getPinned(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]"); } catch { return []; }
}
function setPinned(ids: string[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}

export default function EmpresasClient({ companies }: { companies: Company[] }) {
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  useEffect(() => {
    setPinnedIds(getPinned());
  }, []);

  function togglePin(id: string) {
    const next = pinnedIds.includes(id) ? pinnedIds.filter((p) => p !== id) : [id, ...pinnedIds];
    setPinnedIds(next);
    setPinned(next);
  }

  const sorted = [...companies].sort((a, b) => {
    const ap = pinnedIds.includes(a.id) ? 0 : 1;
    const bp = pinnedIds.includes(b.id) ? 0 : 1;
    return ap - bp;
  });

  const statusBadge = (status: string) =>
    status === "ACTIVE"
      ? "text-green-400 bg-green-500/10 border border-green-500/20"
      : "text-slate-400 bg-slate-500/10 border border-slate-500/20";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Empresas</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {companies.length} empresa{companies.length !== 1 ? "s" : ""} cadastrada{companies.length !== 1 ? "s" : ""}
            {pinnedIds.length > 0 && <span className="ml-2 text-yellow-500/70 text-xs">📌 {pinnedIds.length} fixada{pinnedIds.length !== 1 ? "s" : ""}</span>}
          </p>
        </div>
        <Link
          href="/empresas/nova"
          className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          + Nova Empresa
        </Link>
      </div>

      {companies.length === 0 ? (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="text-white font-semibold mb-1">Nenhuma empresa cadastrada</div>
          <div className="text-slate-500 text-sm mb-4">Cadastre sua primeira empresa para começar</div>
          <Link href="/empresas/nova" className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">
            + Nova Empresa
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((company) => {
            const isPinned = pinnedIds.includes(company.id);
            return (
              <div
                key={company.id}
                className={`bg-[#0f1623] border rounded-xl p-5 hover:border-indigo-500/50 transition-colors group relative ${isPinned ? "border-yellow-500/40 shadow-[0_0_0_1px_rgba(234,179,8,0.1)]" : "border-[#1e2d45]"}`}
              >
                {/* Pin button */}
                <button
                  onClick={() => togglePin(company.id)}
                  title={isPinned ? "Desafixar do topo" : "Fixar no topo"}
                  className={`absolute top-3 right-3 text-sm transition-all ${isPinned ? "text-yellow-400 opacity-100" : "text-slate-700 opacity-0 group-hover:opacity-100 hover:text-yellow-400"}`}
                >
                  📌
                </button>

                <div className="flex items-start justify-between mb-4 pr-6">
                  <div>
                    <div className="flex items-center gap-2">
                      {isPinned && <span className="text-yellow-500 text-[10px]">📌</span>}
                      <h2 className="text-white font-bold text-[15px]">{company.name}</h2>
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">{company.segment ?? "Sem segmento"}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadge(company.status)}`}>
                    {company.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                    <div className="text-white font-bold text-lg">{company._count.leads}</div>
                    <div className="text-slate-500 text-[10px]">Leads</div>
                  </div>
                  <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                    <div className="text-white font-bold text-lg">{company._count.campaigns}</div>
                    <div className="text-slate-500 text-[10px]">Campanhas</div>
                  </div>
                  <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                    <div className={`font-bold text-lg ${company._count.whatsappInstances > 0 ? "text-green-400" : "text-slate-500"}`}>
                      {company._count.whatsappInstances > 0 ? "✓" : "—"}
                    </div>
                    <div className="text-slate-500 text-[10px]">WhatsApp</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-[#1e2d45]">
                  <Link
                    href={`/empresas/${company.id}`}
                    className="flex-1 text-center text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-xs font-semibold py-1.5 rounded-lg transition-colors"
                  >
                    Ver Detalhes
                  </Link>
                  <Link
                    href={`/api/admin/impersonate/${company.id}`}
                    className="flex-1 text-center text-white bg-gradient-to-r from-indigo-500 to-purple-600 text-xs font-semibold py-1.5 rounded-lg hover:opacity-90 transition-opacity"
                  >
                    👁 Acessar Painel →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
