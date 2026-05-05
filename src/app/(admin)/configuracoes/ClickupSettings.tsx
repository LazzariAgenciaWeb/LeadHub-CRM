"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Página pai (configuracoes/page.tsx) só renderiza este componente quando
// existe companyId E moduleClickup=true. Aqui já podemos assumir per-empresa.
interface Props {
  companyId:     string;
  apiToken:      string;
  webhookSecret: string;
  opListId:      string;
  ticketListId:  string;
}

export default function ClickupSettings({
  companyId,
  apiToken: initialToken,
  webhookSecret: initialSecret,
  opListId: initialOp,
  ticketListId: initialTk,
}: Props) {
  const router = useRouter();

  const [apiToken, setApiToken] = useState(initialToken);
  const [webhookSecret, setWebhookSecret] = useState(initialSecret);
  const [opListId, setOpListId] = useState(initialOp);
  const [ticketListId, setTicketListId] = useState(initialTk);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Cada empresa tem URL de webhook única (companyId no path) — o handler
  // valida o HMAC com o secret daquela empresa.
  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhook/clickup/${companyId}`
    : "";

  const tokenKey  = `clickup_api_token:${companyId}`;
  const secretKey = `clickup_webhook_secret:${companyId}`;
  const opKey     = `clickup_oportunidades_list_id:${companyId}`;
  const ticketKey = `clickup_tickets_list_id:${companyId}`;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);

    const items: { key: string; value: string }[] = [
      { key: tokenKey,  value: apiToken },
      { key: secretKey, value: webhookSecret },
      { key: opKey,     value: opListId },
      { key: ticketKey, value: ticketListId },
    ];

    await fetch("/api/settings", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(items),
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
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-[#7B68EE]/20 flex items-center justify-center text-xl">✅</div>
        <div>
          <h1 className="text-white font-bold text-base">ClickUp</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Conecte a conta ClickUp desta empresa para sincronizar Oportunidades e Chamados.
          </p>
        </div>
      </div>

      {/* API Token da empresa */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🔑 API Token</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Encontre em: ClickUp → Configurações → Apps → API Token. Cada empresa-cliente usa o token da própria conta.
          </p>
        </div>
        <div className="p-5">
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
      </section>

      {/* Webhook bidirecional */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🔄 Webhook (ClickUp → LeadHub)</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Sincroniza comentários adicionados no ClickUp de volta para o chamado correspondente.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              URL do webhook (cole no ClickUp)
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={webhookUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(webhookUrl);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 2000);
                  } catch { /* clipboard bloqueado — copia manual */ }
                }}
                className="px-4 py-2.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-sm font-medium hover:bg-[#1e2d45] transition-colors whitespace-nowrap"
              >
                {copiedUrl ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
            <p className="text-slate-600 text-[10px] mt-1">
              No ClickUp: Settings → Integrations → Webhooks → Create Webhook → cola essa URL.
            </p>
          </div>

          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              Webhook Secret (vem do ClickUp ao criar)
            </label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="••••••••••••••••••••••••••••••"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-slate-600 text-[10px] mt-1">
              Após criar o webhook no ClickUp, copie o "Secret" exibido e cole aqui. Sem ele os eventos são rejeitados (assinatura inválida).
            </p>
          </div>

          <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-3 py-2.5">
            <p className="text-indigo-300 text-[11px] font-semibold mb-1">Eventos a marcar no ClickUp:</p>
            <ul className="text-slate-400 text-[11px] leading-relaxed list-disc list-inside">
              <li><code className="text-slate-300">taskCommentPosted</code> — comentário no ClickUp vira mensagem no chamado</li>
            </ul>
          </div>
        </div>
      </section>

      {/* List IDs */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">📋 Listas do ClickUp</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Listas onde Oportunidades e Chamados desta empresa viram tarefas.
          </p>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-5">
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
              Lista onde novas oportunidades viram tarefas.
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
              Lista onde novos chamados viram tarefas.
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
    </div>
  );
}
