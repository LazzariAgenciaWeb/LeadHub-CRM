"use client";

import { useEffect, useState } from "react";
import { Mail, HardDrive, Loader2, RefreshCw, Plus, KeyRound, Copy, Check, Wand2, Settings2 } from "lucide-react";
import MailClientSetup from "./MailClientSetup";

interface Usage { usedMb: number; limitMb: number | null }
interface Mailbox { email: string; usedMb: number; quotaMb: number | null; suspended: boolean }
interface Overview { usage: Usage; mailboxes: Mailbox[]; domains: string[]; canCreate?: boolean }

const MIN_PASSWORD = 10;

function fmtSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  return `${mb.toLocaleString("pt-BR", { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

/** Senha forte gerada no navegador (nunca passa pelo servidor antes de você salvar). */
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_";
  const buf = new Uint32Array(18);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (!limit) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden" title={`${pct}% usado`}>
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Bloco "E-mails e espaço" dentro do cartão do cPanel. Só carrega quando o
 * usuário pede (cada abertura bate no cPanel do cliente). Senhas digitadas ou
 * geradas aqui vão direto pro cPanel — o GoHub não guarda.
 */
export default function CompanyCpanelEmail({ companyId, portal = false, autoLoad = portal }: {
  companyId?: string;
  /** Meu Espaço do cliente: usa a rota do portal (empresa vem da sessão), já abre carregado. */
  portal?: boolean;
  /** Consulta assim que aparece (portal e painel de Hospedagem). */
  autoLoad?: boolean;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Formulário: criar caixa ("new") ou trocar senha de uma caixa (e-mail dela).
  const [mode, setMode] = useState<"new" | string | null>(null);
  const [local, setLocal] = useState("");
  const [domain, setDomain] = useState("");
  const [quota, setQuota] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Caixa com o painel "configurar no app de e-mail" aberto.
  const [setupFor, setSetupFor] = useState<string | null>(null);

  const url = portal ? "/api/meu-espaco/email" : `/api/companies/${companyId}/cpanel/email`;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) { setError(j.error || "Erro ao consultar o cPanel."); return; }
      setData(j);
      setDomain((d) => d || j.domains?.[0] || "");
    } catch {
      setError("Erro de rede ao consultar o cPanel.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoLoad) return;
    // Fora do corpo do efeito: load() mexe em estado logo de cara.
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  // Na agência sempre pode criar; no portal depende da liberação.
  const canCreate = data ? data.canCreate !== false : false;

  function open(next: "new" | string) {
    setMode(next);
    setLocal("");
    setQuota("");
    setPassword("");
    setCopied(false);
    setError(null);
    setNotice(null);
  }

  function close() {
    setMode(null);
    setPassword(""); // tira a senha da memória da tela
    setCopied(false);
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch { /* sem permissão de área de transferência */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const creating = mode === "new";
      const r = await fetch(url, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creating
          ? { local, domain, password, quotaMb: quota === "" ? 0 : Number(quota) }
          : { email: mode, password }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || "O cPanel recusou a operação."); return; }
      setNotice(creating ? `Caixa ${j.email} criada.` : `Senha de ${j.email} alterada.`);
      close();
      await load();
    } catch {
      setError("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60";
  const labelCls = "block text-[11px] font-semibold text-slate-400 mb-1";
  const smallBtn = "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide disabled:opacity-50 transition-colors";

  return (
    <div className={portal
      ? "bg-white/[0.03] border border-white/10 rounded-2xl p-4 space-y-3"
      : "mt-3 ml-9 bg-black/20 border border-white/5 rounded-lg p-3 space-y-3"}>
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-cyan-300" />
        <h4 className="text-white text-xs font-semibold flex-1">E-mails e espaço</h4>
        {data && canCreate && (
          <button onClick={() => open("new")} className={`${smallBtn} bg-indigo-600 hover:bg-indigo-500 text-white`}>
            <Plus className="w-3 h-3" /> Nova caixa
          </button>
        )}
        <button onClick={load} disabled={loading} className={`${smallBtn} bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300`}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {data ? "Atualizar" : "Consultar"}
        </button>
      </div>

      {!data && !loading && !error && (
        <p className="text-slate-500 text-[11px]">Consulte pra ver o espaço usado da hospedagem, as caixas de e-mail e criar ou trocar senhas.</p>
      )}

      {error && <p className="p-2 rounded-lg border bg-red-500/10 border-red-500/30 text-red-200 text-[11px]">{error}</p>}
      {notice && <p className="p-2 rounded-lg border bg-emerald-500/10 border-emerald-500/30 text-emerald-200 text-[11px]">{notice}</p>}

      {data && (
        <>
          {/* Espaço da conta */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[11px]">
              <HardDrive className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400">Espaço da conta:</span>
              <span className="text-white font-semibold">{fmtSize(data.usage.usedMb)}</span>
              <span className="text-slate-500">
                {data.usage.limitMb ? `de ${fmtSize(data.usage.limitMb)}` : "(sem limite)"}
              </span>
            </div>
            <UsageBar used={data.usage.usedMb} limit={data.usage.limitMb} />
          </div>

          {/* Formulário: nova caixa ou troca de senha */}
          {mode && (
            <form onSubmit={handleSubmit} autoComplete="off" className="border border-indigo-500/30 bg-indigo-500/5 rounded-lg p-3 space-y-3">
              <p className="text-white text-xs font-semibold">
                {mode === "new" ? "Nova caixa de e-mail" : <>Trocar senha de <span className="font-mono">{mode}</span></>}
              </p>
              {mode === "new" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Nome</label>
                    <input required value={local} onChange={(e) => setLocal(e.target.value)} placeholder="contato" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Domínio</label>
                    <select required value={domain} onChange={(e) => setDomain(e.target.value)} className={inputCls}>
                      {data.domains.map((d) => <option key={d} value={d}>@{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Cota em MB (vazio = sem limite)</label>
                    <input type="number" min={0} value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="1024" className={inputCls} />
                  </div>
                </div>
              )}
              <div>
                <label className={labelCls}>Senha</label>
                <div className="flex gap-2">
                  <input
                    required minLength={MIN_PASSWORD} value={password}
                    onChange={(e) => { setPassword(e.target.value); setCopied(false); }}
                    placeholder={`Mínimo ${MIN_PASSWORD} caracteres`}
                    autoComplete="new-password" spellCheck={false}
                    className={`${inputCls} font-mono`}
                  />
                  <button type="button" onClick={() => { setPassword(generatePassword()); setCopied(false); }}
                    className={`${smallBtn} bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10`}>
                    <Wand2 className="w-3 h-3" /> Gerar
                  </button>
                  <button type="button" onClick={copyPassword} disabled={!password}
                    className={`${smallBtn} bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10`}>
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? "Copiada" : "Copiar"}
                  </button>
                </div>
                <p className="text-slate-600 text-[10px] mt-1">Copie antes de salvar: o GoHub não guarda nem mostra essa senha depois.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="submit" disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 flex items-center gap-1.5">
                  {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                  {mode === "new" ? "Criar caixa" : "Trocar senha"}
                </button>
                <button type="button" onClick={close}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10">
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {/* Caixas */}
          {data.mailboxes.length === 0 ? (
            <p className="text-slate-500 text-[11px]">Nenhuma caixa de e-mail nesta conta.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {data.mailboxes.map((m) => (
                <li key={m.email} className="py-2 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-slate-200 text-xs font-mono truncate">
                      {m.email}
                      {m.suspended && <span className="ml-2 text-[10px] text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded-full font-sans font-bold">SUSPENSA</span>}
                    </p>
                    <p className="text-slate-500 text-[10px]">
                      {fmtSize(m.usedMb)} {m.quotaMb ? `de ${fmtSize(m.quotaMb)}` : "· sem limite"}
                    </p>
                    <UsageBar used={m.usedMb} limit={m.quotaMb} />
                  </div>
                  <button onClick={() => setSetupFor(setupFor === m.email ? null : m.email)}
                    className={`${smallBtn} border ${setupFor === m.email ? "bg-cyan-500/20 text-cyan-200 border-cyan-500/30" : "bg-white/5 hover:bg-white/10 text-slate-300 border-white/10"}`}>
                    <Settings2 className="w-3 h-3" /> Configurar
                  </button>
                  <button onClick={() => open(m.email)} className={`${smallBtn} bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10`}>
                    <KeyRound className="w-3 h-3" /> Senha
                  </button>
                </div>
                {setupFor === m.email && (
                  <MailClientSetup baseUrl={url} email={m.email} onClose={() => setSetupFor(null)} />
                )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
