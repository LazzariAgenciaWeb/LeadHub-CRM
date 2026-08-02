"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AssistantType = "PRE_ATENDENTE" | "VENDAS" | "SUPORTE" | "FINANCEIRO" | "GESTOR";

const TYPE_META: Record<AssistantType, { label: string; icon: string; desc: string }> = {
  PRE_ATENDENTE: { label: "Pré-atendente", icon: "🚪", desc: "Triagem / 1º contato / roteamento" },
  VENDAS:        { label: "Vendas",        icon: "💼", desc: "Negociação: conduz o lead até comprar" },
  SUPORTE:       { label: "Suporte",       icon: "🎧", desc: "Atende quem já é cliente" },
  FINANCEIRO:    { label: "Financeiro",    icon: "💰", desc: "Boletos, notas e cobranças" },
  GESTOR:        { label: "Gestor",        icon: "📊", desc: "Resumos e apoio à decisão do dono" },
};
const TYPE_ORDER: AssistantType[] = ["PRE_ATENDENTE", "VENDAS", "SUPORTE", "FINANCEIRO", "GESTOR"];

// Estimativa de custo por interação (só pro SUPER_ADMIN ter ideia do limite).
// Base: gpt-4o-mini. O custo de ENTRADA varia com o tamanho do manual do agente,
// então a estimativa soma: histórico + regras de formato + manual real do agente.
// Ajuste aqui se a OpenAI mudar preço ou se trocar o modelo padrão.
const PRICE_USD_PER_1M = { input: 0.15, output: 0.60 }; // gpt-4o-mini
const HISTORY_TOKENS = 1500; // ~25 mensagens de contexto da conversa
const FORMAT_TOKENS = 150;   // regras de formato anexadas pelo sistema
const OUTPUT_TOKENS = 180;   // resposta curta sugerida
const USD_TO_BRL = 5.5;      // câmbio aproximado — só pra dar ordem de grandeza

// ~4 caracteres por token (regra de bolso para pt-BR).
function estTokens(text: string) {
  return Math.ceil((text?.length ?? 0) / 4);
}
// Custo USD de 1 interação dado o tamanho do manual (em tokens).
function usdPerInteraction(manualTokens: number) {
  const input = HISTORY_TOKENS + FORMAT_TOKENS + manualTokens;
  return (input * PRICE_USD_PER_1M.input + OUTPUT_TOKENS * PRICE_USD_PER_1M.output) / 1_000_000;
}

