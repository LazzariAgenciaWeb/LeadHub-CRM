"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  companyId:              string;
  apiToken:               string;
  webhookSecret:          string;
  opListId:               string;
  ticketListId:           string;
  statusGanho:            string;
  statusPerdido:          string;
  statusChamadoConcluido: string;
}

interface CUList {
  id:   string;
  name: string;
  path: string; // "Space > [Folder >] List"
}

async function cuFetch(token: string, path: string) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`ClickUp ${res.status}`);
  return res.json();
}

async function fetchAllLists(token: string): Promise<CUList[]> {
  const { teams } = await cuFetch(token, "/team");
  const lists: CUList[] = [];

  for (const team of teams ?? []) {
    const { spaces } = await cuFetch(token, `/team/${team.id}/space?archived=false`);
    for (const space of spaces ?? []) {
      // Listas sem pasta
      const { lists: fl } = await cuFetch(token, `/space/${space.id}/list?archived=false`);
      for (const l of fl ?? []) {
        lists.push({ id: l.id, name: l.name, path: `${space.name} › ${l.name}` });
      }
      // Pastas
      const { folders } = await cuFetch(token, `/space/${space.id}/folder?archived=false`);
      for (const folder of folders ?? []) {
        const { lists: fl2 } = await cuFetch(token, `/folder/${folder.id}/list?archived=false`);
        for (const l of fl2 ?? []) {
          lists.push({ id: l.id, name: l.name, path: `${space.name} › ${folder.name} › ${l.name}` });
        }
      }
    }
  }
  return lists;
}

async function fetchListStatuses(token: string, listId: string): Promise<string[]> {
  const data = await cuFetch(token, `/list/${listId}`);
  return (data.statuses ?? []).map((s: any) => s.status as string);
}

