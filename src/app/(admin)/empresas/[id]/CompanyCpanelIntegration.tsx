"use client";

import { useEffect, useState } from "react";
import CompanyCpanelEmail from "./CompanyCpanelEmail";
import CompanyCpanelUpload from "./CompanyCpanelUpload";
import { Server, Check, AlertTriangle, Loader2, Trash2, RefreshCw, Pencil } from "lucide-react";

interface CpanelConfig {
  host: string;
  port: number;
  username: string;
  publishDir: string;
  siteUrl: string | null;
  status: "ACTIVE" | "EXPIRED" | "ERROR" | "DISCONNECTED";
  lastTestedAt: string | null;
  lastError: string | null;
  updatedAt: string;
  updatedByName: string | null;
  clientCanManageEmail: boolean;
  clientCanCreateEmail: boolean;
  clientCanChangeQuota: boolean;
  clientMaxQuotaMb: number | null;
  clientCanUpload: boolean;
}

const EMPTY_FORM = { host: "", port: "2083", username: "", token: "", publishDir: "public_html", siteUrl: "" };

/**
 * Cartão "cPanel (hospedagem)" da aba Hospedagem do cliente.
 *
 * Só ADMIN / SUPER_ADMIN enxergam: a API devolve 403 pros demais e o cartão
 * simplesmente não aparece. O token nunca volta do servidor — depois de salvo,
 * o campo fica vazio e só é preenchido pra trocar.
 */