function fmtUsd(v: number) {
  return v < 0.01 ? `US$ ${v.toFixed(4)}` : `US$ ${v.toFixed(2)}`;
}
function fmtBrl(v: number) {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

interface Instance { id: string; label: string | null; instanceName: string; phone: string | null; status?: string }
interface Setor { id: string; name: string }
interface Route { intent: string; label: string | null; setorId: string; createLead: boolean; setor?: Setor | null }
interface Assistant {
  id: string;
  name: string;
  type: AssistantType;
  manual: string;
  isActive: boolean;
  autoRespond: boolean;
  learnings: string | null;
  qualificationChecklist: string | null;
  instanceId: string | null;
  schedulingLink: string | null;
  model: string | null;
  temperature: number | null;
  instance: Instance | null;
  routes?: Route[];
}
interface Quota { aiMonthlyQuota: number; aiUsedThisMonth: number; aiQuotaResetAt: string | null }

const MANUAL_PLACEHOLDER = `Ex.: Você é o closer de vendas da AZZ Agência. Seu objetivo é levar o lead a fechar.
- Tom: próximo, confiante, sem ser insistente.
- Sempre entenda a necessidade antes de oferecer.
- Destaque resultados e prazos. Conduza para uma proposta.
- Nunca prometa o que não está no escopo. Em dúvida, ofereça uma call.`;

const CHECKLIST_PLACEHOLDER = `Uma informação por linha. Ex.:
Nome
Nome da empresa
Ramo de atuação
Já investe em anúncios online?`;

const LEARNINGS_PLACEHOLDER = `Correções e orientações que o agente deve seguir (têm prioridade sobre o manual). Ex.:
- Boleto e nota fiscal: sempre encaminhar pro Atendimento, nunca tentar resolver.
- Não oferecer criação de sites pra quem já é cliente de hospedagem — encaminhar direto.`;

function instLabel(i: Instance) {
  return i.label || i.instanceName || i.phone || i.id;
}

export default function AssistantsSettings({
  companyId,
  isSuperAdmin,
  initialAssistants,
  instances,
  setores,
  quota,
}: {
  companyId: string;
  isSuperAdmin: boolean;
  initialAssistants: Assistant[];
  instances: Instance[];
  setores: Setor[];
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
  const [fSchedulingLink, setFSchedulingLink] = useState("");
  const [fActive, setFActive] = useState(true);
  const [fAutoRespond, setFAutoRespond] = useState(false);
  const [fChecklist, setFChecklist] = useState("");
  const [fLearnings, setFLearnings] = useState("");
  const [fRoutes, setFRoutes] = useState<Route[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── Quota state ──
  const [quotaVal, setQuotaVal] = useState(quota.aiMonthlyQuota);
  const [savingQuota, setSavingQuota] = useState(false);
  const remaining = Math.max(0, quota.aiMonthlyQuota - quota.aiUsedThisMonth);
  const pct = quota.aiMonthlyQuota > 0 ? Math.min(100, Math.round((quota.aiUsedThisMonth / quota.aiMonthlyQuota) * 100)) : 0;

  // Custo por interação reflete o manual do agente VENDAS ativo (que alimenta o
  // "Sugerir resposta" hoje). Sem agente, usa um manual médio de ~500 tokens.
  const activeVendas = assistants.find((a) => a.type === "VENDAS" && a.isActive);
  const manualTokens = activeVendas ? estTokens(activeVendas.manual) : 500;
  const costPerInteraction = usdPerInteraction(manualTokens);

  function openNew() {
    setEditing("new");
    setFName(""); setFType("VENDAS"); setFManual(""); setFInstance(""); setFSchedulingLink(""); setFActive(true); setErr(null);
    setFAutoRespond(false); setFChecklist(""); setFLearnings("");
    // Sugestão inicial das 2 rotas clássicas (o usuário edita/remove à vontade)
    setFRoutes([
      { intent: "COMERCIAL", label: "Time comercial", setorId: "", createLead: true },
      { intent: "ATENDIMENTO", label: "Atendimento a clientes", setorId: "", createLead: false },
    ]);
  }
  function openEdit(a: Assistant) {
    setEditing(a);
    setFName(a.name); setFType(a.type); setFManual(a.manual);
    setFInstance(a.instanceId ?? ""); setFSchedulingLink(a.schedulingLink ?? ""); setFActive(a.isActive); setErr(null);
    setFAutoRespond(a.autoRespond ?? false);
    setFChecklist(a.qualificationChecklist ?? "");
    setFLearnings(a.learnings ?? "");
    setFRoutes((a.routes ?? []).map((r) => ({ intent: r.intent, label: r.label, setorId: r.setorId, createLead: r.createLead })));
  }
  function closeForm() { setEditing(null); setErr(null); }

  function setRoute(idx: number, patch: Partial<Route>) {
    setFRoutes((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const payload: any = {
      companyId, name: fName, type: fType, manual: fManual,
      instanceId: fInstance || null, schedulingLink: fSchedulingLink, isActive: fActive,
      autoRespond: fAutoRespond,
      qualificationChecklist: fChecklist,
      learnings: fLearnings,
      // Rotas: só linhas com setor escolhido (linhas vazias são descartadas)
      routes: fRoutes.filter((r) => r.intent.trim() && r.setorId),
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
                <strong className="text-slate-200">{fmtUsd(quotaVal * costPerInteraction)}</strong>
                {" "}<span className="text-slate-500">(~{fmtBrl(quotaVal * costPerInteraction * USD_TO_BRL)})</span>
                {" "}/mês
              </span>
              <span className="text-slate-600 ml-auto">~{fmtUsd(costPerInteraction)}/interação · gpt-4o-mini · manual ~{manualTokens} tokens</span>
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

            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                Link de agendamento <span className="text-slate-600 normal-case">(opcional — o sistema envia a URL exata ao marcar reunião)</span>
              </label>
              <input
                value={fSchedulingLink} onChange={(e) => setFSchedulingLink(e.target.value)}
                placeholder="https://calendar.app.google/..."
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            {/* ── Modo autônomo ── */}
            <div className={`rounded-xl border p-4 space-y-4 ${fAutoRespond ? "border-emerald-500/30 bg-emerald-500/5" : "border-[#1e2d45] bg-[#161f30]/40"}`}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fAutoRespond}
                  onChange={(e) => setFAutoRespond(e.target.checked)}
                  className="accent-emerald-500 mt-0.5"
                />
                <span>
                  <span className="text-white text-sm font-semibold">🤖 Responder sozinho (modo autônomo)</span>
                  <span className="block text-slate-500 text-xs mt-0.5">
                    O agente responde as mensagens que chegam na instância vinculada, qualifica e encaminha pro setor certo — sem atendente.
                    Ele para de responder assim que um humano assume a conversa.
                  </span>
                </span>
              </label>

              {fAutoRespond && (
                <>
                  {/* Rotas de triagem */}
                  <div>
                    <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                      Rotas de encaminhamento <span className="text-slate-600 normal-case">(intenção → setor que assume)</span>
                    </label>
                    <div className="space-y-2">
                      {fRoutes.map((r, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            value={r.intent}
                            onChange={(e) => setRoute(idx, { intent: e.target.value.toUpperCase() })}
                            placeholder="COMERCIAL"
                            className="w-36 bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                          />
                          <span className="text-slate-600 text-xs">→</span>
                          <select
                            value={r.setorId}
                            onChange={(e) => setRoute(idx, { setorId: e.target.value })}
                            className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                          >
                            <option value="">— escolher setor —</option>
                            {setores.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 whitespace-nowrap cursor-pointer" title="Ao encaminhar, cria/atualiza o Lead no CRM com o resumo da qualificação">
                            <input
                              type="checkbox"
                              checked={r.createLead}
                              onChange={(e) => setRoute(idx, { createLead: e.target.checked })}
                              className="accent-emerald-500"
                            />
                            cria lead
                          </label>
                          <button
                            type="button"
                            onClick={() => setFRoutes((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-slate-600 hover:text-red-400 text-sm px-1"
                            title="Remover rota"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setFRoutes((prev) => [...prev, { intent: "", label: null, setorId: "", createLead: false }])}
                      className="mt-2 text-emerald-400 text-xs hover:text-emerald-300"
                    >
                      + Adicionar rota
                    </button>
                    {setores.length === 0 && (
                      <p className="text-amber-400 text-[11px] mt-1.5">⚠️ Nenhum setor cadastrado nesta empresa — crie os setores primeiro (Configurações → Setores).</p>
                    )}
                  </div>

                  {/* Checklist ICP */}
                  <div>
                    <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                      Informações obrigatórias (ICP) <span className="text-slate-600 normal-case">— coletadas antes de agendar/encaminhar, uma por linha</span>
                    </label>
                    <textarea
                      value={fChecklist} onChange={(e) => setFChecklist(e.target.value)}
                      placeholder={CHECKLIST_PLACEHOLDER}
                      rows={4}
                      className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 resize-y leading-relaxed"
                    />
                  </div>

                  {/* Aprendizados */}
                  <div>
                    <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                      📚 Aprendizados <span className="text-slate-600 normal-case">— correções acumuladas; têm prioridade sobre o manual</span>
                    </label>
                    <textarea
                      value={fLearnings} onChange={(e) => setFLearnings(e.target.value)}
                      placeholder={LEARNINGS_PLACEHOLDER}
                      rows={4}
                      className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 resize-y leading-relaxed"
                    />
                  </div>
                </>
              )}
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
                  {a.autoRespond && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-medium">🤖 autônomo</span>}
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
