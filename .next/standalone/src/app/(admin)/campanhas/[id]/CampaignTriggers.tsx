"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Rule {
  id: string;
  keyword: string;
  mapTo: string;
  priority: number;
}

const STATUS_OPTIONS = [
  { value: "NEW", label: "Novo", color: "text-indigo-400 bg-indigo-500/15" },
  { value: "CONTACTED", label: "Em Contato", color: "text-blue-400 bg-blue-500/15" },
  { value: "PROPOSAL", label: "Proposta", color: "text-yellow-400 bg-yellow-500/15" },
  { value: "CLOSED", label: "Fechado", color: "text-green-400 bg-green-500/15" },
  { value: "LOST", label: "Perdido", color: "text-red-400 bg-red-500/10" },
];

export default function CampaignTriggers({
  campaignId,
  companyId,
  initialRules,
}: {
  campaignId: string;
  companyId: string;
  initialRules: Rule[];
}) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [mapTo, setMapTo] = useState("NEW");
  const [priority, setPriority] = useState("0");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;

    setSaving(true);
    const res = await fetch("/api/keyword-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: keyword.trim().toLowerCase(),
        mapTo,
        priority: parseInt(priority) || 0,
        companyId,
        campaignId,
      }),
    });

    if (res.ok) {
      const rule = await res.json();
      setRules((prev) => [...prev, rule]);
      setKeyword("");
      setMapTo("NEW");
      setPriority("0");
      router.refresh();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    await fetch(`/api/keyword-rules/${id}`, { method: "DELETE" });
    setRules((prev) => prev.filter((r) => r.id !== id));
    setDeleting(null);
    router.refresh();
  }

  const statusColor: Record<string, string> = {
    NEW: "text-indigo-400 bg-indigo-500/15",
    CONTACTED: "text-blue-400 bg-blue-500/15",
    PROPOSAL: "text-yellow-400 bg-yellow-500/15",
    CLOSED: "text-green-400 bg-green-500/15",
    LOST: "text-red-400 bg-red-500/10",
  };
  const statusLabel: Record<string, string> = {
    NEW: "Novo", CONTACTED: "Em Contato", PROPOSAL: "Proposta", CLOSED: "Fechado", LOST: "Perdido",
  };

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#1e2d45]">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-sm">⚡ Gatilhos da Campanha</h3>
          {rules.length > 0 && (
            <span className="text-[11px] text-indigo-400 bg-indigo-500/15 px-2 py-0.5 rounded-full font-semibold">
              {rules.length} gatilho{rules.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p className="text-slate-500 text-xs mt-1">
          Adicione quantas palavras-chave quiser. Quando uma mensagem WhatsApp contiver qualquer uma delas, o contato vira lead desta campanha com o status definido.
        </p>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="p-4 border-b border-[#1e2d45] space-y-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder='ex: "botox", "promoção abril", "agendar"'
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <select
            value={mapTo}
            onChange={(e) => setMapTo(e.target.value)}
            className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-2 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            min="0"
            max="100"
            title="Prioridade"
            className="w-16 bg-[#161f30] border border-[#1e2d45] rounded-lg px-2 py-2 text-xs text-white text-center focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={saving || !keyword.trim()}
            className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {saving ? "..." : "+ Adicionar"}
          </button>
        </div>
        <div className="flex gap-4 text-[10px] text-slate-600">
          <span>Palavra-chave (busca parcial)</span>
          <span>Status do lead</span>
          <span>Prioridade (0–100)</span>
        </div>
      </form>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="p-8 text-center">
          <div className="text-2xl mb-2">⚡</div>
          <div className="text-slate-500 text-sm">Nenhum gatilho ainda.</div>
          <div className="text-slate-600 text-xs mt-1">
            Adicione palavras-chave acima para identificar leads automaticamente.
          </div>
        </div>
      ) : (
        <div>
          {rules.map((rule, idx) => (
            <div
              key={rule.id}
              className={`flex items-center gap-3 px-4 py-3 ${idx < rules.length - 1 ? "border-b border-[#1e2d45]/50" : ""} hover:bg-white/[0.02] transition-colors group`}
            >
              {/* Keyword */}
              <code className="flex-1 text-indigo-300 bg-indigo-500/10 px-2.5 py-1 rounded-lg text-[13px] font-mono">
                {rule.keyword}
              </code>

              {/* Arrow */}
              <span className="text-slate-600 text-xs flex-shrink-0">→</span>

              {/* Status */}
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor[rule.mapTo] ?? ""}`}>
                {statusLabel[rule.mapTo] ?? rule.mapTo}
              </span>

              {/* Priority */}
              {rule.priority > 0 && (
                <span className="text-[10px] text-slate-600 flex-shrink-0">p:{rule.priority}</span>
              )}

              {/* Delete */}
              <button
                onClick={() => handleDelete(rule.id)}
                disabled={deleting === rule.id}
                className="text-slate-700 hover:text-red-400 text-sm transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                title="Remover"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {rules.length > 0 && (
        <div className="px-4 py-3 bg-indigo-500/5 border-t border-indigo-500/10">
          <p className="text-indigo-400/70 text-[10px]">
            💡 Regras de maior prioridade são verificadas primeiro. Quando uma mensagem bate, o lead é criado com o status definido e vinculado a esta campanha.
          </p>
        </div>
      )}
    </div>
  );
}
