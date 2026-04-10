"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Rule {
  id: string;
  keyword: string;
  mapTo: string;
  priority: number;
  campaignId: string | null;
  campaign: { id: string; name: string } | null;
}

interface Campaign {
  id: string;
  name: string;
  source: string;
}

const STATUS_OPTIONS = [
  { value: "NEW", label: "Novo", color: "text-indigo-400" },
  { value: "CONTACTED", label: "Em Contato", color: "text-blue-400" },
  { value: "PROPOSAL", label: "Proposta", color: "text-yellow-400" },
  { value: "CLOSED", label: "Fechado", color: "text-green-400" },
  { value: "LOST", label: "Perdido", color: "text-red-400" },
];

const STATUS_COLOR: Record<string, string> = {
  NEW: "text-indigo-400 bg-indigo-500/15",
  CONTACTED: "text-blue-400 bg-blue-500/15",
  PROPOSAL: "text-yellow-400 bg-yellow-500/15",
  CLOSED: "text-green-400 bg-green-500/15",
  LOST: "text-red-400 bg-red-500/10",
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "Novo",
  CONTACTED: "Em Contato",
  PROPOSAL: "Proposta",
  CLOSED: "Fechado",
  LOST: "Perdido",
};

const SOURCE_ICON: Record<string, string> = {
  WHATSAPP: "💬",
  INSTAGRAM: "📸",
  FACEBOOK: "👥",
  GOOGLE: "🔍",
  LINK: "🔗",
  OTHER: "🔵",
};

