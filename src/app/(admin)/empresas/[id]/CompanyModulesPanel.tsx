"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Package, RotateCcw } from "lucide-react";
import type { PlanFeatures, PlanTier } from "@/lib/plans";
import {
  MODULE_BY_ID, MODULE_GROUPS, resolveModules, type ModuleOrigin, type ResolvedModule,
} from "@/lib/modules";

/**
 * Módulos contratados — a lista que a agência usa pra liberar acesso.
 *
 * Substituiu a lista crua de ~30 features. A conversa comercial é sobre
 * MÓDULO ("o cliente contratou Marketing"), então o módulo fica na frente e as
 * features finas ficam num "avançado" por módulo.
 *
 * Cada módulo tem três estados, e a etiqueta diz de onde veio o estado atual:
 *   plano       → o pacote contratado já inclui (ou não inclui)
 *   exceção ON  → liberado só pra esta empresa, fora do plano
 *   exceção OFF → bloqueado só pra esta empresa, mesmo o plano incluindo
 *
 * "Voltar ao plano" apaga a exceção. Isso é o que faltava antes: não dava pra
 * distinguir "nunca mexi" de "desliguei", porque tudo virava um booleano só.
 */

const ORIGIN_META: Record<ModuleOrigin, { label: string; cls: string }> = {
  "plano":       { label: "do plano",    cls: "text-slate-500 bg-white/5" },
  "excecao-on":  { label: "exceção ON",  cls: "text-amber-300 bg-amber-500/15" },
  "excecao-off": { label: "exceção OFF", cls: "text-red-300 bg-red-500/15" },
};

export default function CompanyModulesPanel({
  tier, customFeatures, onChange,
}: {
  tier: PlanTier;
  customFeatures: Partial<PlanFeatures>;
  onChange: (next: Partial<PlanFeatures>) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const modules = resolveModules(tier, customFeatures);

  function setFeature(key: keyof PlanFeatures, value: boolean | undefined) {
    const next = { ...customFeatures };
    if (value === undefined) delete next[key];
    else (next as any)[key] = value;
    onChange(next);
  }

  /** Liga/desliga o módulo. Se o novo estado é igual ao do plano, some a exceção. */
  function toggleModule(m: ResolvedModule, primary: keyof PlanFeatures) {
    const target = !m.enabled;
    setFeature(primary, target === m.planDefault ? undefined : target);
  }

  const exceptionCount = modules.filter((m) => m.origin !== "plano").length;

  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-emerald-400" strokeWidth={2.25} />
          <h3 className="text-white text-sm font-semibold">Módulos contratados</h3>
        </div>
        {exceptionCount > 0 && (
          <span className="text-[10px] text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full font-bold">
            {exceptionCount} exceç{exceptionCount === 1 ? "ão" : "ões"} ao plano
          </span>
        )}
      </div>
      <p className="text-slate-600 text-[11px] mb-4">
        O plano define o padrão. Mexer aqui cria uma exceção só para esta empresa — e a
        etiqueta mostra de onde veio cada estado.
      </p>

      <div className="space-y-5">
        {MODULE_GROUPS.map((group) => {
          const list = modules.filter((m) => m.group === group);
          if (!list.length) return null;
          const on = list.filter((m) => m.enabled).length;

          return (
            <div key={group}>
              <div className="flex items-baseline gap-2 mb-2">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{group}</h4>
                <span className="text-[10px] text-slate-600">{on}/{list.length}</span>
              </div>

              <div className="space-y-1.5">
                {list.map((m) => {
                  const def = MODULE_BY_ID[m.id].primary;
                  const isOpen = !!open[m.id];
                  const originMeta = ORIGIN_META[m.origin];

                  return (
                    <div key={m.id} className="border border-[#1e2d45] rounded-lg bg-[#070b14]">
                      <div className="flex items-center gap-2.5 px-3 py-2.5">
                        {m.advanced.length > 0 ? (
                          <button
                            onClick={() => setOpen((o) => ({ ...o, [m.id]: !isOpen }))}
                            className="text-slate-600 hover:text-slate-300 flex-shrink-0"
                            title="Ajustes avançados"
                          >
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        ) : (
                          <span className="w-3.5 flex-shrink-0" />
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-semibold ${m.enabled ? "text-white" : "text-slate-500"}`}>
                              {m.label}
                            </span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${originMeta.cls}`}>
                              {originMeta.label}
                            </span>
                            {m.advanced.length > 0 && (
                              <span className="text-[9px] text-slate-600">
                                {m.advanced.filter((a) => a.enabled).length}/{m.advanced.length} avançado
                              </span>
                            )}
                          </div>
                          <p className="text-slate-600 text-[10px] mt-0.5">{m.description}</p>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {m.origin !== "plano" && (
                            <button
                              onClick={() => setFeature(def, undefined)}
                              className="text-slate-600 hover:text-slate-300 p-1"
                              title="Voltar ao padrão do plano"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => toggleModule(m, def)}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                              m.enabled
                                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                : "bg-white/5 text-slate-500 hover:bg-white/10"
                            }`}
                          >
                            {m.enabled ? "LIGADO" : "DESLIGADO"}
                          </button>
                        </div>
                      </div>

                      {/* Avançado — features finas do módulo */}
                      {isOpen && m.advanced.length > 0 && (
                        <div className="border-t border-[#1e2d45] px-3 py-2 space-y-1.5 bg-black/20">
                          {m.advanced.map((a) => {
                            const aOrigin = ORIGIN_META[a.origin];
                            return (
                              <div key={a.key} className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-[11px] ${a.enabled ? "text-slate-200" : "text-slate-600"}`}>
                                      {a.label}
                                    </span>
                                    {a.origin !== "plano" && (
                                      <span className={`text-[9px] font-bold px-1 rounded ${aOrigin.cls}`}>
                                        {aOrigin.label}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-slate-700 text-[10px]">{a.description}</p>
                                </div>
                                {a.origin !== "plano" && (
                                  <button
                                    onClick={() => setFeature(a.key, undefined)}
                                    className="text-slate-700 hover:text-slate-400 p-0.5"
                                    title="Voltar ao padrão do plano"
                                  >
                                    <RotateCcw className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => setFeature(a.key, !a.enabled)}
                                  className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                    a.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-slate-600"
                                  }`}
                                >
                                  {a.enabled ? "ON" : "OFF"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
