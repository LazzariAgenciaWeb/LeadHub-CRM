"use client";

/**
 * Botão + modal de envio de email vinculado (lead ou chamado).
 * Usa a caixa da empresa (/api/email/inbox/send): sai pelo SMTP configurado
 * e fica registrado em Atender → E-mail → Enviados com o vínculo. A resposta
 * do destinatário volta pra caixa já ligada ao mesmo lead/chamado.
 */
import { useState } from "react";
import { Mail, X } from "lucide-react";

type AccountOption = { id: string; label: string | null; fromEmail: string; active: boolean };

interface Props {
  to: string;
  leadId?: string;
  ticketId?: string;
  defaultSubject?: string;
  onSent?: () => void;
  /** Variante compacta (só ícone) pra caber em cards apertados. */
  compact?: boolean;
}

export default function SendEmailButton({ to, leadId, ticketId, defaultSubject, onSent, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ to, subject: defaultSubject ?? "", text: "" });
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  // Rastrear abertura: mesma preferência da caixa de email (Atender → E-mail).
  const [trackOpen, setTrackOpen] = useState(true);

  function openModal() {
    setForm({ to, subject: defaultSubject ?? "", text: "" });
    setErr("");
    setOkMsg("");
    lerPreferencia();
    setOpen(true);
    // Contas da empresa pro seletor "De" (1ª ativa como default).
    fetch("/api/email/inbox/accounts")
      .then((r) => r.json())
      .then((j) => {
        const list: AccountOption[] = (j?.accounts || []).filter((a: AccountOption) => a.active);
        setAccounts(list);
        setAccountId((prev) => prev || list[0]?.id || "");
      })
      .catch(() => setAccounts([]));
  }

  // Mesma preferência usada na caixa de email.
  function lerPreferencia() {
    try {
      const t = localStorage.getItem("leadhub.emails.trackOpen");
      if (t !== null) setTrackOpen(t === "1");
    } catch {}
  }

  async function send() {
    setSending(true);
    setErr("");
    try {
      const res = await fetch("/api/email/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          accountId: accountId || null,
          leadId: leadId ?? null,
          ticketId: ticketId ?? null,
          track: trackOpen,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || "Falha ao enviar"); return; }
      setOkMsg("Enviado ✓");
      setTimeout(() => setOpen(false), 900);
      onSent?.();
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        title="Enviar email pela plataforma (fica registrado e vinculado)"
        className={compact
          ? "rounded-lg border border-white/10 p-1.5 text-indigo-300 hover:bg-white/5"
          : "flex items-center gap-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 px-2 py-1 text-[11px] text-white font-medium transition-colors"}
      >
        <Mail size={compact ? 14 : 12} />
        {!compact && "Enviar email"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0f1623] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-sm font-semibold">Enviar email</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="space-y-2">
              {accounts.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-8">De:</span>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                    className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id} className="bg-[#0f1623]">
                        {a.label ? `${a.label} — ${a.fromEmail}` : a.fromEmail}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <input value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
                placeholder="Para (email)" type="email"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Assunto"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              <textarea value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
                placeholder="Mensagem…" rows={7}
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-y" />
            </div>
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
            {okMsg && <p className="text-emerald-400 text-xs mt-2">{okMsg}</p>}
            <button
              onClick={() => setTrackOpen((v) => {
                try { localStorage.setItem("leadhub.emails.trackOpen", v ? "0" : "1"); } catch {}
                return !v;
              })}
              title={trackOpen
                ? "Um pixel invisível avisa quando a pessoa abrir (a abertura entra na timeline do lead). 'Não abriu' não prova nada: muitos clientes bloqueiam imagem."
                : "Desligado: você não saberá se o email foi aberto."}
              className={`mt-2 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg border ${
                trackOpen ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-white/10 text-slate-500 hover:bg-white/5"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${trackOpen ? "bg-emerald-400" : "bg-slate-600"}`} />
              Avisar quando abrir: {trackOpen ? "ligado" : "desligado"}
            </button>
            <p className="text-[10px] text-slate-500 mt-2">
              Sai pelo SMTP da empresa e fica registrado em Atender → E-mail, vinculado a este {ticketId ? "chamado" : "lead"}.
            </p>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancelar</button>
              <button onClick={send} disabled={sending}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-50">
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