export default function GatilhosManager({
  rules,
  campaigns,
  companies,
  company,
  isSuperAdmin,
  selectedCompanyId,
}: {
  rules: Rule[];
  campaigns: Campaign[];
  companies: { id: string; name: string }[];
  company: { id: string; name: string; triggerOnly: boolean } | null;
  isSuperAdmin: boolean;
  selectedCompanyId: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [togglingMode, setTogglingMode] = useState(false);
  const [form, setForm] = useState({
    keyword: "",
    mapTo: "NEW",
    priority: "0",
    campaignId: "",
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.keyword.trim()) return;

    setSaving(true);
    await fetch("/api/keyword-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: form.keyword.trim(),
        mapTo: form.mapTo,
        priority: parseInt(form.priority) || 0,
        companyId: selectedCompanyId || undefined,
        campaignId: form.campaignId || null,
      }),
    });
    setSaving(false);
    setForm({ keyword: "", mapTo: "NEW", priority: "0", campaignId: "" });
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    await fetch(`/api/keyword-rules/${id}`, { method: "DELETE" });
    setDeleting(null);
    router.refresh();
  }

  async function toggleTriggerOnly() {
    if (!company) return;
    setTogglingMode(true);
    await fetch(`/api/companies/${company.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggerOnly: !company.triggerOnly }),
    });
    setTogglingMode(false);
    router.refresh();
  }

  // Group rules by campaign
  const rulesByCampaign: Record<string, Rule[]> = { "sem-campanha": [] };
  for (const rule of rules) {
    const key = rule.campaignId ?? "sem-campanha";
    if (!rulesByCampaign[key]) rulesByCampaign[key] = [];
    rulesByCampaign[key].push(rule);
  }

  const needsCompany = isSuperAdmin && !selectedCompanyId;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-white font-bold text-xl">Gatilhos de Identificação</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Palavras-chave que convertem mensagens WhatsApp em leads e vinculam a campanhas
        </p>
      </div>

      {/* Company selector (super admin) */}
      {isSuperAdmin && (
        <form className="mb-6">
          <div className="flex gap-3 items-center">
            <select
              name="companyId"
              defaultValue={selectedCompanyId}
              className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Selecione uma empresa</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
            >
              Carregar
            </button>
          </div>
        </form>
      )}

      {needsCompany ? (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
          <div className="text-3xl mb-3">🏢</div>
          <div className="text-white font-semibold">Selecione uma empresa</div>
          <div className="text-slate-500 text-sm mt-1">Escolha uma empresa acima para gerenciar os gatilhos.</div>
        </div>
      ) : (
        <>
          {/* Mode toggle */}
          {company && (
            <div className={`rounded-xl border p-4 mb-6 flex items-center justify-between gap-4 ${company.triggerOnly ? "bg-amber-500/5 border-amber-500/30" : "bg-[#0f1623] border-[#1e2d45]"}`}>
              <div>
                <div className="text-white font-semibold text-sm mb-0.5">
                  {company.triggerOnly ? "⚡ Modo Gatilho Ativo" : "🌐 Modo Padrão (todas as mensagens)"}
                </div>
                <div className="text-slate-400 text-xs">
                  {company.triggerOnly
                    ? "Apenas mensagens que contêm uma palavra-chave abaixo viram leads. Outras são ignoradas."
                    : "Toda mensagem recebida vira lead. Palavras-chave apenas classificam o status e vinculam à campanha."}
                </div>
              </div>
              <button
                onClick={toggleTriggerOnly}
                disabled={togglingMode}
                className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${company.triggerOnly ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25" : "bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white"}`}
              >
                {togglingMode ? "..." : company.triggerOnly ? "Desativar modo gatilho" : "Ativar modo gatilho"}
              </button>
            </div>
          )}

          {/* How it works */}
          <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 mb-6">
            <div className="text-white font-semibold text-sm mb-2">💡 Como funciona</div>
            <ul className="text-slate-400 text-xs space-y-1">
              <li>• Uma mensagem chega via WhatsApp</li>
              <li>• O sistema verifica se contém alguma palavra-chave cadastrada abaixo</li>
              <li>• Se bater: cria/atualiza o lead com o <strong className="text-white">status</strong> e a <strong className="text-white">campanha</strong> configurados na regra</li>
              <li>• Regras de maior <strong className="text-white">prioridade</strong> têm preferência. Defina prioridades maiores para palavras mais específicas.</li>
            </ul>
          </div>

          {/* Add rule form */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 mb-6">
            <h2 className="text-white font-bold text-sm mb-4">+ Novo Gatilho</h2>
            <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Palavra-chave <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.keyword}
                  onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                  placeholder="ex: botox, agendamento, promoção..."
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
                <p className="text-slate-600 text-[10px] mt-1">Busca parcial — "boto" também encontra "botox"</p>
              </div>

              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Campanha vinculada
                </label>
                <select
                  value={form.campaignId}
                  onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Sem campanha</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {SOURCE_ICON[c.source] ?? "🔵"} {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Status do lead
                </label>
                <select
                  value={form.mapTo}
                  onChange={(e) => setForm({ ...form, mapTo: e.target.value })}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Prioridade
                </label>
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  min="0"
                  max="100"
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                <p className="text-slate-600 text-[10px] mt-1">Maior número = verificado primeiro</p>
              </div>

              <div className="col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {saving ? "Salvando..." : "Adicionar Gatilho"}
                </button>
              </div>
            </form>
          </div>

          {/* Rules list */}
          {rules.length === 0 ? (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-10 text-center">
              <div className="text-3xl mb-2">⚡</div>
              <div className="text-white font-semibold mb-1">Nenhum gatilho cadastrado</div>
              <div className="text-slate-500 text-sm">Adicione palavras-chave acima para identificar leads automaticamente.</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Agrupado por campanha */}
              {Object.entries(rulesByCampaign).map(([key, groupRules]) => {
                if (groupRules.length === 0) return null;
                const campaignName = key === "sem-campanha"
                  ? "Sem campanha vinculada"
                  : groupRules[0].campaign?.name ?? key;

                const campaign = key !== "sem-campanha"
                  ? campaigns.find((c) => c.id === key)
                  : null;

                return (
                  <div key={key} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#1e2d45] flex items-center gap-2">
                      {campaign ? (
                        <>
                          <span>{SOURCE_ICON[campaign.source] ?? "🔵"}</span>
                          <span className="text-white font-semibold text-sm">{campaignName}</span>
                          <span className="text-[11px] text-indigo-400 bg-indigo-500/15 px-2 py-0.5 rounded-full">Campanha</span>
                        </>
                      ) : (
                        <>
                          <span className="text-slate-600 text-sm">—</span>
                          <span className="text-slate-500 text-sm">{campaignName}</span>
                        </>
                      )}
                    </div>
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[#1e2d45]">
                          <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-2">Palavra-chave</th>
                          <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-2">Status resultante</th>
                          <th className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left px-4 py-2">Prioridade</th>
                          <th className="px-4 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupRules.map((rule) => (
                          <tr key={rule.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                            <td className="px-4 py-3">
                              <code className="text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded text-[13px] font-mono">
                                {rule.keyword}
                              </code>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[rule.mapTo] ?? ""}`}>
                                {STATUS_LABEL[rule.mapTo] ?? rule.mapTo}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-sm">
                              {rule.priority}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleDelete(rule.id)}
                                disabled={deleting === rule.id}
                                className="text-slate-600 hover:text-red-400 text-sm transition-colors disabled:opacity-50"
                                title="Remover gatilho"
                              >
                                🗑
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
