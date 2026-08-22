"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageCircle, Target, Megaphone, ArrowUpRight, Settings2 } from "lucide-react";
import CompanyIntegrations from "@/app/(admin)/empresas/[id]/CompanyIntegrations";

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

      {/* 1. Conexão de Página e Instagram — gerida na tela própria */}
      <LinkCard
        icon={<MessageCircle className="w-5 h-5" strokeWidth={2} />}
        accent="text-pink-300 bg-pink-500/10 border-pink-500/30"
        title="Facebook & Instagram · Inbox e automações"
        description="Conecta a Página e a conta do Instagram para receber Direct e Messenger no inbox, e para rodar as automações."
        note="A conexão tem webhook e caixa de entrada próprios, então é gerida na tela do Instagram."
        href="/instagram"
        cta="Abrir conexão"
      />

      {/* 2. Pixel + Conversions API — mora aqui mesmo */}
      <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.04] p-4">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-300">
            <Target className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">Pixel & Conversions API</h3>
            <p className="text-slate-500 text-[11px]">
              Avisa o Meta quando o lead vira venda, direto do servidor.
            </p>
          </div>
        </div>
        {capiBlock}
      </div>

      {/* 3. Meta Ads — o card conectável, agora fora da lista do Google */}
      <div className="rounded-xl border border-[#1e2d45] overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-4">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-300">
            <Megaphone className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">Meta Ads</h3>
            <p className="text-slate-500 text-[11px]">
              Investimento, cliques, conversões e ROAS por campanha no Dashboard de Marketing.
            </p>
          </div>
        </div>
        <CompanyIntegrations companyId={companyId} platformFilter="meta" />
      </div>
    </div>
  );
}

function LinkCard({
  icon, accent, title, description, note, href, cta,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  description: string;
  note?: string;
  href: string;
  cta: string;
}) {
  const [iconColor, iconBg, border] = accent.split(" ");
  return (
    <div className={`rounded-xl border ${border} bg-white/[0.02] p-4`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center ${iconColor} flex-shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-sm">{title}</h3>
          <p className="text-slate-400 text-xs mt-0.5">{description}</p>
          {note && (
            <p className="text-slate-600 text-[11px] mt-1.5 flex items-start gap-1.5">
              <Settings2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {note}
            </p>
          )}
        </div>
        <a
          href={href}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-semibold transition-colors"
        >
          {cta} <ArrowUpRight className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
