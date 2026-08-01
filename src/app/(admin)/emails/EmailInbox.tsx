"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Mail, Inbox, Star, Send, AlertOctagon, Trash2, RefreshCw, Settings,
  PenSquare, Reply, ArchiveRestore, X, Search, LifeBuoy, Target,
} from "lucide-react";

type Folder = "INBOX" | "IMPORTANT" | "SENT" | "SPAM" | "TRASH";

type EmailRow = {
  id: string;
  direction: "IN" | "OUT";
  folder: Folder;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  snippet: string;
  seen: boolean;
  sentAt: string;
  leadId: string | null;
  ticketId: string | null;
  lead: { id: string; name: string | null } | null;
  ticket: { id: string; title: string } | null;
};

type EmailFull = EmailRow & {
  textBody: string | null;
  htmlBody: string | null;
  lead: { id: string; name: string | null; email: string | null; pipeline: string | null } | null;
};

type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  active: boolean;
  verified: boolean;
  lastError: string | null;
  lastSyncedAt: string | null;
  hasPassword: boolean;
} | null;

const FOLDER_META: { key: Folder; label: string; Icon: typeof Inbox }[] = [
  { key: "INBOX",     label: "Entrada",     Icon: Inbox },
  { key: "IMPORTANT", label: "Importantes", Icon: Star },
  { key: "SENT",      label: "Enviados",    Icon: Send },
  { key: "SPAM",      label: "Spam",        Icon: AlertOctagon },
  { key: "TRASH",     label: "Lixeira",     Icon: Trash2 },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function EmailInbox() {
  const [folder, setFolder] = useState<Folder>("INBOX");
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unseen, setUnseen] = useState(0);
  const [imapStatus, setImapStatus] = useState<{ active: boolean; verified: boolean; lastSyncedAt: string | null; lastError: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<EmailFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");

  // Compor / responder
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({ to: "", subject: "", text: "", replyToId: null as string | null });
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");

  // Config IMAP
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<ImapConfig>(null);
  const [cfgForm, setCfgForm] = useState({ host: "", port: "993", secure: true, user: "", pass: "", active: true });
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgTesting, setCfgTesting] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const configLoaded = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({ folder });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/email/inbox?${params}`).then((r) => r.json());
      setEmails(res.emails || []);
      setCounts(res.counts || {});
      setUnseen(res.unseen || 0);
      setImapStatus(res.config || null);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [folder, q]);

  useEffect(() => { load(); }, [load]);

  // Atualização leve a cada 60s (o poller do servidor importa; aqui só relemos).
  useEffect(() => {
    const t = setInterval(() => load({ silent: true }), 60000);
    return () => clearInterval(t);
  }, [load]);

  async function openEmail(row: EmailRow) {
    setDetailLoading(true);
    setSelected(null);
    try {
      const res = await fetch(`/api/email/inbox/${row.id}`).then((r) => r.json());
      if (res.email) {
        setSelected(res.email);
        setEmails((prev) => prev.map((e) => (e.id === row.id ? { ...e, seen: true } : e)));
        if (!row.seen && row.folder === "INBOX") setUnseen((u) => Math.max(0, u - 1));
      }
    } finally {
      setDetailLoading(false);
    }
  }

  async function moveTo(id: string, target: Folder) {
    const res = await fetch(`/api/email/inbox/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: target }),
    });
    if (res.ok) {
      setEmails((prev) => prev.filter((e) => e.id !== id));
      setSelected((s) => (s?.id === id ? null : s));
      load({ silent: true });
    }
  }

  async function syncNow() {
    setSyncing(true);
    setNotice("");
    try {
      const res = await fetch(`/api/email/inbox/sync`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) setNotice(j.error || "Falha na sincronização");
      else setNotice(j.imported ? `${j.imported} email(s) novo(s)` : "Nenhum email novo");
      load({ silent: true });
    } finally {
      setSyncing(false);
      setTimeout(() => setNotice(""), 5000);
    }
  }

  function startCompose() {
    setCompose({ to: "", subject: "", text: "", replyToId: null });
    setSendErr("");
    setComposeOpen(true);
  }

  function startReply(email: EmailFull) {
    const to = email.direction === "IN" ? email.fromEmail : email.toEmail;
    const subject = email.subject.toLowerCase().startsWith("re:") ? email.subject : `Re: ${email.subject}`;
    setCompose({ to, subject, text: "", replyToId: email.id });
    setSendErr("");
    setComposeOpen(true);
  }

  async function send() {
    setSending(true);
    setSendErr("");
    try {
      const res = await fetch(`/api/email/inbox/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compose),
      });
      const j = await res.json();
      if (!res.ok) { setSendErr(j.error || "Falha ao enviar"); return; }
      setComposeOpen(false);
      setNotice("Email enviado ✓");
      setTimeout(() => setNotice(""), 5000);
      load({ silent: true });
    } finally {
      setSending(false);
    }
  }

  async function openConfig() {
    setConfigOpen(true);
    setCfgMsg(null);
    if (!configLoaded.current) {
      const cfg: ImapConfig = await fetch(`/api/email/inbox/config`).then((r) => r.json()).catch(() => null);
      setConfig(cfg);
      if (cfg) {
        setCfgForm({ host: cfg.host, port: String(cfg.port), secure: cfg.secure, user: cfg.user, pass: "", active: cfg.active });
      }
      configLoaded.current = true;
    }
  }

  async function saveConfig(test: boolean) {
    setCfgSaving(true);
    setCfgMsg(null);
    try {
      const res = await fetch(`/api/email/inbox/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: cfgForm.host,
          port: parseInt(cfgForm.port, 10) || 993,
          secure: cfgForm.secure,
          user: cfgForm.user,
          pass: cfgForm.pass || undefined,
          active: cfgForm.active,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setCfgMsg({ ok: false, text: j.error || "Erro ao salvar" }); return; }
      if (!test) { setCfgMsg({ ok: true, text: "Configuração salva" }); return; }

      setCfgTesting(true);
      const tRes = await fetch(`/api/email/inbox/config/test`, { method: "POST" });
      const tj = await tRes.json();
      if (!tRes.ok) setCfgMsg({ ok: false, text: tj.error || "Falha na conexão IMAP" });
      else setCfgMsg({ ok: true, text: `Conexão OK${typeof tj.imported === "number" ? ` — ${tj.imported} email(s) importado(s)` : ""}` });
      configLoaded.current = false;
      load({ silent: true });
    } finally {
      setCfgSaving(false);
      setCfgTesting(false);
    }
  }

  const noConfig = imapStatus === null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Mail size={20} className="text-indigo-400" /> E-mail
        </h1>
        {imapStatus?.lastSyncedAt && (
          <span className="text-[11px] text-slate-500">
            Última sync: {fmtDate(imapStatus.lastSyncedAt)}
          </span>
        )}
        {imapStatus?.lastError && (
          <span className="text-[11px] text-red-400 truncate max-w-[280px]" title={imapStatus.lastError}>
            Erro IMAP: {imapStatus.lastError}
          </span>
        )}
        {notice && <span className="text-[11px] text-emerald-400">{notice}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={syncNow} disabled={syncing || noConfig}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40">
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Sincronizar
          </button>
          <button onClick={openConfig}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">
            <Settings size={13} /> Configurar IMAP
          </button>
          <button onClick={startCompose}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs text-white hover:bg-indigo-400">
            <PenSquare size={13} /> Escrever
          </button>
        </div>
      </div>

      {noConfig && !loading && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Caixa de entrada ainda não conectada. Clique em <b>Configurar IMAP</b> pra conectar a caixa
          de email da empresa (o envio usa o SMTP já configurado no E-mail Marketing).
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[170px_320px_1fr] gap-4 h-[74vh]">
        {/* Pastas */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto">
          {FOLDER_META.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => { setFolder(key); setSelected(null); }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap ${
                folder === key ? "bg-indigo-500/20 text-indigo-200" : "text-slate-400 hover:bg-white/5"}`}>
              <Icon size={15} />
              <span className="flex-1 text-left">{label}</span>
              {key === "INBOX" && unseen > 0 && (
                <span className="text-[10px] rounded-full bg-indigo-500 text-white px-1.5 py-0.5">{unseen}</span>
              )}
              {key !== "INBOX" && (counts[key] ?? 0) > 0 && (
                <span className="text-[10px] text-slate-500">{counts[key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div className="rounded-xl border border-white/10 bg-white/5 flex flex-col min-h-0">
          <div className="p-2 border-b border-white/10">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por assunto, remetente…"
                className="w-full rounded-lg bg-white/5 border border-white/10 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="p-3 text-slate-500 text-sm">Carregando…</p>}
            {!loading && emails.length === 0 && (
              <p className="p-3 text-slate-500 text-sm">Nenhum email nesta pasta.</p>
            )}
            {emails.map((e) => (
              <button key={e.id} onClick={() => openEmail(e)}
                className={`w-full text-left px-3 py-2.5 border-b border-white/5 hover:bg-white/5 ${selected?.id === e.id ? "bg-white/10" : ""}`}>
                <div className="flex items-center gap-2">
                  {!e.seen && e.direction === "IN" && <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />}
                  <span className={`text-sm truncate flex-1 ${e.seen ? "text-slate-300" : "text-white font-semibold"}`}>
                    {e.direction === "OUT" ? `Para: ${e.toEmail}` : (e.fromName || e.fromEmail)}
                  </span>
                  <span className="text-[10px] text-slate-500 flex-shrink-0">{fmtDate(e.sentAt)}</span>
                </div>
                <p className={`text-xs truncate ${e.seen ? "text-slate-400" : "text-slate-200"}`}>{e.subject || "(sem assunto)"}</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] text-slate-500 truncate flex-1">{e.snippet || "—"}</p>
                  {e.lead && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 flex-shrink-0">lead</span>}
                  {e.ticket && <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 flex-shrink-0">chamado</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Leitura */}
        <div className="rounded-xl border border-white/10 bg-white/5 flex flex-col min-h-0">
          {!selected && !detailLoading && (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Selecione um email</div>
          )}
          {detailLoading && <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Carregando…</div>}
          {selected && (
            <>
              <div className="px-4 py-3 border-b border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-white text-sm font-semibold break-words">{selected.subject || "(sem assunto)"}</h2>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {selected.direction === "IN"
                        ? <>De: <span className="text-slate-300">{selected.fromName ? `${selected.fromName} <${selected.fromEmail}>` : selected.fromEmail}</span></>
                        : <>Para: <span className="text-slate-300">{selected.toEmail}</span></>}
                      <span className="text-slate-600"> · {fmtDate(selected.sentAt)}</span>
                    </p>
                    <div className="flex gap-2 mt-1.5">
                      {selected.lead && (
                        <Link href={`/crm/leads?lead=${selected.lead.id}`}
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">
                          <Target size={10} /> {selected.lead.name || "Lead"}
                        </Link>
                      )}
                      {selected.ticket && (
                        <Link href={`/chamados/${selected.ticket.id}`}
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 hover:bg-sky-500/30">
                          <LifeBuoy size={10} /> {selected.ticket.title}
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startReply(selected)} title="Responder"
                      className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/5"><Reply size={14} /></button>
                    {selected.folder !== "IMPORTANT" && selected.folder !== "SENT" && (
                      <button onClick={() => moveTo(selected.id, "IMPORTANT")} title="Marcar como importante"
                        className="rounded-lg border border-white/10 p-1.5 text-amber-300 hover:bg-white/5"><Star size={14} /></button>
                    )}
                    {selected.folder !== "SPAM" && selected.folder !== "SENT" && (
                      <button onClick={() => moveTo(selected.id, "SPAM")} title="Marcar como spam"
                        className="rounded-lg border border-white/10 p-1.5 text-orange-300 hover:bg-white/5"><AlertOctagon size={14} /></button>
                    )}
                    {(selected.folder === "SPAM" || selected.folder === "TRASH") && (
                      <button onClick={() => moveTo(selected.id, "INBOX")} title="Restaurar pra Entrada"
                        className="rounded-lg border border-white/10 p-1.5 text-emerald-300 hover:bg-white/5"><ArchiveRestore size={14} /></button>
                    )}
                    {selected.folder !== "TRASH" && (
                      <button onClick={() => moveTo(selected.id, "TRASH")} title="Descartar (lixeira)"
                        className="rounded-lg border border-white/10 p-1.5 text-red-300 hover:bg-white/5"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-0 bg-white rounded-b-xl overflow-hidden">
                {selected.htmlBody ? (
                  // sandbox sem allow-scripts: HTML de terceiros não executa nada.
                  <iframe title="email" sandbox="" srcDoc={selected.htmlBody} className="w-full h-full border-0" />
                ) : (
                  <pre className="w-full h-full overflow-auto p-4 text-sm text-slate-800 whitespace-pre-wrap font-sans">{selected.textBody || "—"}</pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal: compor/responder */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setComposeOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0f1623] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-sm font-semibold">{compose.replyToId ? "Responder" : "Novo email"}</h3>
              <button onClick={() => setComposeOpen(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="space-y-2">
              <input value={compose.to} onChange={(e) => setCompose((c) => ({ ...c, to: e.target.value }))}
                placeholder="Para (email)" type="email"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              <input value={compose.subject} onChange={(e) => setCompose((c) => ({ ...c, subject: e.target.value }))}
                placeholder="Assunto"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              <textarea value={compose.text} onChange={(e) => setCompose((c) => ({ ...c, text: e.target.value }))}
                placeholder="Mensagem…" rows={8}
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-y" />
            </div>
            {sendErr && <p className="text-red-400 text-xs mt-2">{sendErr}</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setComposeOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancelar</button>
              <button onClick={send} disabled={sending}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-50">
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: config IMAP */}
      {configOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setConfigOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0f1623] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white text-sm font-semibold">Conexão IMAP (recebimento)</h3>
              <button onClick={() => setConfigOpen(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              O envio usa o SMTP configurado em E-mail Marketing. Aqui você conecta a caixa de <b>entrada</b> (IMAP).
            </p>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <input value={cfgForm.host} onChange={(e) => setCfgForm((f) => ({ ...f, host: e.target.value }))}
                  placeholder="Servidor IMAP (ex: imap.hostinger.com)"
                  className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                <input value={cfgForm.port} onChange={(e) => setCfgForm((f) => ({ ...f, port: e.target.value }))}
                  placeholder="Porta" inputMode="numeric"
                  className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              </div>
              <input value={cfgForm.user} onChange={(e) => setCfgForm((f) => ({ ...f, user: e.target.value }))}
                placeholder="Usuário (email completo)"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              <input value={cfgForm.pass} onChange={(e) => setCfgForm((f) => ({ ...f, pass: e.target.value }))}
                placeholder={config?.hasPassword ? "Senha (deixe vazio pra manter a atual)" : "Senha"} type="password"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={cfgForm.secure} onChange={(e) => setCfgForm((f) => ({ ...f, secure: e.target.checked }))} />
                  SSL/TLS (porta 993)
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={cfgForm.active} onChange={(e) => setCfgForm((f) => ({ ...f, active: e.target.checked }))} />
                  Sincronização automática
                </label>
              </div>
            </div>
            {cfgMsg && (
              <p className={`text-xs mt-2 ${cfgMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{cfgMsg.text}</p>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => saveConfig(false)} disabled={cfgSaving}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">
                Salvar
              </button>
              <button onClick={() => saveConfig(true)} disabled={cfgSaving || cfgTesting}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-50">
                {cfgTesting ? "Testando…" : "Salvar e testar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
