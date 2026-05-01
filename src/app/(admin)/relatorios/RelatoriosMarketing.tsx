"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import CompanyMarketing from "../empresas/[id]/CompanyMarketing";

/**
 * Wrapper do Dashboard de Marketing dentro de /relatorios.
 *
 * - SUPER_ADMIN: dropdown pra escolher qual empresa visualizar (?companyId=X)
 * - ADMIN/CLIENT: usa direto a empresa do usuário (companyId fixo)
 *
 * Reutiliza o CompanyMarketing (mesmo componente da aba dentro da empresa).
 */
export default function RelatoriosMarketing({
  isSuperAdmin,
  defaultCompanyId,
  selectedCompanyId,
  companies,
}: {
  isSuperAdmin: boolean;
  defaultCompanyId: string;
  selectedCompanyId: string;
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [companyId, setCompanyId] = useState(selectedCompanyId);

  function changeCompany(newId: string) {
    setCompanyId(newId);
    const params = new URLSearchParams(searchParams.toString());
    if (newId) params.set("companyId", newId);
    else params.delete("companyId");
    params.set("secao", "marketing");
    router.push(`/relatorios?${params.toString()}`);
  }

  if (isSuperAdmin && !companyId) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4 text-cyan-400" strokeWidth={2.25} />
          <h2 className="text-white font-bold text-base">Relatório de Marketing</h2>
        </div>
        <p className="text-slate-500 text-xs mb-4">
          Selecione a empresa para ver o relatório consolidado de Marketing
          (Analytics, Search Console, geo, origens, queries…).
        </p>
        <select
          value=""
          onChange={(e) => changeCompany(e.target.value)}
          className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white"
        >
          <option value="">— escolher empresa —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">
        Sem empresa associada à sua conta.
      </div>
    );
  }

  return (
    <>
      {/* Picker pro super admin trocar */}
      {isSuperAdmin && companies.length > 0 && (
        <div className="px-5 pt-5 max-w-md">
          <label className="block text-slate-400 text-[11px] font-semibold mb-1.5 uppercase tracking-wide">
            Empresa
          </label>
          <select
            value={companyId}
            onChange={(e) => changeCompany(e.target.value)}
            className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <CompanyMarketing companyId={companyId} />
    </>
  );
}
