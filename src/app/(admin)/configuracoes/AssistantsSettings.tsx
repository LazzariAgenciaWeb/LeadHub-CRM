"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AssistantType = "PRE_ATENDENTE" | "VENDAS" | "SUPORTE" | "GESTOR";

const TYPE_META: Record<AssistantType, { label: string; icon: string; desc: string }> = {
  PRE_ATENDENTE: { label: "Pré-atendente", icon: "🚪", desc: "Triagem / 1º contato / roteamento" },
  VENDAS:        { label: "Vendas",        icon: "💼", desc: "Negociação: conduz o lead até comprar" },
  SUPORTE:       { label: "Suporte",       icon: "🎧", desc: "Atende quem já é cliente" },
  GESTOR:        { label: "Gestor",        icon: "📊", desc: "Resumos e apoio à decisão do dono" },
};
const TYPE_ORDER: AssistantType[] = ["PRE_ATENDENTE", "VENDAS", "SUPORTE", "GESTOR"];

// Estimativa de custo por interação (só pro SUPER_ADMIN ter ideia do limite).
// Base: gpt-4o-mini + tamanho típico de uma sugestão (suggest-reply).
// Ajuste aqui se a OpenAI mudar preço ou se trocar o modelo padrão.
const PRICE_USD_PER_1M = { input: 0.15, output: 0.60 }; // gpt-4o-mini
const EST_TOKENS = { input: 1500, output: 180 };         // ~25 msgs + manual / resposta curta
const USD_PER_INTERACTION =
  (EST_TOKENS.input * PRICE_USD_PER_1M.input + EST_TOKENS.output * PRICE_USD_PER_1M.output) / 1_000_000;
const USD_TO_BRL = 5.5; // câmbio aproximado — só pra dar ordem de grandeza

