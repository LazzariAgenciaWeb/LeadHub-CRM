"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageCircle, Target, Megaphone, ChevronDown, ChevronRight } from "lucide-react";
import CompanyIntegrations from "@/app/(admin)/empresas/[id]/CompanyIntegrations";
import MetaConnectionPanel from "./MetaConnectionPanel";

/**
 * Integrações Meta — um lugar só para tudo que fala com Facebook/Instagram.
 *
 * Antes estava espalhado em três telas e o Meta Ads ainda aparecia no meio de
 * uma lista Google:
 *   - conexão de Página/Instagram (inbox + automações) → /instagram
 *   - Pixel e Conversions API                          → esta tela
 *   - Meta Ads                                         → aba Integrações da empresa
 *
 * Agora as três aparecem juntas aqui. As que têm gerência própria (webhook,
 * caixa de entrada, automações) continuam morando na tela delas — aqui fica o
 * ponto de entrada e o link, em vez de duplicar o fluxo.
 *
 * Todas usam o MESMO app da Meta (FACEBOOK_APP_ID), com autorizações separadas.
 */
export default function IntegracoesMetaSection({
  isSuperAdmin,
  selectedCompanyId,
  companies,
  capiBlock,
}: {
  isSuperAdmin: boolean;
  selectedCompanyId: string;
  companies: { id: string; name: string }[];
  /** MetaCapiSettings já montado no server (precisa de config + logs). */
  capiBlock: React.ReactNode;
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(selectedCompanyId);
  // Todos abertos por padrão; fechar é pra quem já resolveu aquele bloco.
  const [open, setOpen] = useState<Record<string, boolean>>({
    conexao: true, pixel: true, ads: true,
  });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  function changeCompany(newId: string) {
    setCompanyId(newId);
    router.push(`/configuracoes?secao=integracoes-meta&companyId=${newId}`);
  }

  if (isSuperAdmin && !companyId) {
    return (
      <div className="p-6">
        <h2 className="text-white font-bold text-base mb-3">Integrações Meta</h2>
        <p className="text-slate-500 text-sm mb-4">Selecione a empresa para configurar.</p>
        <select
          value=""
          onChange={(e) => changeCompany(e.target.value)}
          className="bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Selecione…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-white font-bold text-base">Integrações Meta</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Facebook e Instagram — mesma conta de app, autorizações separadas por finalidade.
          </p>
        </div>
        {isSuperAdmin && companies.length > 0 && (
          <select
            value={companyId}
            onChange={(e) => changeCompany(e.target.value)}
            className="bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      <Block
        id="conexao"
        open={open.conexao}
        onToggle={toggle}
        icon={<MessageCircle className="w-5 h-5" strokeWidth={2} />}
        accentText="text-pink-300"
        accentBg="bg-pink-500/10"
        title="Facebook & Instagram · conexão"
        subtitle="Autoriza a Página e a conta do Instagram — habilita Direct, Messenger e as automações."
      >
        <MetaConnectionPanel />
      </Block>

      <Block
        id="pixel"
        open={open.pixel}
        onToggle={toggle}
        icon={<Target className="w-5 h-5" strokeWidth={2} />}
        accentText="text-violet-300"
        accentBg="bg-violet-500/10"
        title="Pixel & Conversions API"
        subtitle="Avisa o Meta quando o lead vira venda, direto do servidor."
      >
        {capiBlock}
      </Block>

      <Block
        id="ads"
        open={open.ads}
        onToggle={toggle}
        icon={<Megaphone className="w-5 h-5" strokeWidth={2} />}
        accentText="text-amber-300"
        accentBg="bg-amber-500/10"
        title="Meta Ads"
        subtitle="Investimento, cliques, conversões e ROAS por campanha no Dashboard de Marketing."
      >
        <CompanyIntegrations companyId={companyId} platformFilter="meta" />
      </Block>
    </div>
  );
}

function Block({
  id, open, onToggle, icon, accentText, accentBg, title, subtitle, children,
}: {
  id: string;
  open: boolean;
  onToggle: (id: string) => void;
  icon: React.ReactNode;
  accentText: string;
  accentBg: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#1e2d45] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
      >
        <div className={`w-9 h-9 rounded-lg ${accentBg} flex items-center justify-center ${accentText} flex-shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-sm">{title}</h3>
          <p className="text-slate-500 text-[11px]">{subtitle}</p>
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
