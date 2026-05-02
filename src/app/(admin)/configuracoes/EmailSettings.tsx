"use client";

import { useEffect, useState } from "react";
import { Mail, CheckCircle2, AlertCircle, Send, Eye, EyeOff } from "lucide-react";

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean;
  configured: boolean;
}

export default function EmailSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; sentTo?: string; error?: string; step?: string } | null>(null);

  // Form state
  const [host, setHost]     = useState("");
  const [port, setPort]     = useState("465");
  const [secure, setSecure] = useState(true);
  const [user, setUser]     = useState("");
  const [from, setFrom]     = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

  // Load current
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/email")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: EmailConfig | null) => {
        if (cancelled || !data) return;
        setHost(data.host || "");
        setPort(String(data.port || 465));
        setSecure(data.secure ?? true);
        setUser(data.user || "");
        setFrom(data.from || "");
        setHasPassword(!!data.hasPassword);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    try {
      const body: any = { host, port: parseInt(port, 10), secure, user, from };
      if (password) body.password = password;
      const r = await fetch("/api/settings/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setSaved(true);
        if (password) {
          setHasPassword(true);
          setPassword("");
        }
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/settings/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message ?? "Erro" });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-slate-500 text-sm">Carregando...</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
          <Mail className="w-4 h-4 text-blue-400" strokeWidth={2.25} />
        </div>
        <h1 className="text-white font-bold text-lg">E-mail (SMTP)</h1>
      </div>
      <p className="text-slate-500 text-sm mb-5">
        Servidor de e-mail para envio de códigos de verificação do cofre e
        outras notificações automáticas do sistema.
      </p>

      <form onSubmit={handleSave} className="space-y-4 bg-[#0f1623] border border-[#1e2d45] rounded-2xl p-5">
        {/* Servidor */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Servidor (host)
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="mail.azzagencia.com.br"
              required
              className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Porta
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="465"
              required
              className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Secure (SSL) */}
        <label className="flex items-start gap-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={secure}
            onChange={(e) => setSecure(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-[#1e2d45] bg-[#080b12] text-indigo-500 focus:ring-indigo-500/30"
          />
          <span className="text-sm">
            <span className="text-white font-medium block">Usar SSL/TLS</span>
            <span className="text-slate-500 text-[12px]">
              Marque para porta 465 (SSL direto). Desmarque para porta 587 (STARTTLS).
            </span>
          </span>
        </label>

        {/* Usuário */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Usuário (e-mail)
          </label>
          <input
            type="email"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="noreply@azzagencia.com.br"
            required
            className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Senha */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Senha {hasPassword && <span className="text-emerald-400 normal-case font-normal">· senha cadastrada (deixe em branco pra manter)</span>}
          </label>
          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? "•••••••••• (preencha pra alterar)" : "Senha SMTP"}
              required={!hasPassword}
              className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowPwd((p) => !p)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
            >
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-slate-600 text-[11px] mt-1">
            Armazenada criptografada (AES-256-GCM). Nunca exibida em texto claro.
          </p>
        </div>

        {/* From */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Remetente (opcional)
          </label>
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder='LeadHub <noreply@azzagencia.com.br>'
            className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
          <p className="text-slate-600 text-[11px] mt-1">
            Nome e e-mail que aparecem no remetente. Se omitido, usa o usuário SMTP.
          </p>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2 pt-2 border-t border-[#1e2d45]">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !host || !user}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0a0e16] border border-[#1e2d45] text-slate-300 text-sm font-medium hover:border-slate-500 disabled:opacity-50 transition-colors"
            title="Manda um e-mail de teste pro seu próprio e-mail"
          >
            <Send className="w-3.5 h-3.5" strokeWidth={2.25} />
            {testing ? "Enviando..." : "Enviar teste"}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium ml-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> Salvo
            </span>
          )}
        </div>

        {/* Resultado do teste */}
        {testResult && (
          <div
            className={`flex items-start gap-2 p-3 rounded-lg text-xs ${
              testResult.ok
                ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300"
                : "bg-red-500/10 border border-red-500/25 text-red-300"
            }`}
          >
            {testResult.ok ? (
              <>
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">E-mail de teste enviado!</p>
                  <p className="opacity-80 mt-0.5">Verifique a caixa de entrada de {testResult.sentTo}</p>
                </div>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Falha {testResult.step === "verify" ? "ao conectar no SMTP" : "ao enviar e-mail"}
                  </p>
                  <p className="opacity-80 mt-0.5 break-all">{testResult.error}</p>
                </div>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
