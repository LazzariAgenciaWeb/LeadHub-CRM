"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
}: {
  settings: Record<string, string>;
}) {
  const router = useRouter();

  const [apiKey, setApiKey]   = useState(settings.openai_api_key ?? "");
  const [model, setModel]     = useState(settings.openai_model ?? "gpt-4o-mini");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; info?: string; error?: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { key: "openai_api_key", value: apiKey },
        { key: "openai_model",   value: model  },
      ]),
    });
    setSaving(false);
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
          <h1 className="text-white font-bold text-base">OpenAI</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Conecte a IA da OpenAI para resumos, sugestões de resposta, classificação de leads e muito mais.
          </p>
        </div>
      </div>

      {/* Formulário principal */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🔑 Credenciais</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Encontre em: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">platform.openai.com/api-keys</a>
          </p>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5">
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

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          >
            {saved ? "✓ Salvo!" : saving ? "Salvando..." : "Salvar configurações"}
          </button>
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
