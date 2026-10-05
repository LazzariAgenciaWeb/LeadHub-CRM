"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, Search, Users, MessageSquare, Link2, X } from "lucide-react";

/** "5511999990001" → "+55 11 99999-0001"; JID de grupo vira "Grupo". */
function formatPhone(p: string) {
  if (p.endsWith("@g.us")) return "Grupo do WhatsApp";
  const d = p.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return p;
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ─── Vincular conversa do WhatsApp (contato ou grupo) ─────────────────────────

interface ConvHit {
  phone: string;
  lead: { id: string; name: string | null } | null;
  companyContact: { name: string | null } | null;
  conversation: { id: string };
}

export interface LinkConversationResult {
  conversationId: string;
  phone: string;
  phoneSet: boolean;
  linked: number;
  isGroup: boolean;
}

/**
 * Busca conversas do WhatsApp (por nome do contato/grupo ou telefone) e liga
 * a escolhida ao lead via POST /api/leads/[id]/link-conversation.
 */
export function LinkConversationPicker({
  leadId,
  companyId,
  onLinked,
}: {
  leadId: string;
  companyId?: string | null;
  onLinked: (r: LinkConversationResult) => void;
}) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [hits, setHits] = useState<ConvHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (dq.length < 2) { setHits([]); return; }
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ q: dq, ...(companyId ? { companyId } : {}) });
    fetch(`/api/conversations/search?${qs}`)
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((d) => { if (!cancelled) setHits((d.conversations ?? []).slice(0, 12)); })
      .catch(() => { if (!cancelled) setHits([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dq, companyId]);

  async function link(h: ConvHit) {
    setBusyId(h.conversation.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/link-conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: h.conversation.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(`⚠️ ${data.error ?? "Erro ao vincular"}`); return; }
      setMsg(`✅ Vinculado${data.linked ? ` — ${data.linked} mensagem(ns) trazida(s)` : ""}`);
      setQ("");
      setHits([]);
      onLinked({
        conversationId: h.conversation.id,
        phone: data.phone,
        phoneSet: data.phoneSet,
        linked: data.linked,
        isGroup: data.isGroup,
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar contato, grupo ou telefone..."
          className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          autoFocus
        />
      </div>
      {loading && <p className="text-slate-500 text-[11px]">Buscando...</p>}
      {!loading && dq.length >= 2 && hits.length === 0 && (
        <p className="text-slate-500 text-[11px]">Nenhuma conversa encontrada.</p>
      )}
      {hits.length > 0 && (
        <ul className="max-h-56 overflow-y-auto divide-y divide-[#1e2d45] border border-[#1e2d45] rounded-lg">
          {hits.map((h) => {
            const isGroup = h.phone.endsWith("@g.us");
            const name = h.companyContact?.name || h.lead?.name || formatPhone(h.phone);
            return (
              <li key={h.conversation.id} className="flex items-center gap-2 px-2.5 py-2">
                {isGroup
                  ? <Users className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
                  : <MessageSquare className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white truncate">{name}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {formatPhone(h.phone)}
                    {h.lead && h.lead.id !== leadId && ` · lead: ${h.lead.name ?? "sem nome"}`}
                  </div>
                </div>
                <button
                  onClick={() => link(h)}
                  disabled={busyId !== null}
                  className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium disabled:opacity-50 flex-shrink-0"
                >
                  {busyId === h.conversation.id ? "..." : "Vincular"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {msg && <p className="text-xs text-slate-300">{msg}</p>}
    </div>
  );
}

// ─── E-mails vinculados à negociação ──────────────────────────────────────────

interface EmailRow {
  id: string;
  direction?: "IN" | "OUT";
  fromEmail: string;
  fromName?: string | null;
  toEmail: string;
  subject: string | null;
  snippet?: string | null;
  sentAt: string;
  lead?: { id: string; name: string | null } | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * Lista os emails da caixa de entrada ligados ao lead e permite ligar outros:
 * em massa pelo endereço do lead, ou um a um pela busca. Ligar/desligar um
 * email usa o PATCH da caixa de entrada (respeita as caixas que o usuário vê
 * e propaga pras cópias do mesmo email).
 */
export function LeadEmailsPanel({
  leadId,
  leadEmail,
  onChanged,
}: {
  leadId: string;
  leadEmail: string | null;
  onChanged?: () => void;
}) {
  const [linked, setLinked] = useState<EmailRow[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [hits, setHits] = useState<EmailRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const reqId = useRef(0);

  async function loadLinked() {
    const res = await fetch(`/api/email/inbox?leadId=${leadId}&take=30`).catch(() => null);
    if (!res || res.status === 401 || res.status === 403) { setUnavailable(true); setLinked([]); return; }
    const data = await res.json().catch(() => ({}));
    setLinked(data.emails ?? []);
  }

  useEffect(() => {
    setLinked(null);
    setUnavailable(false);
    setSearchOpen(false);
    setQ("");
    setMsg(null);
    loadLinked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    if (!searchOpen || dq.length < 2) { setHits([]); return; }
    const my = ++reqId.current;
    setSearching(true);
    fetch(`/api/email/inbox?folder=ALL&take=15&q=${encodeURIComponent(dq)}`)
      .then((r) => (r.ok ? r.json() : { emails: [] }))
      .then((d) => { if (my === reqId.current) setHits(d.emails ?? []); })
      .catch(() => { if (my === reqId.current) setHits([]); })
      .finally(() => { if (my === reqId.current) setSearching(false); });
  }, [dq, searchOpen]);

  async function setLink(emailId: string, link: boolean) {
    setBusy(emailId);
    setMsg(null);
    const res = await fetch(`/api/email/inbox/${emailId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: link ? leadId : null }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) { setMsg("⚠️ Não foi possível alterar o vínculo"); return; }
    if (link) setHits((prev) => prev.filter((h) => h.id !== emailId));
    await loadLinked();
    onChanged?.();
  }

  async function linkByAddress() {
    if (!leadEmail) return;
    setBusy("__address");
    setMsg(null);
    const res = await fetch(`/api/leads/${leadId}/link-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: leadEmail }),
    }).catch(() => null);
    setBusy(null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) { setMsg(`⚠️ ${data.error ?? "Erro ao vincular"}`); return; }
    setMsg(data.linked
      ? `✅ ${data.linked} email(s) de ${leadEmail} vinculado(s)`
      : `Nenhum email novo de ${leadEmail} pra vincular`);
    await loadLinked();
    onChanged?.();
  }

  if (unavailable) return null; // sem acesso à caixa de entrada → não mostra o bloco

  const linkedIds = new Set((linked ?? []).map((e) => e.id));

  return (
    <div className="mt-3 pt-3 border-t border-[#1e2d45] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-500 text-[10px] uppercase tracking-wide flex items-center gap-1.5">
          <Mail className="w-3 h-3" /> E-mails da negociação
          {linked && linked.length > 0 && (
            <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 rounded-full normal-case">{linked.length}</span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          {leadEmail && (
            <button
              onClick={linkByAddress}
              disabled={busy !== null}
              title={`Vincula os emails trocados com ${leadEmail} que ainda não estão em nenhuma negociação`}
              className="text-[10px] px-2 py-1 rounded-md bg-[#0a0f1a] border border-[#1e2d45] text-slate-300 hover:text-white disabled:opacity-50"
            >
              {busy === "__address" ? "..." : "Puxar deste e-mail"}
            </button>
          )}
          <button
            onClick={() => { setSearchOpen((v) => !v); setQ(""); setHits([]); }}
            className="text-[10px] px-2 py-1 rounded-md bg-indigo-600/20 border border-indigo-500/30 text-indigo-200 hover:bg-indigo-600/30 flex items-center gap-1"
          >
            <Link2 className="w-3 h-3" /> {searchOpen ? "Fechar" : "Vincular e-mail"}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por assunto, remetente ou destinatário..."
              className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              autoFocus
            />
          </div>
          {searching && <p className="text-slate-500 text-[11px]">Buscando...</p>}
          {!searching && dq.length >= 2 && hits.length === 0 && (
            <p className="text-slate-500 text-[11px]">Nenhum e-mail encontrado.</p>
          )}
          {hits.length > 0 && (
            <ul className="max-h-56 overflow-y-auto divide-y divide-[#1e2d45] border border-[#1e2d45] rounded-lg">
              {hits.map((e) => {
                const already = linkedIds.has(e.id);
                const other = e.lead && e.lead.id !== leadId ? e.lead : null;
                return (
                  <li key={e.id} className="flex items-center gap-2 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-white truncate">{e.subject || "(sem assunto)"}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {e.direction === "OUT" ? `para ${e.toEmail}` : `de ${e.fromName || e.fromEmail}`} · {fmtDate(e.sentAt)}
                        {other && <span className="text-amber-400/80"> · já em: {other.name ?? "outro lead"}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => setLink(e.id, true)}
                      disabled={already || busy !== null}
                      title={other ? "Move este e-mail para esta negociação" : undefined}
                      className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium disabled:opacity-40 flex-shrink-0"
                    >
                      {already ? "Vinculado" : busy === e.id ? "..." : other ? "Mover" : "Vincular"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {linked === null ? (
        <p className="text-slate-600 text-[11px]">Carregando...</p>
      ) : linked.length === 0 ? (
        <p className="text-slate-600 text-[11px]">Nenhum e-mail vinculado ainda.</p>
      ) : (
        <ul className="space-y-1">
          {linked.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-[11px] bg-[#0a0f1a] border border-[#1e2d45] rounded-md px-2 py-1.5">
              <span className={e.direction === "OUT" ? "text-green-400" : "text-sky-400"}>
                {e.direction === "OUT" ? "↗" : "↙"}
              </span>
              <span className="text-slate-200 truncate flex-1 min-w-0">{e.subject || "(sem assunto)"}</span>
              <span className="text-slate-500 flex-shrink-0">{fmtDate(e.sentAt)}</span>
              <button
                onClick={() => setLink(e.id, false)}
                disabled={busy !== null}
                title="Desvincular desta negociação"
                className="text-slate-500 hover:text-red-400 disabled:opacity-40 flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {msg && <p className="text-xs text-slate-300">{msg}</p>}
    </div>
  );
}
