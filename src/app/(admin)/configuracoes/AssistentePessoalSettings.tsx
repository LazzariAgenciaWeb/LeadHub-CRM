"use client";

import { useState } from "react";

/**
 * Meu Perfil → Assistente pessoal:
 *  1. Vincular grupo do WhatsApp (pareamento por código)
 *  2. Token pessoal pra conectar o Claude via MCP
 */
export default function AssistentePessoalSettings({
  initialLinked,
  assistantInstance,
  instances,
  hasMcpToken,
  mcpTokenCreatedAt,
}: {
  initialLinked: boolean;
  assistantInstance: { label: string | null; instanceName: string; phone: string | null } | null;
  instances: { id: string; label: string | null; instanceName: string; phone: string | null; status: string; acceptGroups: boolean }[];
  hasMcpToken: boolean;
  mcpTokenCreatedAt: string | null;
}) {
  const [linked, setLinked] = useState(initialLinked);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [tokenState, setTokenState] = useState<{ has: boolean; createdAt: string | null }>({ has: hasMcpToken, createdAt: mcpTokenCreatedAt });
  const [freshToken, setFreshToken] = useState<{ token: string; mcpUrl: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const noGroupInstances = instances.filter((i) => !i.acceptGroups);

  async function gerarCodigo() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/assistente/pareamento", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Erro ${res.status}`);
      setCode(await res.json());
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function verificar() {
    const res = await fetch("/api/assistente/pareamento");
    if (res.ok) { const j = await res.json(); if (j.linked) { setLinked(true); setCode(null); } else setErr("Ainda não vinculado. Mandou o código no grupo?"); }
  }
  async function desvincular() {
    if (!confirm("Desvincular o grupo do assistente?")) return;
    setBusy(true);
    await fetch("/api/assistente/pareamento", { method: "DELETE" });
    setLinked(false); setBusy(false);
  }
  async function gerarToken() {
    if (tokenState.has && !confirm("Gerar um novo token invalida o anterior. Continuar?")) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/assistente/mcp-token", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Erro ${res.status}`);
      const j = await res.json();
      setFreshToken(j);
      setTokenState({ has: true, createdAt: new Date().toISOString() });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function revogarToken() {
    if (!confirm("Revogar o token? O Claude vai perder acesso ao GoHub.")) return;
    setBusy(true);
    await fetch("/api/assistente/mcp-token", { method: "DELETE" });
    setTokenState({ has: false, createdAt: null }); setFreshToken(null); setBusy(false);
  }
  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); });
  }

  const claudeCmd = freshToken
    ? `claude mcp add --transport http gohub ${freshToken.mcpUrl} --header "Authorization: Bearer ${freshToken.token}"`
    : null;
  const inboxUrl = freshToken ? freshToken.mcpUrl.replace(/\/api\/mcp$/, "/api/assistente/inbox") : null;
  const claudeAiUrl = freshToken ? freshToken.mcpUrl : null;
  const curlCmd = freshToken && inboxUrl
    ? `curl -X POST ${inboxUrl} -H "Authorization: Bearer ${freshToken.token}" -H "Content-Type: application/json" -d '{"title":"Reels novo pra gravar: 3 erros no tráfego","body":"Roteiro no ClickUp","tags":["reels"],"link":"https://app.clickup.com/t/xxxx","source":"rotina-reels"}'`
    : null;

  return (
    <>
      {/* ── WhatsApp ── */}
      <section className="bg-[#0f1623] border border-fuchsia-500/20 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🤖 Assistente pessoal no WhatsApp</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Crie um grupo no WhatsApp só com você (no número de uma instância conectada), gere o código e mande ele no grupo.
            A partir daí, tudo que você mandar ali — texto ou áudio — vira tarefa, lembrete, chamado, anotação ou consulta.
          </p>
        </div>
        <div className="p-5 space-y-4">
          {linked ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <div>
                <div className="text-emerald-300 text-xs font-semibold">✅ Grupo vinculado</div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Instância: {assistantInstance?.label ?? assistantInstance?.instanceName ?? "—"}{assistantInstance?.phone ? ` · ${assistantInstance.phone}` : ""}
                </div>
              </div>
              <button onClick={desvincular} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-red-300 hover:border-red-500/40 disabled:opacity-40">Desvincular</button>
            </div>
          ) : (
            <>
              <ol className="text-slate-300 text-xs space-y-1.5 list-decimal list-inside">
                <li>No WhatsApp do número da instância, crie um grupo só com você (ex.: "Assistente GoHub").</li>
                <li>Clique em <b>Gerar código</b> abaixo.</li>
                <li>Mande o código como mensagem no grupo. O assistente responde confirmando.</li>
              </ol>
              {noGroupInstances.length > 0 && (
                <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  ⚠️ Instância(s) com grupos desligados: {noGroupInstances.map((i) => i.label ?? i.instanceName).join(", ")}. Pra parear, ligue "Grupos ON" em Configurações → Instâncias (senão o código nem chega). Depois de vinculado pode desligar de novo: só o grupo do assistente continua chegando, os outros grupos ficam fora da inbox.
                </div>
              )}
              {code ? (
                <div className="px-4 py-3 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 space-y-2">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold">Mande esta mensagem no grupo (vale 15 min)</div>
                  <div className="flex items-center gap-2">
                    <code className="text-white text-lg font-mono tracking-widest">{code.code}</code>
                    <button onClick={() => copy(code.code, "code")} className="text-xs px-2 py-1 rounded bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">{copied === "code" ? "Copiado!" : "Copiar"}</button>
                  </div>
                  <button onClick={verificar} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white">Já mandei — verificar</button>
                </div>
              ) : (
                <button onClick={gerarCodigo} disabled={busy} className="px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-sm font-medium disabled:opacity-40">
                  {busy ? "Gerando..." : "Gerar código"}
                </button>
              )}
            </>
          )}
          {err && <div className="text-xs px-3 py-2 rounded-lg border text-red-400 bg-red-500/10 border-red-500/20">❌ {err}</div>}
        </div>
      </section>

      {/* ── MCP / Claude ── */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">🔌 Conectar o Claude (MCP)</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Com o token, o Claude (Claude Code ou claude.ai) consegue criar tarefas, chamados, anotações e consultar clientes direto no GoHub, em seu nome. O token aparece uma única vez.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              {tokenState.has ? <>Token ativo{tokenState.createdAt ? ` desde ${new Date(tokenState.createdAt).toLocaleDateString("pt-BR")}` : ""}</> : "Nenhum token gerado."}
            </div>
            <div className="flex gap-2">
              <button onClick={gerarToken} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40">{tokenState.has ? "Gerar novo" : "Gerar token"}</button>
              {tokenState.has && <button onClick={revogarToken} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-red-300 hover:border-red-500/40 disabled:opacity-40">Revogar</button>}
            </div>
          </div>
          {freshToken && claudeCmd && (
            <div className="space-y-3">
              <div className="px-3 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200">
                Guarde agora — não será mostrado de novo.
              </div>
              <div>
                <div className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold mb-1">Token</div>
                <div className="flex gap-2">
                  <code className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white font-mono break-all">{freshToken.token}</code>
                  <button onClick={() => copy(freshToken.token, "tok")} className="text-xs px-2 rounded bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">{copied === "tok" ? "Copiado!" : "Copiar"}</button>
                </div>
              </div>
              {claudeAiUrl && (
                <div>
                  <div className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold mb-1">claude.ai (site/app) — tarefas agendadas e chats</div>
                  <div className="flex gap-2">
                    <code className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-[11px] text-slate-200 font-mono break-all">{claudeAiUrl}</code>
                    <button onClick={() => copy(claudeAiUrl, "ai")} className="text-xs px-2 rounded bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">{copied === "ai" ? "Copiado!" : "Copiar"}</button>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    No claude.ai: Configurações → Conectores → <b>Adicionar conector personalizado</b> → nome "GoHub", cole esta URL e deixe OAuth Client ID/Secret em branco. Ao conectar, o claude.ai abre o GoHub e você clica em <b>Autorizar</b> (sem copiar token). Depois ative o conector "GoHub" nas suas tarefas agendadas.
                  </div>
                </div>
              )}
              <div>
                <div className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold mb-1">Claude Code (terminal)</div>
                <div className="flex gap-2">
                  <code className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-[11px] text-slate-200 font-mono break-all">{claudeCmd}</code>
                  <button onClick={() => copy(claudeCmd, "cmd")} className="text-xs px-2 rounded bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">{copied === "cmd" ? "Copiado!" : "Copiar"}</button>
                </div>
              </div>
              <div className="text-[11px] text-slate-500">
                URL do servidor: <code className="text-slate-400">{freshToken.mcpUrl}</code> · transporte HTTP · header <code className="text-slate-400">Authorization: Bearer &lt;token&gt;</code>.
              </div>
              {curlCmd && (
                <div>
                  <div className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold mb-1">Rotinas externas → bloquinho + WhatsApp (webhook)</div>
                  <div className="flex gap-2">
                    <code className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-[11px] text-slate-200 font-mono break-all">{curlCmd}</code>
                    <button onClick={() => copy(curlCmd, "curl")} className="text-xs px-2 rounded bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">{copied === "curl" ? "Copiado!" : "Copiar"}</button>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Qualquer rotina (Claude agendado, n8n, cron) faz um POST em <code className="text-slate-400">{inboxUrl}</code> com <code className="text-slate-400">title</code>, <code className="text-slate-400">body</code>, <code className="text-slate-400">tags</code>, <code className="text-slate-400">link</code>, <code className="text-slate-400">kind</code> (NOTE/TASK/REMINDER/IDEA), <code className="text-slate-400">dueAt</code>. Vira item no bloquinho e mensagem no seu grupo. <code className="text-slate-400">onlyNotify: true</code> só avisa, sem guardar.
                  </div>
                </div>
              )}
            </div>
          )}
          {!freshToken && tokenState.has && (
            <div className="text-[11px] text-slate-500 space-y-1">
              <div>Com o token você conecta o Claude (MCP) e também recebe avisos de rotinas externas:</div>
              <div>• MCP: <code className="text-slate-400">POST /api/mcp</code> (header Bearer, Claude Code) ou <code className="text-slate-400">/api/mcp/t/&lt;token&gt;</code> (claude.ai, sem auth) — ferramentas do assistente, incl. <code className="text-slate-400">avisar_no_whatsapp</code>.</div>
              <div>• Webhook: <code className="text-slate-400">POST /api/assistente/inbox</code> — <code className="text-slate-400">{"{ title, body?, tags?, link?, kind?, dueAt? }"}</code> → bloquinho + WhatsApp.</div>
              <div>Perdeu o token? Gere um novo (o antigo deixa de valer).</div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
