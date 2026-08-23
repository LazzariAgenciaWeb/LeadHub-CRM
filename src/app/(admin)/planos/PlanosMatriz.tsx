"use client";

import { Fragment } from "react";
import { PLANS, PLAN_ORDER, formatPriceBRL, type PlanFeatures, type PlanTier } from "@/lib/plans";
import { MODULES, MODULE_GROUPS, resolveModules } from "@/lib/modules";

/**
 * Matriz comparativa dos planos — o que cada um entrega, incluindo as variantes
 * dentro de cada módulo (grupos no WhatsApp, Google Ads dentro do Dashboard de
 * Marketing, etc.) e a capacidade contratada.
 *
 * Lê o catálogo real (plans.ts + modules.ts), então nunca desatualiza: mudou o
 * plano no código, a tabela muda junto. Substituiu os cards que listavam as
 * chaves cruas de feature — ninguém vende dizendo "crmPipelineOportunidades".
 */

const TIERS = PLAN_ORDER;

/** Features que não pertencem a nenhum módulo — comerciais e enterprise. */
const EXTRA_LABEL: Partial<Record<keyof PlanFeatures, string>> = {
  magicLink: "Login por link mágico",
  bannerLgpd: "Banner LGPD no site",
  multiUnidade: "Cadastro de empresas (clientes do cliente)",
  apiAccess: "Acesso à API",
  whiteLabel: "White label",
  customDomain: "Domínio próprio",
  suportePrioritario: "Suporte prioritário",
  accountManager: "Gerente de conta",
};

function Dot({ on, small = false }: { on: boolean; small?: boolean }) {
  if (!on) {
    return <span className="inline-block w-2.5 h-0.5 rounded-full bg-[#2b3550]" />;
  }
  return (
    <span
      className={`inline-block rounded-full bg-emerald-400 ${small ? "w-2 h-2" : "w-2.5 h-2.5"}`}
    />
  );
}

const lim = (v: number) => (v === -1 ? "ilimitado" : v === 0 ? "—" : v.toLocaleString("pt-BR"));