function fmtUsd(v: number) {
  return v < 0.01 ? `US$ ${v.toFixed(4)}` : `US$ ${v.toFixed(2)}`;
}
function fmtBrl(v: number) {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

interface Instance { id: string; label: string | null; instanceName: string; phone: string | null; status?: string }
interface Assistant {
  id: string;
  name: string;
  type: AssistantType;
  manual: string;
  isActive: boolean;
  instanceId: string | null;
  model: string | null;
  temperature: number | null;
  instance: Instance | null;
}
interface Quota { aiMonthlyQuota: number; aiUsedThisMonth: number; aiQuotaResetAt: string | null }

const MANUAL_PLACEHOLDER = `Ex.: Você é o closer de vendas da AZZ Agência. Seu objetivo é levar o lead a fechar.
- Tom: próximo, confiante, sem ser insistente.
- Sempre entenda a necessidade antes de oferecer.
- Destaque resultados e prazos. Conduza para uma proposta.
- Nunca prometa o que não está no escopo. Em dúvida, ofereça uma call.`;

function instLabel(i: Instance) {
  return i.label || i.instanceName || i.phone || i.id;
}

export default function AssistantsSettings({
  companyId,
  isSuperAdmin,
  initialAssistants,
  instances,
  quota,
}: {
  companyId: string;
  isSuperAdmin: boolean;
  initialAssistants: Assistant[];
  instances: Instance[];
  quota: Quota;
}) {
  const router = useRouter();
  const [assistants, setAssistants] = useState<Assistant[]>(initialAssistants);
  const [editing, setEditing] = useState<Assistant | "new" | null>(null);

  // ── Form state ──
  const [fName, setFName] = useState("");
  const [fType, setFType] = useState<AssistantType>("VENDAS");
  const [fManual, setFManual] = useState("");
  const [fInstance, setFInstance] = useState<string>("");
  const [fActive, setFActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── Quota state ──
  const [quotaVal, setQuotaVal] = useState(quota.aiMonthlyQuota);
  const [savingQuota, setSavingQuota] = useState(false);
  const remaining = Math.max(0, quota.aiMonthlyQuota - quota.aiUsedThisMonth);
  const pct = quota.aiMonthlyQuota > 0 ? Math.min(100, Math.round((quota.aiUsedThisMonth / quota.aiMonthlyQuota) * 100)) : 0;

  function openNew() {
    setEditing("new");
    setFName(""); setFType("VENDAS"); setFManual(""); setFInstance(""); setFActive(true); setErr(null);
  }
  function openEdit(a: Assistant) {
    setEditing(a);
    setFName(a.name); setFType(a.type); setFManual(a.manual);
    setFInstance(a.instanceId ?? ""); setFActive(a.isActive); setErr(null);
  }
  function closeForm() { setEditing(null); setErr(null); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const payload: any = {
      companyId, name: fName, type: fType, manual: fManual,
      instanceId: fInstance || null, isActive: fActive,
    };
    const isNew = editing === "new";
    const url = isNew ? "/api/ai/assistants" : `/api/ai/assistants/${(editing as Assistant).id}`;
    const res = await fetch(url, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error ?? "Erro ao salvar"); return;
    }
    closeForm();
    router.refresh();
    const fresh = await fetch(`/api/ai/assistants?companyId=${companyId}`).then((r) => r.json()).catch(() => null);
    if (Array.isArray(fresh)) setAssistants(fresh);
  }

  async function remove(a: Assistant) {
    if (!confirm(`Excluir o agente "${a.name}"?`)) return;
    const res = await fetch(`/api/ai/assistants/${a.id}`, { method: "DELETE" });
    if (res.ok) {
      setAssistants((prev) => prev.filter((x) => x.id !== a.id));
      router.refresh();
    }
  }

  async function saveQuota() {
    setSavingQuota(true);
    await fetch("/api/ai/credits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, aiMonthlyQuota: quotaVal }),
    });
    setSavingQuota(false);
    router.refresh();
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-xl">🤖</div>
        <div>
          <h1 className="text-white font-bold text-base">Assistentes de IA</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Cada agente tem um manual próprio (como agir, tom, objetivo) e pode atender uma instância específica.
          </p>
        </div>
      </div>

      {/* Cota de uso */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-bold text-sm">📊 Consumo de IA (mês atual)</h2>
          <span className="text-[10px] text-slate-500">
            {quota.aiQuotaResetAt ? `Renova em ${new Date(quota.aiQuotaResetAt).toLocaleDateString("pt-BR")}` : "—"}
          </span>
        </div>
        <div className="flex items-end gap-2 mb-2">
          <span className="text-2xl font-bold text-white">{quota.aiUsedThisMonth}</span>
          <span className="text-slate-500 text-sm mb-0.5">/ {quota.aiMonthlyQuota} interações</span>
          <span className="ml-auto text-xs text-slate-400 mb-1">{remaining} restantes</span>
        </div>
        <div className="h-2 rounded-full bg-[#161f30] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-indigo-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {quota.aiMonthlyQuota === 0 && (
          <p className="text-amber-400 text-xs mt-2">⚠️ Cota não liberada — os assistentes ficam bloqueados até definir um limite.</p>
        )}

        {isSuperAdmin ? (
          <div className="mt-4 pt-4 border-t border-[#1e2d45]">
            <div className="flex items-center gap-2">
              <label className="text-slate-400 text-xs">Cota mensal:</label>
              <input
                type="number" min={0}
                value={quotaVal}
                onChange={(e) => setQuotaVal(parseInt(e.target.value || "0", 10))}
                className="w-28 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={saveQuota}
                disabled={savingQuota}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-40"
              >
                {savingQuota ? "Salvando..." : "Salvar cota"}
              </button>
              <span className="text-[10px] text-slate-600 ml-auto">Só o admin da plataforma define a cota.</span>
            </div>
            {/* Estimativa de custo do limite — visível só pro super admin */}
            <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400 bg-[#161f30]/60 border border-[#1e2d45] rounded-lg px-3 py-2">
              <span>💰</span>
              <span>
                Custo estimado deste limite:{" "}
                <strong className="text-slate-200">{fmtUsd(quotaVal * USD_PER_INTERACTION)}</strong>
                {" "}<span className="text-slate-500">(~{fmtBrl(quotaVal * USD_PER_INTERACTION * USD_TO_BRL)})</span>
                {" "}/mês
              </span>
              <span className="text-slate-600 ml-auto">~{fmtUsd(USD_PER_INTERACTION)}/interação · gpt-4o-mini</span>
            </div>
          </div>
        ) : (
          <p className="text-slate-600 text-[10px] mt-3">Precisa de mais interações? Fale com o suporte para ampliar sua cota.</p>
        )}
      </section>

      {/* Lista de agentes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-sm">Agentes</h2>
          {editing === null && (
            <button onClick={openNew} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500">
              + Novo agente
            </button>
          )}
        </div>

        {/* Form (novo/edição) */}
        {editing !== null && (
          <form onSubmit={save} className="bg-[#0f1623] border border-indigo-500/30 rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Nome</label>
                <input
                  value={fName} onChange={(e) => setFName(e.target.value)}
                  placeholder="Ex.: Closer de Vendas"
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Função</label>
                <select
                  value={fType} onChange={(e) => setFType(e.target.value as AssistantType)}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>{TYPE_META[t].icon} {TYPE_META[t].label} — {TYPE_META[t].desc}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                Manual de instruções <span className="text-slate-600 normal-case">(como o agente deve agir)</span>
              </label>
              <textarea
                value={fManual} onChange={(e) => setFManual(e.target.value)}
                placeholder={MANUAL_PLACEHOLDER}
                rows={8}
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-y leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 items-end">
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  Instância WhatsApp <span className="text-slate-600 normal-case">(opcional)</span>
                </label>
                <select
                  value={fInstance} onChange={(e) => setFInstance(e.target.value)}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">Todas / genérico</option>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>{instLabel(i)}{i.phone ? ` (${i.phone})` : ""}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 pb-2.5 cursor-pointer">
                <input type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} className="accent-indigo-500" />
                Agente ativo
              </label>
            </div>

            {err && <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</div>}

            <div className="flex items-center gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">
                {saving ? "Salvando..." : editing === "new" ? "Criar agente" : "Salvar"}
              </button>
              <button type="button" onClick={closeForm} className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-sm hover:bg-[#1e2d45]">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Cards */}
        {assistants.length === 0 && editing === null && (
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-8 text-center">
            <p className="text-slate-400 text-sm">Nenhum agente criado ainda.</p>
            <p className="text-slate-600 text-xs mt-1">Crie o primeiro (ex.: Vendas) e escreva o manual de como ele deve negociar.</p>
          </div>
        )}

        {assistants.map((a) => {
          const meta = TYPE_META[a.type];
          return (
            <div key={a.id} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#161f30] flex items-center justify-center text-lg flex-shrink-0">{meta.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">{a.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#161f30] text-slate-400">{meta.label}</span>
                  {!a.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">inativo</span>}
                  {a.instance && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">📱 {instLabel(a.instance)}</span>}
                </div>
                <p className="text-slate-500 text-xs mt-1 line-clamp-2">{a.manual}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => openEdit(a)} className="px-2.5 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-xs hover:bg-[#1e2d45]">Editar</button>
                <button onClick={() => remove(a)} className="px-2.5 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-red-400 text-xs hover:bg-red-500/10">Excluir</button>
              </div>
            </div>
          );
        })}
      </section>

      <p className="text-slate-600 text-xs">
        💡 O agente <strong>Vendas</strong> ativo já alimenta o botão “Sugerir resposta” na Inbox — ele usa o manual acima.
        Os outros tipos entram nas próximas fases (pré-atendente, suporte, gestor).
      </p>
    </div>
  );
}
