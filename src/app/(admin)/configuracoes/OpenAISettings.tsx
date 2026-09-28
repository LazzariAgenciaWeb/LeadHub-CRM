"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AiSpendCard from "@/components/AiSpendCard";
import type { AiSpend } from "@/lib/ai-costs-format";

const MODELS = [
  {
    group: "GPT-4o",
    items: [
      { value: "gpt-4o",      label: "GPT-4o",           desc: "Mais inteligente e multimodal — recomendado" },
      { value: "gpt-4o-mini", label: "GPT-4o mini",      desc: "Rápido e econômico — ideal para automações" },
    ],
  },
  {
    group: "GPT-4 Turbo",
    items: [
      { value: "gpt-4-turbo", label: "GPT-4 Turbo",      desc: "Alta capacidade, contexto de 128k tokens" },
    ],
  },
  {
    group: "GPT-3.5",
    items: [
      { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo",  desc: "Legado — mais barato, menor qualidade" },
    ],
  },
];

const ALL_MODELS = MODELS.flatMap((g) => g.items);

export default function OpenAISettings({
  settings,
  spend,
  canEdit = true,
}: {
  settings: Record<string, string>;
  spend?: AiSpend;
  /** Chaves e motor são globais da plataforma: só SUPER_ADMIN grava. */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [saveError, setSaveError] = useState<string | null>(null);

  const [apiKey, setApiKey]   = useState(settings.openai_api_key ?? "");
  const [model, setModel]     = useState(settings.openai_model ?? "gpt-4o-mini");
  const [anthropicKey, setAnthropicKey]     = useState(settings.anthropic_api_key ?? "");
  const [anthropicModel, setAnthropicModel] = useState(settings.anthropic_model ?? "claude-opus-5");
  const [assistantProvider, setAssistantProvider] = useState(settings.assistant_provider === "openai" ? "openai" : "anthropic");
  const [assistantOpenAIModel, setAssistantOpenAIModel] = useState(settings.assistant_openai_model ?? "gpt-4o-mini");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; info?: string; error?: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    setSaveError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { key: "openai_api_key", value: apiKey },
        { key: "openai_model",   value: model  },
        { key: "anthropic_api_key", value: anthropicKey },
        { key: "anthropic_model",   value: anthropicModel },
        { key: "assistant_provider",     value: assistantProvider },
        { key: "assistant_openai_model", value: assistantOpenAIModel },
      ]),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSaveError(res.status === 403 ? "Sem permissão: essas configurações são da plataforma e só o Super Admin altera." : (body.error ?? `Erro ${res.status} ao salvar`));
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    router.refresh();
  }

  async function handleTest() {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const count = data.data?.length ?? 0;
        setTestResult({ ok: true, info: `Conectado — ${count} modelos disponíveis` });
      } else {
        const err = await res.json().catch(() => ({}));
        setTestResult({ ok: false, error: err.error?.message ?? `Erro ${res.status}: chave inválida ou sem permissão` });
      }
    } catch {
      setTestResult({ ok: false, error: "Falha na conexão com a API da OpenAI" });
    }
    setTesting(false);
  }

  const selectedModel = ALL_MODELS.find((m) => m.value === model);

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-xl">🤖</div>
        <div>
          <h1 className="text-white font-bold text-base">Inteligência Artificial</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            OpenAI: resumos, sugestões de resposta, classificação de leads e transcrição de áudio. Claude (Anthropic): assistente pessoal.
          </p>
        </div>
      </div>

      {spend && <AiSpendCard spend={spend} />}

      {/* Formulário principal */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🔑 OpenAI</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Chave em <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">platform.openai.com/api-keys</a>
            {" · "}Saldo em <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Billing da OpenAI</a>
          </p>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5">
          {!canEdit && (
            <div className="text-xs px-3 py-2 rounded-lg border text-amber-200 bg-amber-500/10 border-amber-500/25">
              🔒 Somente leitura: chaves e motor de IA são configurações da plataforma. Só o Super Admin (Lazzari) altera.
            </div>
          )}
          <fieldset disabled={!canEdit} className="space-y-5 disabled:opacity-70">
          {/* API Key */}
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              API Key
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
                placeholder="sk-••••••••••••••••••••••••••••••••••••••••••••••••"
                className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !apiKey.trim()}
                className="px-4 py-2.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-sm font-medium hover:bg-[#1e2d45] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {testing ? "Testando..." : "Testar"}
              </button>
            </div>
            {testResult && (
              <div className={`mt-2 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                testResult.ok
                  ? "text-green-400 bg-green-500/10 border-green-500/20"
                  : "text-red-400 bg-red-500/10 border-red-500/20"
              }`}>
                {testResult.ok ? `✅ ${testResult.info}` : `❌ ${testResult.error}`}
              </div>
            )}
          </div>

          {/* Seletor de modelo */}
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              Modelo padrão
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer"
            >
              {MODELS.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedModel && (
              <p className="text-slate-600 text-[10px] mt-1">{selectedModel.desc}</p>
            )}
          </div>

          {/* Anthropic (Claude) — motor do Assistente pessoal (tool use) */}
          <div className="pt-4 border-t border-[#1e2d45] space-y-4">
            <div>
              <h3 className="text-white font-bold text-sm">✨ Anthropic (Claude) — Assistente pessoal</h3>
              <p className="text-slate-500 text-xs mt-0.5">
                O assistente pessoal (chat, grupo do WhatsApp e MCP) usa o Claude pra executar ações no sistema. Chave em{" "}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">console.anthropic.com/settings/keys</a>
                {" · "}Saldo em <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Billing da Anthropic</a>.
                A conta de API precisa ter crédito, senão as chamadas falham. O Whisper (transcrição de áudio) continua usando a chave da OpenAI acima.
              </p>
            </div>
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">API Key Anthropic</label>
              <input
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-••••••••••••••••••••••••••••••••"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Modelo do assistente</label>
              <select
                value={anthropicModel}
                onChange={(e) => setAnthropicModel(e.target.value)}
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer"
              >
                <option value="claude-opus-5">Claude Opus 5 — melhor, mais caro (US$ 5 / 25 por 1M tokens)</option>
                <option value="claude-sonnet-5">Claude Sonnet 5 — ótimo custo-benefício (US$ 2 / 10)</option>
                <option value="claude-haiku-4-5">Claude Haiku 4.5 — mais barato e rápido (US$ 1 / 5)</option>
              </select>
            </div>
          </div>

          {/* Motor do assistente pessoal: qual conta paga a conversa */}
          <div className="pt-4 border-t border-[#1e2d45] space-y-4">
            <div>
              <h3 className="text-white font-bold text-sm">⚙️ Motor do assistente pessoal</h3>
              <p className="text-slate-500 text-xs mt-0.5">
                Escolha qual conta processa o assistente (chat, WhatsApp e MCP). Cada mensagem envia as ferramentas + instruções (~5 mil tokens), então o preço do modelo pesa. Vale trocar e comparar.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Provedor</label>
                <select
                  value={assistantProvider}
                  onChange={(e) => setAssistantProvider(e.target.value)}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer"
                >
                  <option value="anthropic">Claude (Anthropic) — usa o modelo acima</option>
                  <option value="openai">OpenAI — mais barato</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Modelo OpenAI do assistente</label>
                <select
                  value={assistantOpenAIModel}
                  onChange={(e) => setAssistantOpenAIModel(e.target.value)}
                  disabled={assistantProvider !== "openai"}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer disabled:opacity-40"
                >
                  <option value="gpt-4o-mini">GPT-4o mini — muito barato (US$ 0,15 / 0,60)</option>
                  <option value="gpt-4.1-mini">GPT-4.1 mini — barato, melhor com ferramentas (US$ 0,40 / 1,60)</option>
                  <option value="gpt-4.1">GPT-4.1 — completo (US$ 2 / 8)</option>
                  <option value="gpt-4o">GPT-4o (US$ 2,50 / 10)</option>
                </select>
              </div>
            </div>
            <p className="text-slate-600 text-[10px]">Preços por 1M tokens (entrada / saída), referência. A transcrição de áudio usa sempre a OpenAI (Whisper).</p>
          </div>

          <button
            type="submit"
            disabled={saving || !canEdit}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          >
            {saved ? "✓ Salvo!" : saving ? "Salvando..." : "Salvar configurações"}
          </button>
          {saveError && (
            <div className="text-xs px-3 py-2 rounded-lg border text-red-400 bg-red-500/10 border-red-500/20">❌ {saveError}</div>
          )}
          </fieldset>
        </form>
      </section>

      {/* Comparativo de modelos */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3">📊 Comparativo de modelos</h3>
        <div className="space-y-2">
          {ALL_MODELS.map((m) => (
            <div
              key={m.value}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                model === m.value
                  ? "border-indigo-500/50 bg-indigo-500/10"
                  : "border-[#1e2d45] bg-[#161f30] hover:border-[#2d4060]"
              }`}
              onClick={() => setModel(m.value)}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${model === m.value ? "bg-indigo-400" : "bg-slate-600"}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold ${model === m.value ? "text-indigo-300" : "text-slate-300"}`}>
                  {m.label}
                </div>
                <div className="text-[10px] text-slate-500 truncate">{m.desc}</div>
              </div>
              <code className={`text-[10px] font-mono ${model === m.value ? "text-indigo-400" : "text-slate-600"}`}>
                {m.value}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* O que será usado */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3">🚀 Funcionalidades disponíveis</h3>
        <div className="space-y-2">
          {[
            { icon: "✅", label: "Resumo de conversa WhatsApp",     desc: "Resume o histórico de mensagens em segundos" },
            { icon: "✅", label: "Sugestão de resposta",            desc: "Sugere a próxima mensagem com base no contexto" },
            { icon: "✅", label: "Classificação automática de lead", desc: "Avalia o interesse e maturidade do lead" },
            { icon: "🔜", label: "Resposta automática (chatbot)",   desc: "Em breve — responde pelo WhatsApp automaticamente" },
            { icon: "🔜", label: "Análise de sentimento",           desc: "Em breve — detecta satisfação do cliente" },
          ].map((f) => (
            <div key={f.label} className="flex items-start gap-3 text-sm">
              <span className="text-base mt-0.5 flex-shrink-0">{f.icon}</span>
              <div>
                <div className="text-slate-300">{f.label}</div>
                <div className="text-slate-500 text-xs">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-slate-600 text-xs mt-3">
          Funcionalidades ativadas automaticamente quando a API Key estiver configurada.
        </p>
      </section>
    </div>
  );
}