export default function ClickupSettings({
  companyId,
  apiToken: initialToken,
  webhookSecret: initialSecret,
  opListId: initialOp,
  ticketListId: initialTk,
  statusGanho: initialGanho,
  statusPerdido: initialPerdido,
  statusChamadoConcluido: initialConcluido,
}: Props) {
  const router = useRouter();

  const [apiToken, setApiToken]         = useState(initialToken);
  const [webhookSecret, setWebhookSecret] = useState(initialSecret);
  const [opListId, setOpListId]         = useState(initialOp);
  const [ticketListId, setTicketListId] = useState(initialTk);
  const [statusGanho, setStatusGanho]   = useState(initialGanho);
  const [statusPerdido, setStatusPerdido] = useState(initialPerdido);
  const [statusChamadoConcluido, setStatusChamadoConcluido] = useState(initialConcluido);

  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);
  const [copiedUrl, setCopiedUrl]   = useState(false);

  // ClickUp discovery
  const [lists, setLists]               = useState<CUList[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [listsError, setListsError]     = useState<string | null>(null);
  const [opStatuses, setOpStatuses]     = useState<string[]>([]);
  const [loadingOpSt, setLoadingOpSt]   = useState(false);
  const [ticketStatuses, setTicketStatuses] = useState<string[]>([]);
  const [loadingTicketSt, setLoadingTicketSt] = useState(false);

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhook/clickup/${companyId}`
    : "";

  const tokenKey            = `clickup_api_token:${companyId}`;
  const secretKey           = `clickup_webhook_secret:${companyId}`;
  const opKey               = `clickup_oportunidades_list_id:${companyId}`;
  const ticketKey           = `clickup_tickets_list_id:${companyId}`;
  const statusGanhoKey      = `clickup_status_ganho:${companyId}`;
  const statusPerdidoKey    = `clickup_status_perdido:${companyId}`;
  const statusConcluidoKey  = `clickup_status_chamado_concluido:${companyId}`;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    await fetch("/api/settings", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { key: tokenKey,            value: apiToken },
        { key: secretKey,           value: webhookSecret },
        { key: opKey,               value: opListId },
        { key: ticketKey,           value: ticketListId },
        { key: statusGanhoKey,      value: statusGanho.trim()   || "ganho" },
        { key: statusPerdidoKey,    value: statusPerdido.trim() || "perdido" },
        { key: statusConcluidoKey,  value: statusChamadoConcluido.trim() },
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

  async function handleLoadLists() {
    if (!apiToken.trim()) return;
    setLoadingLists(true);
    setListsError(null);
    setOpStatuses([]);
    setTicketStatuses([]);
    try {
      const all = await fetchAllLists(apiToken);
      setLists(all);

      // Se já tem listas selecionadas, carrega os status delas
      if (opListId) {
        const found = all.find(l => l.id === opListId);
        if (found) loadOpStatuses(opListId);
      }
      if (ticketListId) {
        const found = all.find(l => l.id === ticketListId);
        if (found) loadTicketStatuses(ticketListId);
      }
    } catch (err: any) {
      setListsError(err.message ?? "Erro ao carregar listas");
    }
    setLoadingLists(false);
  }

  async function loadOpStatuses(listId: string) {
    if (!listId || !apiToken.trim()) return;
    setLoadingOpSt(true);
    try {
      const statuses = await fetchListStatuses(apiToken, listId);
      setOpStatuses(statuses);
      // Se o status atual não está na lista, não força mudança
    } catch {
      setOpStatuses([]);
    }
    setLoadingOpSt(false);
  }

  async function loadTicketStatuses(listId: string) {
    if (!listId || !apiToken.trim()) return;
    setLoadingTicketSt(true);
    try {
      const statuses = await fetchListStatuses(apiToken, listId);
      setTicketStatuses(statuses);
    } catch {
      setTicketStatuses([]);
    }
    setLoadingTicketSt(false);
  }

  function handleOpListChange(listId: string) {
    setOpListId(listId);
    setOpStatuses([]);
    setStatusGanho("");
    setStatusPerdido("");
    if (listId) loadOpStatuses(listId);
  }

  function handleTicketListChange(listId: string) {
    setTicketListId(listId);
    setTicketStatuses([]);
    setStatusChamadoConcluido("");
    if (listId) loadTicketStatuses(listId);
  }

  const listsLoaded = lists.length > 0;

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

      {/* API Token */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🔑 API Token</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Encontre em: ClickUp → Configurações → Apps → API Token.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">
            <input
              type="password"
              value={apiToken}
              onChange={(e) => { setApiToken(e.target.value); setTestResult(null); setLists([]); setOpStatuses([]); }}
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
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
              testResult.ok
                ? "text-green-400 bg-green-500/10 border-green-500/20"
                : "text-red-400 bg-red-500/10 border-red-500/20"
            }`}>
              {testResult.ok ? `✅ Conectado como @${testResult.user}` : `❌ ${testResult.error}`}
            </div>
          )}
        </div>
      </section>

      {/* Webhook */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🔄 Webhook (ClickUp → LeadHub)</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Sincroniza comentários adicionados no ClickUp de volta para o chamado correspondente.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">URL do webhook</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={webhookUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(webhookUrl); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000); } catch { /* manual */ }
                }}
                className="px-4 py-2.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-sm font-medium hover:bg-[#1e2d45] transition-colors whitespace-nowrap"
              >
                {copiedUrl ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
            <p className="text-slate-600 text-[10px] mt-1">ClickUp → Settings → Integrations → Webhooks → Create Webhook.</p>
          </div>
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Webhook Secret</label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="••••••••••••••••••••••••••••••"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
          <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-3 py-2.5">
            <p className="text-indigo-300 text-[11px] font-semibold mb-1">Eventos a marcar no ClickUp:</p>
            <ul className="text-slate-400 text-[11px] leading-relaxed list-disc list-inside">
              <li><code className="text-slate-300">taskCommentPosted</code> — comentário no ClickUp vira mensagem no chamado</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Listas + Status — com discovery */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45] flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-sm">📋 Listas e Status</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              Carregue as listas diretamente da sua conta ClickUp para evitar erros de digitação.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLoadLists}
            disabled={loadingLists || !apiToken.trim()}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2"
          >
            {loadingLists ? (
              <><span className="animate-spin">⟳</span> Carregando...</>
            ) : (
              <>{listsLoaded ? "↺ Recarregar" : "⬇ Carregar listas"}</>
            )}
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-6">
          {listsError && (
            <div className="text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-xs">
              ❌ {listsError} — verifique o token e tente novamente.
            </div>
          )}

          {/* Lista de Oportunidades */}
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              Lista — Oportunidades
            </label>
            {listsLoaded ? (
              <select
                value={opListId}
                onChange={(e) => handleOpListChange(e.target.value)}
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">— Selecione uma lista —</option>
                {lists.map(l => (
                  <option key={l.id} value={l.id}>{l.path}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={opListId}
                onChange={(e) => setOpListId(e.target.value)}
                placeholder="Clique em 'Carregar listas' ou cole o ID manualmente"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
            )}
            <p className="text-slate-600 text-[10px] mt-1">Novas oportunidades viram tarefas nesta lista.</p>
          </div>

          {/* Lista de Chamados */}
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              Lista — Chamados
            </label>
            {listsLoaded ? (
              <select
                value={ticketListId}
                onChange={(e) => handleTicketListChange(e.target.value)}
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">— Selecione uma lista —</option>
                {lists.map(l => (
                  <option key={l.id} value={l.id}>{l.path}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={ticketListId}
                onChange={(e) => setTicketListId(e.target.value)}
                placeholder="Clique em 'Carregar listas' ou cole o ID manualmente"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
            )}
            <p className="text-slate-600 text-[10px] mt-1">Novos chamados viram tarefas nesta lista.</p>
          </div>

          {/* Status de Chamados */}
          <div className="border-t border-[#1e2d45] pt-5">
            <h3 className="text-slate-300 font-semibold text-sm mb-1">🏷️ Status de Chamados</h3>
            <p className="text-slate-500 text-xs mb-4">
              {ticketStatuses.length > 0
                ? "Selecione o status do ClickUp para marcar a tarefa como concluída quando o chamado for resolvido/fechado no LeadHub."
                : ticketListId
                  ? "Selecione a lista de Chamados acima para carregar os status disponíveis."
                  : "Status disponíveis após selecionar a lista de Chamados."}
            </p>
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                ✅ Quando <span className="text-green-400">Resolvido / Fechado</span>
              </label>
              {ticketStatuses.length > 0 ? (
                <select
                  value={statusChamadoConcluido}
                  onChange={(e) => setStatusChamadoConcluido(e.target.value)}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— Não alterar status no ClickUp —</option>
                  {ticketStatuses.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={statusChamadoConcluido}
                  onChange={(e) => setStatusChamadoConcluido(e.target.value)}
                  placeholder={loadingTicketSt ? "Carregando..." : "ex: complete, concluído, done"}
                  disabled={loadingTicketSt}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono disabled:opacity-50"
                />
              )}
              <p className="text-slate-600 text-[10px] mt-1">
                Em branco = não força mudança de status (mantém o que está no ClickUp).
              </p>
            </div>
          </div>

          {/* Status de Oportunidades */}
          <div className="border-t border-[#1e2d45] pt-5">
            <h3 className="text-slate-300 font-semibold text-sm mb-1">🏷️ Status de Oportunidades</h3>
            <p className="text-slate-500 text-xs mb-4">
              {opStatuses.length > 0
                ? "Selecione o status ClickUp correspondente a cada resultado."
                : opListId
                  ? "Selecione a lista de Oportunidades acima para carregar os status disponíveis."
                  : "Status disponíveis após selecionar a lista de Oportunidades."}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  ✅ Quando <span className="text-green-400">Ganho</span>
                </label>
                {opStatuses.length > 0 ? (
                  <select
                    value={statusGanho}
                    onChange={(e) => setStatusGanho(e.target.value)}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">— Selecione —</option>
                    {opStatuses.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={statusGanho}
                    onChange={(e) => setStatusGanho(e.target.value)}
                    placeholder={loadingOpSt ? "Carregando..." : "ganho"}
                    disabled={loadingOpSt}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono disabled:opacity-50"
                  />
                )}
              </div>
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  ❌ Quando <span className="text-red-400">Perdido</span>
                </label>
                {opStatuses.length > 0 ? (
                  <select
                    value={statusPerdido}
                    onChange={(e) => setStatusPerdido(e.target.value)}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">— Selecione —</option>
                    {opStatuses.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={statusPerdido}
                    onChange={(e) => setStatusPerdido(e.target.value)}
                    placeholder={loadingOpSt ? "Carregando..." : "perdido"}
                    disabled={loadingOpSt}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono disabled:opacity-50"
                  />
                )}
              </div>
            </div>
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
            <h3 className="text-indigo-300 font-semibold text-sm mb-1">Como usar</h3>
            <ol className="text-slate-400 text-xs leading-relaxed list-decimal list-inside space-y-1">
              <li>Cole o token da API e clique em <strong className="text-slate-300">Testar</strong></li>
              <li>Clique em <strong className="text-slate-300">Carregar listas</strong> para buscar direto do ClickUp</li>
              <li>Selecione a lista de Oportunidades — os status carregam automaticamente</li>
              <li>Escolha qual status = Ganho e qual = Perdido</li>
              <li>Selecione a lista de Chamados e clique em <strong className="text-slate-300">Salvar</strong></li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
