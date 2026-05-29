"use client";

import { useEffect, useState } from "react";

interface Config {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName: string;
  verified: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  hasPassword: boolean;
}

export default function CompanyEmailConfigForm({ companyId }: { companyId?: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [existing, setExisting] = useState<Config | null>(null);

  const [form, setForm] = useState({
    host: "", port: 465, secure: true, user: "", pass: "", fromEmail: "", fromName: "",
  });

  const qs = companyId ? `?companyId=${companyId}` : "";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/email/config${qs}`);
        if (res.ok) {
          const data: Config | null = await res.json();
          if (data) {
            setExisting(data);
            setForm({
              host: data.host, port: data.port, secure: data.secure,
              user: data.user, pass: "", fromEmail: data.fromEmail, fromName: data.fromName,
            });
          }
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await fetch("/api/email/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, ...(companyId ? { companyId } : {}) }),
    });
    if (res.ok) {
      setMsg({ type: "ok", text: "Configuração salva. Agora clique em \"Testar conexão\"." });
      setExisting((p) => p ? { ...p, ...form, hasPassword: true, verified: false } : null);
      setForm((f) => ({ ...f, pass: "" })); // limpa o campo de senha após salvar
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg({ type: "err", text: d.error ?? "Erro ao salvar" });
    }
    setSaving(false);
  }

  async function test() {
    setTesting(true); setMsg(null);
    const res = await fetch("/api/email/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(companyId ? { companyId } : {}),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ok) {
      setMsg({ type: "ok", text: "✅ Conexão SMTP funcionando! Já pode disparar campanhas." });
      setExisting((p) => p ? { ...p, verified: true, lastError: null } : null);
    } else {
      setMsg({ type: "err", text: `❌ Falha: ${d.error ?? "não conectou"}` });
    }
    setTesting(false);
  }

  if (loading) return <div className="text-slate-600 text-sm">Carregando...</div>;

  const input = "w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-white font-bold text-sm">📧 Servidor de e-mail (SMTP)</h2>
        {existing && (
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
            existing.verified
              ? "bg-green-500/20 text-green-400 border-green-500/40"
              : "bg-amber-500/20 text-amber-400 border-amber-500/40"
          }`}>
            {existing.verified ? "Verificado" : "Não testado"}
          </span>
        )}
      </div>
      <p className="text-slate-500 text-xs mb-4">
        As campanhas saem deste e-mail. Use o SMTP da sua empresa (ex: Gmail Workspace, Zoho, Hostgator).
        Sem isso, nenhuma campanha é enviada.
      </p>

      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1">Servidor (host) <span className="text-red-400">*</span></label>
            <input className={input} value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="smtp.gmail.com" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-400 text-xs font-medium mb-1">Porta</label>
              <input type="number" className={input} value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value || "465", 10) }))} />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input type="checkbox" checked={form.secure} onChange={(e) => setForm((f) => ({ ...f, secure: e.target.checked }))} className="w-4 h-4" />
                SSL/TLS
              </label>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1">Usuário <span className="text-red-400">*</span></label>
            <input className={input} value={form.user} onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))} placeholder="contato@suaempresa.com.br" />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1">
              Senha {existing?.hasPassword ? <span className="text-slate-600">(deixe em branco pra manter)</span> : <span className="text-red-400">*</span>}
            </label>
            <input type="password" className={input} value={form.pass} onChange={(e) => setForm((f) => ({ ...f, pass: e.target.value }))} placeholder={existing?.hasPassword ? "••••••••" : "senha SMTP"} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1">E-mail remetente <span className="text-red-400">*</span></label>
            <input className={input} value={form.fromEmail} onChange={(e) => setForm((f) => ({ ...f, fromEmail: e.target.value }))} placeholder="contato@suaempresa.com.br" />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1">Nome remetente <span className="text-red-400">*</span></label>
            <input className={input} value={form.fromName} onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))} placeholder="AZZ Agência de Marketing" />
          </div>
        </div>

        {msg && (
          <div className={`text-xs rounded-lg px-3 py-2 border ${
            msg.type === "ok" ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}>
            {msg.text}
          </div>
        )}

        {existing?.lastError && !msg && (
          <div className="text-xs rounded-lg px-3 py-2 border bg-red-500/10 border-red-500/30 text-red-400">
            Último erro: {existing.lastError}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" onClick={test} disabled={testing || !existing} className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white text-sm font-medium disabled:opacity-50">
            {testing ? "Testando..." : "Testar conexão"}
          </button>
        </div>
      </form>
    </div>
  );
}