export default function PlanosMatriz() {
  const byTier = Object.fromEntries(
    TIERS.map((t) => [t, resolveModules(t, null)])
  ) as Record<PlanTier, ReturnType<typeof resolveModules>>;

  const extras = (Object.keys(EXTRA_LABEL) as (keyof PlanFeatures)[]);

  const Head = (
    <thead>
      <tr>
        <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold sticky left-0 bg-[#0f1623] z-10 min-w-[240px]">
          Recurso
        </th>
        {TIERS.map((t) => {
          const p = PLANS[t];
          const star = t === "MARKETING";
          return (
            <th
              key={t}
              className={`px-3 py-3 text-center align-bottom min-w-[124px] ${
                star ? "bg-indigo-500/[0.07]" : ""
              }`}
            >
              <div className="text-white font-bold text-sm">{p.label}</div>
              <div className="text-white text-base font-bold mt-0.5">
                {p.priceMonthly === 0 ? "Grátis" : formatPriceBRL(p.priceMonthly)}
                {p.priceMonthly > 0 && <span className="text-slate-500 text-[10px] font-normal">/mês</span>}
              </div>
              <div className="text-slate-600 text-[10px]">
                {p.priceMonthly === 0
                  ? "para sempre"
                  : `${formatPriceBRL(p.priceAnnualPerMonth)}/mês no anual`}
              </div>
            </th>
          );
        })}
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      {/* Módulos e variantes */}
      <div>
        <h3 className="text-white font-bold text-sm mb-2">Módulos e variantes</h3>
        <div className="overflow-x-auto border border-[#1e2d45] rounded-xl bg-[#0f1623]">
          <table className="w-full border-collapse">
            {Head}
            <tbody>
              {MODULE_GROUPS.map((group) => {
                const list = MODULES.filter((m) => m.group === group);
                if (!list.length) return null;
                return (
                  <Fragment key={group}>
                      <tr>
                        <th
                          colSpan={TIERS.length + 1}
                          className="text-left px-3 py-2 bg-[#0a1220] text-[10px] uppercase tracking-[0.1em] text-slate-500 font-bold border-y border-[#1e2d45]"
                        >
                          {group}
                        </th>
                      </tr>
                      {list.map((m) => {
                        const resolved = (t: PlanTier) => byTier[t].find((r) => r.id === m.id)!;
                        return (
                          <Fragment key={m.id}>
                            <tr className="border-b border-[#1e2d45]/60">
                              <th className="text-left px-3 py-2 font-medium sticky left-0 bg-[#0f1623]">
                                <span className="block text-slate-200 text-xs">{m.label}</span>
                                <span className="block text-slate-600 text-[10px] leading-tight">
                                  {m.description}
                                </span>
                              </th>
                              {TIERS.map((t) => (
                                <td
                                  key={t}
                                  className={`text-center px-3 py-2 ${t === "MARKETING" ? "bg-indigo-500/[0.05]" : ""}`}
                                >
                                  <Dot on={resolved(t).enabled} />
                                </td>
                              ))}
                            </tr>
                            {(m.advanced ?? []).map((a) => (
                              <tr key={`${m.id}-${a.key}`} className="border-b border-[#1e2d45]/40">
                                <th className="text-left pl-8 pr-3 py-1.5 font-normal sticky left-0 bg-[#0f1623]">
                                  <span className="block text-slate-400 text-[11px]">└ {a.label}</span>
                                  <span className="block text-slate-700 text-[10px] leading-tight">
                                    {a.description}
                                  </span>
                                </th>
                                {TIERS.map((t) => (
                                  <td
                                    key={t}
                                    className={`text-center px-3 py-1.5 ${t === "MARKETING" ? "bg-indigo-500/[0.05]" : ""}`}
                                  >
                                    <Dot on={!!PLANS[t].features[a.key]} small />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                );
              })}

              <tr className="border-t-2 border-[#1e2d45]">
                <th className="text-left px-3 py-2.5 text-slate-300 text-xs font-bold sticky left-0 bg-[#0f1623]">
                  Total de módulos
                </th>
                {TIERS.map((t) => (
                  <td
                    key={t}
                    className={`text-center px-3 py-2.5 ${t === "MARKETING" ? "bg-indigo-500/[0.05]" : ""}`}
                  >
                    <span className="text-white font-bold text-base">
                      {byTier[t].filter((r) => r.enabled).length}
                    </span>
                    <span className="text-slate-600 text-[10px]">/{MODULES.length}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex gap-5 flex-wrap mt-2 text-[11px] text-slate-600">
          <span className="flex items-center gap-1.5"><Dot on /> incluído</span>
          <span className="flex items-center gap-1.5"><Dot on={false} /> não incluído</span>
          <span>linhas recuadas (└) são variantes do módulo acima</span>
        </div>
      </div>

      {/* Capacidade */}
      <div>
        <h3 className="text-white font-bold text-sm mb-2">Capacidade</h3>
        <div className="overflow-x-auto border border-[#1e2d45] rounded-xl bg-[#0f1623]">
          <table className="w-full border-collapse">
            {Head}
            <tbody>
              <tr className="border-b border-[#1e2d45]/60">
                <th className="text-left px-3 py-2.5 text-slate-200 text-xs font-medium sticky left-0 bg-[#0f1623]">
                  Modo do WhatsApp
                </th>
                {TIERS.map((t) => {
                  const atende = PLANS[t].modoAtendimentoDefault === "ATENDE";
                  return (
                    <td key={t} className={`text-center px-3 py-2.5 ${t === "MARKETING" ? "bg-indigo-500/[0.05]" : ""}`}>
                      <span
                        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          atende ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-slate-400"
                        }`}
                      >
                        {atende ? "Atende" : "Visão"}
                      </span>
                      <span className="block text-slate-600 text-[10px] mt-1 leading-tight">
                        {atende ? "responde pelo painel" : "responde no celular"}
                      </span>
                    </td>
                  );
                })}
              </tr>
              {([
                ["Números de WhatsApp", "whatsappInstances"],
                ["Atendentes", "atendentes"],
                ["Unidades / filiais", "unidades"],
                ["Leads por mês", "leadsPerMonth"],
              ] as const).map(([label, key]) => (
                <tr key={key} className="border-b border-[#1e2d45]/60">
                  <th className="text-left px-3 py-2 text-slate-200 text-xs font-medium sticky left-0 bg-[#0f1623]">
                    {label}
                  </th>
                  {TIERS.map((t) => (
                    <td
                      key={t}
                      className={`text-center px-3 py-2 text-slate-300 text-xs font-mono ${
                        t === "MARKETING" ? "bg-indigo-500/[0.05]" : ""
                      }`}
                    >
                      {lim(PLANS[t].limits[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Extras */}
      <div>
        <h3 className="text-white font-bold text-sm mb-2">Extras</h3>
        <div className="overflow-x-auto border border-[#1e2d45] rounded-xl bg-[#0f1623]">
          <table className="w-full border-collapse">
            {Head}
            <tbody>
              {extras.map((k) => (
                <tr key={k} className="border-b border-[#1e2d45]/60">
                  <th className="text-left px-3 py-2 text-slate-200 text-xs font-medium sticky left-0 bg-[#0f1623]">
                    {EXTRA_LABEL[k]}
                  </th>
                  {TIERS.map((t) => (
                    <td
                      key={t}
                      className={`text-center px-3 py-2 ${t === "MARKETING" ? "bg-indigo-500/[0.05]" : ""}`}
                    >
                      <Dot on={!!PLANS[t].features[k]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
