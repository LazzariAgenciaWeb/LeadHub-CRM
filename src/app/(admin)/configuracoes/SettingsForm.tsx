"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Company {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  segment: string | null;
  logoUrl: string | null;
}

export default function SettingsForm({
  isSuperAdmin,
  settings,
  company,
  onlyCompany,
  onlyIntegrations,
}: {
  isSuperAdmin: boolean;
  settings: Record<string, string>;
  company: Company | null;
  onlyCompany?: boolean;
  onlyIntegrations?: boolean;
}) {
  const router = useRouter();

  const [evolutionUrl, setEvolutionUrl] = useState(settings.evolution_base_url ?? "");
  const [evolutionKey, setEvolutionKey] = useState(settings.evolution_api_key ?? "");
  const [savingEvolution, setSavingEvolution] = useState(false);
  const [savedEvolution, setSavedEvolution] = useState(false);

  const [companyForm, setCompanyForm] = useState({
    name: company?.name ?? "",
    phone: company?.phone ?? "",
    email: company?.email ?? "",
    website: company?.website ?? "",
    segment: company?.segment ?? "",
    logoUrl: company?.logoUrl ?? "",
  });
  const [savingCompany, setSavingCompany] = useState(false);
  const [savedCompany, setSavedCompany] = useState(false);

  async function saveEvolution(e: React.FormEvent) {
    e.preventDefault();
    setSavingEvolution(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { key: "evolution_base_url", value: evolutionUrl },
        { key: "evolution_api_key", value: evolutionKey },
      ]),
    });
    setSavingEvolution(false);
    setSavedEvolution(true);
    setTimeout(() => setSavedEvolution(false), 2500);
    router.refresh();
  }

  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setSavingCompany(true);
    await fetch(`/api/companies/${company.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(companyForm),
    });
    setSavingCompany(false);
    setSavedCompany(true);
    setTimeout(() => setSavedCompany(false), 2500);
    router.refresh();
  }

  const showInteg = !onlyCompany && (isSuperAdmin || onlyIntegrations);
  const showComp = !onlyIntegrations && !!company;

  return (
    <div className="space-y-6">
      {/* ── Evolution API ── */}
      {showInteg && (
        <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1e2d45]">
            <h2 className="text-white font-bold text-sm">⚡ Integração Evolution API</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              Configure a URL e token de acesso da sua instância da Evolution API para integração com WhatsApp.
            </p>
          </div>
          <form onSubmit={saveEvolution} className="p-5 space-y-4">
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                Base URL
              </label>
              <input
                type="url"
                value={evolutionUrl}
                onChange={(e) => setEvolutionUrl(e.target.value)}
                placeholder="https://evolution.seuservidor.com"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                API Key (Global Key)
              </label>
              <input
                type="password"
                value={evolutionKey}
                onChange={(e) => setEvolutionKey(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={savingEvolution}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              {savedEvolution ? "✓ Salvo!" : savingEvolution ? "Salvando..." : "Salvar integração"}
            </button>
          </form>
        </section>
      )}

      {/* ── Dados da Empresa ── */}
      {showComp && (
        <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1e2d45]">
            <h2 className="text-white font-bold text-sm">🏢 Dados da Empresa</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              Informações usadas como padrão em links de WhatsApp, UTMs e comunicações.
            </p>
          </div>
          <form onSubmit={saveCompany} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  Nome da Empresa
                </label>
                <input
                  type="text"
                  value={companyForm.name}
                  onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  Segmento
                </label>
                <input
                  type="text"
                  value={companyForm.segment}
                  onChange={(e) => setCompanyForm({ ...companyForm, segment: e.target.value })}
                  placeholder="Ex: Clínica, Imobiliária, E-commerce"
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  WhatsApp padrão
                </label>
                <input
                  type="text"
                  value={companyForm.phone}
                  onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                  placeholder="5511999999999"
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
                <p className="text-slate-600 text-[10px] mt-1">
                  Preenchido automaticamente ao criar links WhatsApp
                </p>
              </div>
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  E-mail
                </label>
                <input
                  type="email"
                  value={companyForm.email}
                  onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                  placeholder="contato@empresa.com"
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                Site / Landing Page padrão
              </label>
              <input
                type="url"
                value={companyForm.website}
                onChange={(e) => setCompanyForm({ ...companyForm, website: e.target.value })}
                placeholder="https://seusite.com.br"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                URL do Logo
              </label>
              <input
                type="url"
                value={companyForm.logoUrl}
                onChange={(e) => setCompanyForm({ ...companyForm, logoUrl: e.target.value })}
                placeholder="https://cdn.seusite.com/logo.png"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={savingCompany}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              {savedCompany ? "✓ Salvo!" : savingCompany ? "Salvando..." : "Salvar dados da empresa"}
            </button>
          </form>
        </section>
      )}

      {/* ── Info sobre auto-gatilhos ── */}
      <section className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4">
        <div className="flex gap-3">
          <span className="text-lg">⚡</span>
          <div>
            <h3 className="text-indigo-300 font-semibold text-sm mb-1">Gatilhos automáticos de links WhatsApp</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Quando você cria um link de rastreamento para WhatsApp com mensagem pré-preenchida,
              essa mensagem é automaticamente cadastrada como gatilho na campanha.
              Assim, quando o lead enviar aquela mensagem, ele é identificado e vinculado
              à campanha correta sem nenhuma ação manual.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