export default function CompanyCpanelIntegration({ companyId, showDenied = false, clientPortal = false }: {
  companyId: string;
  /** Empresa-cliente: mostra o que o cliente pode fazer no Meu Espaço. */
  clientPortal?: boolean;
  /** Em Configurações a seção é só isto: mostra o aviso em vez de tela vazia. */
  showDenied?: boolean;
}) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [config, setConfig] = useState<CpanelConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/companies/${companyId}/cpanel`);
        if (cancelled) return;
        if (!r.ok) { setAllowed(false); return; }
        const j = await r.json();
        setAllowed(true);
        setConfig(j.config ?? null);
      } catch {
        if (!cancelled) setAllowed(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  function startEdit() {
    setMsg(null);
    setForm(config
      ? { host: config.host, port: String(config.port), username: config.username, token: "", publishDir: config.publishDir, siteUrl: config.siteUrl ?? "" }
      : EMPTY_FORM);
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/cpanel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, port: Number(form.port) }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: j.error || "Erro ao salvar" }); return; }
      setConfig(j.config);
      setEditing(false);
      setForm(EMPTY_FORM); // tira o token da memória da tela
      setMsg(j.test?.ok
        ? { kind: "ok", text: `Salvo. ${j.test.message}` }
        : { kind: "err", text: `Salvo, mas o teste falhou: ${j.test?.message ?? "sem resposta"}` });
    } catch {
      setMsg({ kind: "err", text: "Erro de rede ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/cpanel/test`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: j.error || "Erro ao testar" }); return; }
      setConfig((c) => (c && j.config ? { ...c, ...j.config } : c));
      setMsg({ kind: j.test.ok ? "ok" : "err", text: j.test.message });
    } catch {
      setMsg({ kind: "err", text: "Erro de rede ao testar." });
    } finally {
      setTesting(false);
    }
  }

  async function setClientAccess(patch: {
    clientCanManageEmail?: boolean; clientCanCreateEmail?: boolean;
    clientCanChangeQuota?: boolean; clientMaxQuotaMb?: number | null; clientCanUpload?: boolean;
  }) {
    setMsg(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/cpanel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: j.error || "Erro ao salvar" }); return; }
      setConfig(j.config);
    } catch {
      setMsg({ kind: "err", text: "Erro de rede ao salvar." });
    }
  }

  async function handleRemove() {
    if (!confirm("Remover a integração cPanel deste cliente? O token salvo é apagado do GoHub. (O token continua existindo no cPanel — revogue lá se não for mais usar.)")) return;
    const r = await fetch(`/api/companies/${companyId}/cpanel`, { method: "DELETE" });
    if (!r.ok) { setMsg({ kind: "err", text: "Erro ao remover." }); return; }
    setConfig(null);
    setEditing(false);
    setMsg({ kind: "ok", text: "Integração removida." });
  }

  if (allowed === false && showDenied) {
    return (
      <div className="px-5 pb-5 text-slate-500 text-sm">
        Só administradores da empresa podem ver e configurar o cPanel.
      </div>
    );
  }
  if (!allowed) return null; // carregando ou sem permissão

  const connected = !!config && config.status === "ACTIVE";
  const inputCls = "w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60";
  const labelCls = "block text-[11px] font-semibold text-slate-400 mb-1";

  return (
    <div className="px-5 pb-5">
      <div className="space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-xs font-bold uppercase tracking-wide text-cyan-300">Hospedagem</h3>
          <span className="text-slate-600 text-[11px]">Acesso ao cPanel do cliente pra publicar páginas direto na hospedagem dele.</span>
        </div>

        <div className="rounded-xl border bg-cyan-500/10 border-cyan-500/30 p-4">
          <div className="flex items-start gap-3">
            <Server className="w-6 h-6 text-cyan-300 flex-shrink-0 mt-0.5" strokeWidth={2} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-white font-semibold text-sm">cPanel</h3>
                {connected && (
                  <span className="text-[10px] text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <Check className="w-2.5 h-2.5" /> CONECTADO
                  </span>
                )}
                {config && !connected && (
                  <span className="text-[10px] text-red-300 bg-red-500/15 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> COM ERRO
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Token de API do cPanel. Publicações ficam presas à pasta definida aqui.
              </p>
            </div>
            {!editing && (
              <div className="flex-shrink-0">
                <button
                  onClick={startEdit}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    config
                      ? "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40"
                  }`}
                >
                  {config ? <span className="flex items-center gap-1"><Pencil className="w-3 h-3" /> Editar</span> : "Conectar"}
                </button>
              </div>
            )}
          </div>

          {msg && (
            <div className={`mt-3 ml-9 p-2.5 rounded-lg border text-[11px] ${
              msg.kind === "ok"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                : "bg-red-500/10 border-red-500/30 text-red-200"
            }`}>
              {msg.text}
            </div>
          )}

          {/* Resumo da conexão salva */}
          {config && !editing && (
            <div className="mt-3 ml-9 bg-black/20 border border-white/5 rounded-lg p-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-slate-300 text-xs truncate">
                  <span className="font-mono">{config.username}</span>
                  <span className="text-slate-600"> @ </span>
                  <span className="font-mono">{config.host}:{config.port}</span>
                </p>
                <p className="text-slate-500 text-[11px] mt-0.5 truncate">
                  Pasta: <span className="font-mono text-slate-400">{config.publishDir}</span>
                  {config.siteUrl && <> · Site: <span className="text-slate-400">{config.siteUrl}</span></>}
                </p>
                <p className="text-slate-600 text-[10px] mt-0.5">
                  Token: •••••••• (salvo criptografado)
                  {config.lastTestedAt && <> · Último teste: {new Date(config.lastTestedAt).toLocaleString("pt-BR")}</>}
                  {config.updatedByName && <> · por {config.updatedByName}</>}
                </p>
                {config.lastError && (
                  <p className="text-red-400 text-[10px] mt-0.5" title={config.lastError}>{config.lastError}</p>
                )}
              </div>
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 text-[10px] font-semibold uppercase tracking-wide disabled:opacity-50 transition-colors"
              >
                {testing ? <><Loader2 className="w-3 h-3 animate-spin" /> Testando…</> : <><RefreshCw className="w-3 h-3" /> Testar</>}
              </button>
              <button
                onClick={handleRemove}
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                title="Remover a integração e apagar o token salvo"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* O que o cliente pode fazer no Meu Espaço */}
          {clientPortal && config && !editing && (
            <div className="mt-3 ml-9 bg-black/20 border border-white/5 rounded-lg p-2.5 space-y-1.5">
              <p className="text-white text-xs font-semibold">No Meu Espaço do cliente</p>
              <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                <input type="checkbox" checked={config.clientCanManageEmail}
                  onChange={(e) => setClientAccess({ clientCanManageEmail: e.target.checked })} />
                Ver o espaço e os e-mails, e trocar a senha das caixas
              </label>
              <label className={`flex items-center gap-2 text-[11px] cursor-pointer ${config.clientCanManageEmail ? "text-slate-300" : "text-slate-600"}`}>
                <input type="checkbox" checked={config.clientCanCreateEmail} disabled={!config.clientCanManageEmail}
                  onChange={(e) => setClientAccess({ clientCanCreateEmail: e.target.checked })} />
                Criar caixas de e-mail novas (até o limite do plano no cPanel)
              </label>
              <label className={`flex items-center gap-2 text-[11px] cursor-pointer flex-wrap ${config.clientCanManageEmail ? "text-slate-300" : "text-slate-600"}`}>
                <input type="checkbox" checked={config.clientCanChangeQuota} disabled={!config.clientCanManageEmail}
                  onChange={(e) => setClientAccess({ clientCanChangeQuota: e.target.checked })} />
                Mudar a cota das caixas
                {config.clientCanChangeQuota && (
                  <span className="flex items-center gap-1 text-slate-400">
                    · até
                    <input
                      key={config.clientMaxQuotaMb ?? "none"}
                      type="number" min={1} placeholder="sem teto"
                      defaultValue={config.clientMaxQuotaMb ? Math.round(config.clientMaxQuotaMb / 1024 * 10) / 10 : ""}
                      step={0.5}
                      onBlur={(e) => {
                        const gb = e.target.value === "" ? null : Number(e.target.value);
                        const mb = gb && gb > 0 ? Math.round(gb * 1024) : null;
                        if (mb !== config.clientMaxQuotaMb) setClientAccess({ clientMaxQuotaMb: mb });
                      }}
                      className="w-16 bg-[#0a1220] border border-[#1e2d45] rounded px-1.5 py-0.5 text-[11px] text-white"
                    />
                    GB por caixa
                  </span>
                )}
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                <input type="checkbox" checked={config.clientCanUpload}
                  onChange={(e) => setClientAccess({ clientCanUpload: e.target.checked })} />
                Enviar arquivos pro site (fica preso à pasta de publicação)
              </label>
              <p className="text-slate-600 text-[10px]">
                Vale pra todo usuário do cliente que entra no portal. Cada troca de senha, cota, criação e envio fica registrada.
                O cliente nunca passa do espaço livre da conta.
              </p>
            </div>
          )}

          {/* E-mails e espaço — só com a conexão funcionando */}
          {connected && !editing && config && <CompanyCpanelUpload companyId={companyId} publishDir={config.publishDir} />}
          {connected && !editing && <CompanyCpanelEmail companyId={companyId} />}

          {/* Formulário */}
          {editing && (
            <form onSubmit={handleSave} className="mt-4 ml-9 space-y-3" autoComplete="off">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Endereço do cPanel</label>
                  <input
                    required value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="cliente.com.br ou srv12.hospedagem.com"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Porta</label>
                  <select value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} className={inputCls}>
                    <option value="2083">2083 (padrão)</option>
                    <option value="443">443 (cpanel.dominio)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Usuário do cPanel</label>
                  <input
                    required value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="usuario"
                    autoComplete="off"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Token de API</label>
                  <input
                    type="password"
                    required={!config}
                    value={form.token}
                    onChange={(e) => setForm({ ...form, token: e.target.value })}
                    placeholder={config ? "Deixe vazio pra manter o atual" : "Cole o token gerado no cPanel"}
                    autoComplete="new-password"
                    className={`${inputCls} font-mono`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Pasta de publicação</label>
                  <input
                    required value={form.publishDir}
                    onChange={(e) => setForm({ ...form, publishDir: e.target.value })}
                    placeholder="public_html"
                    className={`${inputCls} font-mono`}
                  />
                  <p className="text-slate-600 text-[10px] mt-1">Nada é publicado fora dela. Ex: public_html ou public_html/lp</p>
                </div>
                <div>
                  <label className={labelCls}>URL do site nessa pasta (opcional)</label>
                  <input
                    value={form.siteUrl}
                    onChange={(e) => setForm({ ...form, siteUrl: e.target.value })}
                    placeholder="https://cliente.com.br"
                    className={inputCls}
                  />
                  <p className="text-slate-600 text-[10px] mt-1">Usada pra montar o link do que for publicado.</p>
                </div>
              </div>

              <div className="text-[11px] text-slate-500 bg-black/20 border border-white/5 rounded-lg p-2.5 space-y-0.5">
                <p className="text-slate-400 font-semibold">Como gerar o token</p>
                <p>No cPanel do cliente: <strong className="text-slate-300">Segurança → Manage API Tokens → Create</strong>. Dê um nome (ex: “GoHub”) e copie o token — ele só aparece uma vez.</p>
                <p>⚠️ Esse token dá acesso à conta inteira da hospedagem. Se a integração for removida, revogue o token também no cPanel.</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit" disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 flex items-center gap-1.5"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  {saving ? "Salvando e testando…" : "Salvar e testar"}
                </button>
                <button
                  type="button" onClick={() => { setEditing(false); setForm(EMPTY_FORM); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-[11px] text-slate-600">
          🔒 Token gravado criptografado (AES-256-GCM), nunca exibido de volta. Só administradores veem e alteram esta integração.
        </p>
      </div>
    </div>
  );
}
