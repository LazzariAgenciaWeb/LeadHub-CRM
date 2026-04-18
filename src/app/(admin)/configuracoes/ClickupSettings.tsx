"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ClickupSettings({
  settings,
}: {
  settings: Record<string, string>;
}) {
  const router = useRouter();

  const [apiToken, setApiToken] = useState(settings.clickup_api_token ?? "");
  const [opListId, setOpListId] = useState(settings.clickup_oportunidades_list_id ?? "");
  const [ticketListId, setTicketListId] = useState(settings.clickup_tickets_list_id ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { key: "clickup_api_token", value: apiToken },
        { key: "clickup_oportunidades_list_id", value: opListId },
        { key: "clickup_tickets_list_id", value: ticketListId },
      ]),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    router.refresh();
  }

  async function handleTest() {
    if (!apiToken.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("https://api.clickup.com/api/v2/user", {
        headers: { Authorization: apiToken },
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult({ ok: true, user: data.user?.username ?? data.user?.email ?? "OK" });
      } else {
        setTestResult({ ok: false, error: `Erro ${res.status}: token inválido ou sem permissão` });
      }
    } catch {
      setTestResult({ ok: false, error: "Falha na conexão com a API do ClickUp" });
    }
    setTesting(false);
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-[#7B68EE]/20 flex items-center justify-center text-xl">✅</div>
        <div>
          <h1 className="text-white font-bold text-base">ClickUp</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Conecte suas Oportunidades e Chamados ao ClickUp para acompanhar tarefas em tempo real.
          </p>
        </div>
      </div>

      {/* API Token */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🔑 API Token</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Encontre em: ClickUp → Configurações → Apps → API Token.
          </p>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-5">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              Personal API Token
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiToken}
                onChange={(e) => { setApiToken(e.target.value); setTestResult(null); }}
                placeholder="pk_••••••••••••••••••••••••••••••"
                className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !apiToken.trim()}
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
                {testResult.ok ? `✅ Conectado como @${testResult.user}` : `❌ ${testResult.error}`}
              </div>
            )}
          </div>

          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              List ID — Oportunidades
            </label>
            <input
              type="text"
              value={opListId}
              onChange={(e) => setOpListId(e.target.value)}
              placeholder="Ex: 901234567890"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-slate-600 text-[10px] mt-1">
              ID da lista onde novas oportunidades serão criadas como tarefas.
            </p>
          </div>

          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              List ID — Chamados
            </label>
            <input
              type="text"
              value={ticketListId}
              onChange={(e) => setTicketListId(e.target.value)}
              placeholder="Ex: 901234567891"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-slate-600 text-[10px] mt-1">
              ID da lista onde novos chamados serão criados como tarefas.
            </p>
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

      {/* Dica de como encontrar o List ID */}
      <section className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4">
        <div className="flex gap-3">
          <span className="text-lg">💡</span>
          <div>
            <h3 className="text-indigo-300 font-semibold text-sm mb-1">Como encontrar o List ID</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              No ClickUp, abra a lista desejada → clique nos 3 pontos (⋯) ao lado do nome → "Copiar link" → o número no final da URL é o List ID.
              <br /><br />
              Ex: <span className="font-mono text-slate-300">https://app.clickup.com/12345/v/l/<strong>901234567890</strong></span>
            </p>
          </div>
        </div>
      </section>

      {/* Escopo */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3">📋 O que é sincronizado</h3>
        <div className="space-y-2">
          <div className="flex items-start gap-3 text-sm">
            <span className="text-green-400 text-base mt-0.5">✅</span>
            <div>
              <div className="text-slate-300">Oportunidades (pipeline CRM)</div>
              <div className="text-slate-500 text-xs">Criadas automaticamente ao mover para OPORTUNIDADES; atualizadas ao mudar etapa/prioridade.</div>
            </div>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <span className="text-green-400 text-base mt-0.5">✅</span>
            <div>
              <div className="text-slate-300">Chamados (helpdesk)</div>
              <div className="text-slate-500 text-xs">Criados automaticamente no ClickUp ao abrir; status atualizado em tempo real.</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600 text-base">❌</span>
            <span className="text-slate-500">Prospecção e Leads (não sincronizados)</span>
          </div>
        </div>
        <p className="text-slate-600 text-xs mt-3">
          Sincronização automática ativada quando o API Token e os List IDs estão configurados. O ID da tarefa ClickUp também pode ser vinculado manualmente em cada oportunidade ou chamado.
        </p>
      </section>
    </div>
  );
}
