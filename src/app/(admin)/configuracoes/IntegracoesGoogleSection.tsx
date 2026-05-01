"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CompanyIntegrations from "../empresas/[id]/CompanyIntegrations";

/**
 * Seção "Integrações Google" dentro de /configuracoes.
 *
 * Padrão espelhado do InstancesSection:
 *  - SUPER_ADMIN: dropdown pra escolher qualquer empresa do sistema
 *  - ADMIN/CLIENT: vê só a própria empresa (companyId fixo)
 *
 * Reutiliza o componente CompanyIntegrations (que já contém todo o fluxo
 * de conectar/desconectar/listar pra uma empresa específica).
 */
export default function IntegracoesGoogleSection({
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
  const [companyId, setCompanyId] = useState(selectedCompanyId);

  function handleChangeCompany(newId: string) {
    setCompanyId(newId);
    router.push(`/configuracoes?secao=integracoes-google&companyId=${newId}`);
  }

  // SUPER_ADMIN sem empresa selecionada → mostra picker
  if (isSuperAdmin && !companyId) {
    return (
      <div className="p-6">
        <h2 className="text-white font-bold text-base mb-3">Integrações Google</h2>
        <p className="text-slate-500 text-xs mb-4">
          Selecione qual empresa configurar — cada cliente conecta sua própria conta Google (Analytics, Search Console, Meu Negócio).
        </p>
        <select
          value=""
          onChange={(e) => handleChangeCompany(e.target.value)}
          className="w-full max-w-md bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white"
        >
          <option value="">— selecione uma empresa —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      {/* Picker pro SUPER_ADMIN trocar de empresa */}
      {isSuperAdmin && companies.length > 0 && (
        <div className="px-5 pt-5">
          <label className="block text-slate-400 text-[11px] font-semibold mb-1.5 uppercase tracking-wide">
            Configurando integrações da empresa
          </label>
          <select
            value={companyId}
            onChange={(e) => handleChangeCompany(e.target.value)}
            className="w-full max-w-md bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <CompanyIntegrations companyId={companyId} />
    </div>
  );
}
