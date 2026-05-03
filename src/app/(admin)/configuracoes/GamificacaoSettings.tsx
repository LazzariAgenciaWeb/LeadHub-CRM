"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScoreReason } from "@/generated/prisma";
import { REASON_LABEL } from "../gamificacao/labels";

type Rule = {
  reason:         ScoreReason;
  defaultPoints:  number;
  enabled:        boolean;
  points:         number;
  affectsRanking: boolean;
};

type UserRow = {
  id:              string;
  name:            string;
  email:           string;
  role:            string;
  rankingCategory: "PRODUCAO" | "GESTAO";
};

interface Props {
  initialRules: Rule[];
  users:        UserRow[];
}

export default function GamificacaoSettings({ initialRules, users: initialUsers }: Props) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function setCategory(userId: string, category: "PRODUCAO" | "GESTAO") {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, rankingCategory: category } : u)));
    await fetch(`/api/users/${userId}/ranking-category`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ rankingCategory: category }),
    });
    router.refresh();
  }

  function update(reason: ScoreReason, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r) => (r.reason === reason ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    await fetch("/api/configuracoes/gamificacao", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ rules }),
    });
    setSaving(false);
    setSavedAt(Date.now());
    router.refresh();
    setTimeout(() => setSavedAt(null), 2500);
  }

  function resetToDefault(reason: ScoreReason) {
    const r = rules.find((x) => x.reason === reason);
    if (!r) return;
    update(reason, {
      enabled:        true,
      points:         r.defaultPoints,
      affectsRanking: true,
    });
  }

  const positives = rules.filter((r) => r.defaultPoints >= 0);
  const negatives = rules.filter((r) => r.defaultPoints < 0);

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h2 className="text-white font-bold text-lg mb-1">Gamificação</h2>
        <p className="text-slate-500 text-sm">
          Defina o valor dos pontos por ação e se cada uma soma para o ranking mensal.
          Desativar uma razão impede que ela gere eventos e badges.
        </p>
      </div>

      {/* Razões positivas */}
      <Section title="✅ Pontuações positivas" rules={positives} update={update} resetToDefault={resetToDefault} />

      {/* Razões negativas */}
      <Section title="⚠️ Penalidades" rules={negatives} update={update} resetToDefault={resetToDefault} />

      {/* Categoria de ranking dos usuários */}
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1e2d45] bg-[#080b12]/50">
          <h3 className="text-white text-sm font-semibold">🎯 Categoria de ranking</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Cada usuário aparece em um leaderboard separado. <strong>Produção</strong> = atendentes/operação. <strong>Gestão</strong> = gerentes/diretoria.
          </p>
        </div>
        <div className="divide-y divide-[#1e2d45]">
          {users.length === 0 ? (
            <div className="p-4 text-slate-500 text-xs">Nenhum usuário encontrado.</div>
          ) : users.map((u) => (
            <div key={u.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#161f30] text-slate-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                {u.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm">{u.name}</div>
                <div className="text-slate-600 text-[11px] truncate">{u.email} · {u.role}</div>
              </div>
              <div className="flex gap-1.5 bg-[#080b12] border border-[#1e2d45] rounded-lg p-0.5">
                <button
                  onClick={() => setCategory(u.id, "PRODUCAO")}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    u.rankingCategory === "PRODUCAO"
                      ? "bg-emerald-500/20 text-emerald-300 font-semibold"
                      : "text-slate-500 hover:text-white"
                  }`}
                >
                  👷 Produção
                </button>
                <button
                  onClick={() => setCategory(u.id, "GESTAO")}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    u.rankingCategory === "GESTAO"
                      ? "bg-indigo-500/20 text-indigo-300 font-semibold"
                      : "text-slate-500 hover:text-white"
                  }`}
                >
                  👔 Gestão
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 sticky bottom-0 bg-[#080b12] py-4 border-t border-[#1e2d45] -mx-6 px-6">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
        {savedAt && <span className="text-emerald-400 text-xs">✓ Salvo</span>}
      </div>
    </div>
  );
}

function Section({
  title, rules, update, resetToDefault,
}: {
  title: string;
  rules: Rule[];
  update: (reason: ScoreReason, patch: Partial<Rule>) => void;
  resetToDefault: (reason: ScoreReason) => void;
}) {
  if (rules.length === 0) return null;
  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e2d45] bg-[#080b12]/50">
        <h3 className="text-white text-sm font-semibold">{title}</h3>
      </div>

      <div className="divide-y divide-[#1e2d45]">
        {rules.map((r) => {
          const meta = REASON_LABEL[r.reason];
          const isCustom = r.points !== r.defaultPoints || !r.enabled || !r.affectsRanking;
          return (
            <div key={r.reason} className={`p-4 ${!r.enabled ? "opacity-50" : ""}`}>
              <div className="flex items-start gap-4">
                {/* Toggle ativo */}
                <label className="flex items-center cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => update(r.reason, { enabled: e.target.checked })}
                    className="w-4 h-4 rounded accent-indigo-500"
                  />
                </label>

                {/* Descrição */}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium">{meta.text}</div>
                  <div className="text-slate-600 text-[11px] mt-0.5 font-mono">{r.reason}</div>
                </div>

                {/* Pontos */}
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-xs">Pontos:</span>
                  <input
                    type="number"
                    value={r.points}
                    onChange={(e) => update(r.reason, { points: parseInt(e.target.value) || 0 })}
                    disabled={!r.enabled}
                    className="w-20 bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                  <span className="text-slate-700 text-[11px]">(default: {r.defaultPoints})</span>
                </div>

                {/* Soma no ranking */}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.affectsRanking}
                    onChange={(e) => update(r.reason, { affectsRanking: e.target.checked })}
                    disabled={!r.enabled}
                    className="w-4 h-4 rounded accent-emerald-500"
                  />
                  <span className="text-slate-400 text-xs">Conta no ranking</span>
                </label>

                {/* Reset */}
                {isCustom && (
                  <button
                    onClick={() => resetToDefault(r.reason)}
                    className="text-slate-500 hover:text-white text-xs"
                    title="Voltar ao padrão"
                  >
                    ↺
                  </button>
                )}
              </div>

              {/* Aviso quando "não conta no ranking" */}
              {r.enabled && !r.affectsRanking && (
                <div className="mt-2 ml-8 text-amber-300/80 text-[11px] bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1">
                  ⓘ Esta razão gera badges mas <strong>não soma</strong> para o ranking mensal.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
