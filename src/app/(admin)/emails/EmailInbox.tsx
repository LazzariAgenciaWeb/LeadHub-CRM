"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Mail, Inbox, Star, Send, AlertOctagon, Trash2, RefreshCw, Settings,
  PenSquare, Reply, ArchiveRestore, X, Search, LifeBuoy, Target, Plus,
  Pencil, CheckCircle2, XCircle, AtSign, Check, ShieldCheck, ShieldBan, Sparkles,
  Tag as TagIcon, Flame, Activity, ChevronsDown, type LucideIcon,
} from "lucide-react";

type Folder = "INBOX" | "IMPORTANT" | "SENT" | "ARCHIVE" | "SPAM" | "TRASH";

type SenderRule = { id: string; fromEmail: string; type: "BLOCK" | "ALLOW"; createdAt: string };

type EmailTag = { id: string; name: string; color: string; count?: number };

type EmailAttachment = { id: string; filename: string; contentType: string; size: number };

type AccountRef = { id: string; label: string | null; fromEmail: string } | null;

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
  aiImportance: "ALTA" | "NORMAL" | "BAIXA" | null;
  aiSummary: string | null;
  tags: EmailTag[];
  _count?: { attachments: number };
  leadId: string | null;
  ticketId: string | null;
  accountId: string | null;
  account: AccountRef;
  lead: { id: string; name: string | null } | null;
  ticket: { id: string; title: string } | null;
};

type EmailFull = EmailRow & {
  textBody: string | null;
  htmlBody: string | null;
  attachments: EmailAttachment[];
  lead: { id: string; name: string | null; email: string | null; pipeline: string | null } | null;
};

type AccountSummary = {
  id: string;
  label: string | null;
  fromEmail: string;
  active: boolean;
  imapHost: string | null;
  smtpVerified: boolean;
  imapVerified: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type AccountFull = AccountSummary & {
  fromName: string;
  smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string;
  imapPort: number; imapSecure: boolean; imapUser: string | null;
  hasSmtpPassword: boolean;
};

const FOLDER_META: { key: Folder; label: string; Icon: typeof Inbox }[] = [
  { key: "INBOX",     label: "Entrada",     Icon: Inbox },
  { key: "IMPORTANT", label: "Importantes", Icon: Star },
  { key: "SENT",      label: "Enviados",    Icon: Send },
  { key: "ARCHIVE",   label: "Resolvidos",  Icon: CheckCircle2 },
  { key: "SPAM",      label: "Spam",        Icon: AlertOctagon },
  { key: "TRASH",     label: "Lixeira",     Icon: Trash2 },
];

// Cores das etiquetas de conta — atribuídas por ordem de cadastro.
const ACCOUNT_COLORS = [
  "bg-violet-500/20 text-violet-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-lime-500/20 text-lime-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Importância da triagem IA — ícones lucide no padrão do sistema, uma cor
// por nível (vermelho/azul/cinza) pra diferenciar de tag (◦ colorido) e
// conta (@).
const IMPORTANCE_BADGE: Record<string, { label: string; cls: string; Icon: LucideIcon }> = {
  ALTA:   { label: "alta",   cls: "bg-red-500/20 text-red-300",     Icon: Flame },
  NORMAL: { label: "normal", cls: "bg-sky-500/20 text-sky-300",     Icon: Activity },
  BAIXA:  { label: "baixa",  cls: "bg-slate-500/20 text-slate-400", Icon: ChevronsDown },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const EMPTY_ACC_FORM = {
  label: "", fromName: "", fromEmail: "",
  user: "", pass: "",
  smtpHost: "", smtpPort: "465", smtpSecure: true,
  imapHost: "", imapPort: "993", imapSecure: true,
  active: true,
};

export default function EmailInbox() {
  const [folder, setFolder] = useState<Folder>("INBOX");
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [aiFilter, setAiFilter] = useState<"ALTA" | "NORMAL" | "BAIXA" | null>(null);
  const [tags, setTags] = useState<EmailTag[]>([]);
  // Contagem por tag escopada na pasta/conta atual (vem da listagem).
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unseen, setUnseen] = useState(0);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<EmailFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");

  // Compor / responder
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({ to: "", subject: "", text: "", replyToId: null as string | null, accountId: "" });
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");

  // Triagem IA
  const [aiAuto, setAiAuto] = useState<boolean | null>(null); // null = carregando
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDigest, setAiDigest] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // Regras de remetente (blacklist/whitelist)
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<SenderRule[]>([]);
  const [ruleForm, setRuleForm] = useState({ fromEmail: "", type: "BLOCK" as "BLOCK" | "ALLOW" });
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleMsg, setRuleMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Gerenciar contas
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountsFull, setAccountsFull] = useState<AccountFull[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null); // null = lista; "new" = criando
  const [accForm, setAccForm] = useState({ ...EMPTY_ACC_FORM });
  const [accSaving, setAccSaving] = useState(false);
  const [accTestingId, setAccTestingId] = useState<string | null>(null);
  const [accMsg, setAccMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const accountColor = useCallback((accountId: string | null): string => {
    if (!accountId) return "bg-slate-500/20 text-slate-400";
    const idx = accounts.findIndex((a) => a.id === accountId);
    return ACCOUNT_COLORS[(idx >= 0 ? idx : 0) % ACCOUNT_COLORS.length];
  }, [accounts]);

  const accountName = (a: AccountRef | AccountSummary | null): string =>
    a ? (("label" in a && a.label) ? a.label : a.fromEmail) : "";

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({ folder });
      if (q.trim()) params.set("q", q.trim());
      if (accountFilter) params.set("accountId", accountFilter);
      if (tagFilter) params.set("tagId", tagFilter);
      if (aiFilter) params.set("importance", aiFilter);
      const res = await fetch(`/api/email/inbox?${params}`).then((r) => r.json());
      setEmails(res.emails || []);
      setCounts(res.counts || {});
      setUnseen(res.unseen || 0);
      setAccounts(res.accounts || []);
      setTagCounts(res.tagCounts || {});
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [folder, q, accountFilter, tagFilter, aiFilter]);

  useEffect(() => { load(); }, [load]);

  // Seleção zera ao trocar pasta/filtros.
  useEffect(() => { setSelectedIds(new Set()); }, [folder, accountFilter, tagFilter, aiFilter, q]);

  const loadTags = useCallback(async () => {
    const res = await fetch(`/api/email/inbox/tags`).then((r) => r.json()).catch(() => null);
    setTags(res?.tags || []);
  }, []);
  useEffect(() => { loadTags(); }, [loadTags]);

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
      const j = await res.json().catch(() => ({}));
      if (j.ruleCreated) {
        setNotice(`${j.ruleCreated} entrou na blacklist — próximos emails vão direto pro Spam${j.movedToSpam ? ` (${j.movedToSpam} movido(s) junto)` : ""}`);
        setTimeout(() => setNotice(""), 8000);
      } else if (j.ruleRemoved) {
        setNotice(`${j.ruleRemoved} saiu da blacklist`);
        setTimeout(() => setNotice(""), 6000);
      }
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
      else {
        let msg = j.imported ? `${j.imported} email(s) novo(s)` : "Nenhum email novo";
        if (j.errors?.length) msg += ` · ${j.errors.length} conta(s) com erro`;
        setNotice(msg);
      }
      load({ silent: true });
    } finally {
      setSyncing(false);
      setTimeout(() => setNotice(""), 6000);
    }
  }

  function startCompose() {
    const firstActive = accounts.find((a) => a.active);
    setCompose({ to: "", subject: "", text: "", replyToId: null, accountId: firstActive?.id ?? "" });
    setSendErr("");
    setComposeOpen(true);
  }

  function startReply(email: EmailFull) {
    const to = email.direction === "IN" ? email.fromEmail : email.toEmail;
    const subject = email.subject.toLowerCase().startsWith("re:") ? email.subject : `Re: ${email.subject}`;
    // Resposta sai pela conta que recebeu o email original.
    const accountId = email.accountId ?? accounts.find((a) => a.active)?.id ?? "";
    setCompose({ to, subject, text: "", replyToId: email.id, accountId });
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
        body: JSON.stringify({ ...compose, accountId: compose.accountId || null }),
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

  // ── Seleção múltipla / ações em lote ─────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === emails.length ? new Set() : new Set(emails.map((e) => e.id))
    );
  }

  async function bulkAction(action: string, tagId?: string) {
    if (!selectedIds.size || bulkBusy) return;
    if (action === "DELETE_SERVER" &&
        !window.confirm(`Excluir DEFINITIVAMENTE ${selectedIds.size} email(s)? Serão removidos também do servidor de email. Não dá pra desfazer.`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/email/inbox/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds], action, tagId }),
      });
      const j = await res.json();
      if (!res.ok) { setNotice(j.error || "Falha na ação"); }
      else {
        const msgs: Record<string, string> = {
          SPAM: `${j.affected} email(s) pro Spam${j.rulesCreated ? ` · ${j.rulesCreated} remetente(s) na blacklist` : ""}`,
          TRASH: `${j.affected} email(s) pra Lixeira`,
          IMPORTANT: `${j.affected} email(s) marcados como importantes`,
          ARCHIVE: `${j.affected} email(s) resolvidos`,
          INBOX: `${j.affected} email(s) restaurados`,
          DELETE_SERVER: `${j.affected} excluído(s) — ${j.serverDeleted} removido(s) do servidor`,
          ADD_TAG: `Tag aplicada em ${j.affected} email(s)`,
          REMOVE_TAG: `Tag removida de ${j.affected} email(s)`,
        };
        setNotice(msgs[action] ?? "Feito");
        setSelectedIds(new Set());
        setSelected(null);
        load({ silent: true });
        if (action.includes("TAG")) loadTags();
      }
      setTimeout(() => setNotice(""), 7000);
    } finally {
      setBulkBusy(false);
    }
  }

  async function createTag(name: string): Promise<EmailTag | null> {
    const res = await fetch(`/api/email/inbox/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await res.json();
    if (!res.ok) { setNotice(j.error || "Erro ao criar tag"); setTimeout(() => setNotice(""), 5000); return null; }
    await loadTags();
    return j.tag;
  }

  // Select de tag reutilizado (barra em lote e painel de leitura). Valor
  // "__new" abre um prompt pra criar a tag na hora.
  async function resolveTagChoice(value: string): Promise<string | null> {
    if (value === "__new") {
      const name = window.prompt("Nome da nova tag:");
      if (!name?.trim()) return null;
      const tag = await createTag(name.trim());
      return tag?.id ?? null;
    }
    return value || null;
  }

  async function tagSelected(value: string) {
    const tagId = await resolveTagChoice(value);
    if (tagId) bulkAction("ADD_TAG", tagId);
  }

  async function tagCurrent(value: string) {
    if (!selected) return;
    const tagId = await resolveTagChoice(value);
    if (!tagId) return;
    const res = await fetch(`/api/email/inbox/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addTagId: tagId }),
    });
    if (res.ok) {
      const tag = tags.find((t) => t.id === tagId);
      if (tag) setSelected((s) => (s ? { ...s, tags: [...s.tags.filter((t) => t.id !== tagId), tag] } : s));
      load({ silent: true });
      loadTags();
    }
  }

  async function untagCurrent(tagId: string) {
    if (!selected) return;
    const res = await fetch(`/api/email/inbox/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeTagId: tagId }),
    });
    if (res.ok) {
      setSelected((s) => (s ? { ...s, tags: s.tags.filter((t) => t.id !== tagId) } : s));
      load({ silent: true });
      loadTags();
    }
  }

  // ── Triagem IA ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/email/inbox/settings`)
      .then((r) => r.json())
      .then((j) => setAiAuto(!!j.aiTriageAuto))
      .catch(() => setAiAuto(false));
  }, []);

  async function toggleAiAuto() {
    if (aiAuto === null) return;
    const next = !aiAuto;
    setAiAuto(next);
    const res = await fetch(`/api/email/inbox/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiTriageAuto: next }),
    });
    if (!res.ok) setAiAuto(!next); // reverte se falhou
    else {
      setNotice(next
        ? "Triagem automática LIGADA — email novo será analisado pela IA (consome cota)"
        : "Triagem automática desligada — use o botão Resumo IA quando quiser");
      setTimeout(() => setNotice(""), 7000);
    }
  }

  async function runAiTriage() {
    setAiOpen(true);
    setAiLoading(true);
    setAiError("");
    setAiDigest("");
    try {
      const res = await fetch(`/api/email/inbox/ai-triage`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) { setAiError(j.error || "Falha na análise"); return; }
      setAiDigest(j.digest || "Análise concluída.");
      load({ silent: true });
    } catch {
      setAiError("Falha na análise. Tente de novo.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── Regras de remetente ───────────────────────────────────────────────────

  async function loadRules() {
    const res = await fetch(`/api/email/inbox/rules`).then((r) => r.json()).catch(() => null);
    setRules(res?.rules || []);
  }

  function openRules() {
    setRulesOpen(true);
    setRuleMsg(null);
    setRuleForm({ fromEmail: "", type: "BLOCK" });
    loadRules();
  }

  async function addRule() {
    setRuleSaving(true);
    setRuleMsg(null);
    try {
      const res = await fetch(`/api/email/inbox/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleForm),
      });
      const j = await res.json();
      if (!res.ok) { setRuleMsg({ ok: false, text: j.error || "Erro ao salvar" }); return; }
      setRuleMsg({
        ok: true,
        text: ruleForm.type === "BLOCK"
          ? `Bloqueado${j.moved ? ` — ${j.moved} email(s) movido(s) pro Spam` : ""}`
          : `Liberado${j.moved ? ` — ${j.moved} email(s) resgatado(s) do Spam` : ""}`,
      });
      setRuleForm({ fromEmail: "", type: ruleForm.type });
      loadRules();
      load({ silent: true });
    } finally {
      setRuleSaving(false);
    }
  }

  async function deleteRule(id: string) {
    const res = await fetch(`/api/email/inbox/rules?id=${id}`, { method: "DELETE" });
    if (res.ok) loadRules();
  }

  // ── Gerenciar contas ──────────────────────────────────────────────────────

  async function loadAccountsFull() {
    const res = await fetch(`/api/email/inbox/accounts`).then((r) => r.json()).catch(() => null);
    setAccountsFull(res?.accounts || []);
  }

  function openAccounts() {
    setAccountsOpen(true);
    setEditingId(null);
    setAccMsg(null);
    loadAccountsFull();
  }

  function startNewAccount() {
    setAccForm({ ...EMPTY_ACC_FORM });
    setAccMsg(null);
    setEditingId("new");
  }

  function startEditAccount(a: AccountFull) {
    setAccForm({
      label: a.label ?? "",
      fromName: a.fromName,
      fromEmail: a.fromEmail,
      user: a.smtpUser,
      pass: "",
      smtpHost: a.smtpHost,
      smtpPort: String(a.smtpPort),
      smtpSecure: a.smtpSecure,
      imapHost: a.imapHost ?? "",
      imapPort: String(a.imapPort),
      imapSecure: a.imapSecure,
      active: a.active,
    });
    setAccMsg(null);
    setEditingId(a.id);
  }

  async function saveAccount(test: boolean) {
    setAccSaving(true);
    setAccMsg(null);
    try {
      const payload = {
        label: accForm.label || null,
        fromName: accForm.fromName,
        fromEmail: accForm.fromEmail,
        smtpHost: accForm.smtpHost,
        smtpPort: parseInt(accForm.smtpPort, 10) || 465,
        smtpSecure: accForm.smtpSecure,
        smtpUser: accForm.user,
        smtpPass: accForm.pass || undefined,
        imapHost: accForm.imapHost || null,
        imapPort: parseInt(accForm.imapPort, 10) || 993,
        imapSecure: accForm.imapSecure,
        imapUser: accForm.user || null,
        imapPass: accForm.pass || undefined,
        active: accForm.active,
      };
      const isNew = editingId === "new";
      const res = await fetch(isNew ? `/api/email/inbox/accounts` : `/api/email/inbox/accounts/${editingId}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { setAccMsg({ ok: false, text: j.error || "Erro ao salvar" }); return; }

      const savedId = isNew ? j.id : editingId;
      await loadAccountsFull();
      load({ silent: true });

      if (test && savedId) {
        await testAccount(savedId);
      } else {
        setAccMsg({ ok: true, text: "Conta salva" });
      }
      setEditingId(null);
    } finally {
      setAccSaving(false);
    }
  }

  async function testAccount(id: string) {
    setAccTestingId(id);
    setAccMsg(null);
    try {
      const res = await fetch(`/api/email/inbox/accounts/${id}/test`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) { setAccMsg({ ok: false, text: j.error || "Falha no teste" }); return; }
      const parts = [
        j.smtp?.ok ? "SMTP OK" : `SMTP: ${j.smtp?.error ?? "falhou"}`,
        j.imap ? (j.imap.ok ? `IMAP OK — ${j.imported ?? 0} email(s) importado(s)` : `IMAP: ${j.imap.error ?? "falhou"}`) : "IMAP não configurado",
      ];
      setAccMsg({ ok: !!j.smtp?.ok && (!j.imap || j.imap.ok), text: parts.join(" · ") });
      await loadAccountsFull();
      load({ silent: true });
    } finally {
      setAccTestingId(null);
    }
  }

  async function deleteAccount(id: string, fromEmail: string) {
    if (!window.confirm(`Remover a conta ${fromEmail}? Os emails já importados continuam na caixa.`)) return;
    const res = await fetch(`/api/email/inbox/accounts/${id}`, { method: "DELETE" });
    if (res.ok) {
      await loadAccountsFull();
      if (accountFilter === id) setAccountFilter(null);
      load({ silent: true });
    }
  }

  const noAccounts = !loading && accounts.length === 0;
  const activeAccounts = accounts.filter((a) => a.active);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Mail size={20} className="text-indigo-400" /> E-mail
        </h1>
        {notice && <span className="text-[11px] text-emerald-400">{notice}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={syncNow} disabled={syncing || noAccounts}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40">
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Sincronizar
          </button>
          <button onClick={runAiTriage} disabled={aiLoading || noAccounts}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-40">
            <Sparkles size={13} className={aiLoading ? "animate-pulse" : ""} /> Resumo IA
          </button>
          <button onClick={openRules}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">
            <ShieldBan size={13} /> Regras
          </button>
          <button onClick={openAccounts}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">
            <Settings size={13} /> Contas
          </button>
          <button onClick={startCompose} disabled={noAccounts}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs text-white hover:bg-indigo-400 disabled:opacity-40">
            <PenSquare size={13} /> Escrever
          </button>
        </div>
      </div>

      {/* Etiquetas de conta — filtro + status */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <button onClick={() => setAccountFilter(null)}
            className={`px-2.5 py-1 rounded-lg text-[11px] border ${!accountFilter ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200" : "border-white/10 text-slate-400 hover:bg-white/5"}`}>
            Todas as contas
          </button>
          {accounts.map((a) => (
            <button key={a.id} onClick={() => setAccountFilter(accountFilter === a.id ? null : a.id)}
              title={`${a.fromEmail}${a.lastError ? ` · Erro: ${a.lastError}` : ""}${a.lastSyncedAt ? ` · sync ${fmtDate(a.lastSyncedAt)}` : ""}`}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border ${
                accountFilter === a.id ? "border-indigo-500/40" : "border-white/10 hover:bg-white/5"}`}>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${accountColor(a.id)}`}>
                <AtSign size={10} /> {accountName(a)}
              </span>
              {a.lastError && <XCircle size={11} className="text-red-400" />}
              {!a.lastError && (a.imapVerified || a.smtpVerified) && <CheckCircle2 size={11} className="text-emerald-400" />}
              {!a.active && <span className="text-[9px] text-slate-500">pausada</span>}
            </button>
          ))}
        </div>
      )}

      {/* Filtro pela triagem IA */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <Sparkles size={12} className="text-indigo-400" />
        {(["ALTA", "NORMAL", "BAIXA"] as const).map((imp) => {
          const b = IMPORTANCE_BADGE[imp];
          return (
            <button key={imp} onClick={() => setAiFilter(aiFilter === imp ? null : imp)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] border ${
                aiFilter === imp ? "border-indigo-500/50 " + b.cls : "border-white/10 text-slate-400 hover:bg-white/5"}`}>
              <b.Icon size={11} /> {b.label}
            </button>
          );
        })}
        {aiFilter && (
          <button onClick={() => setAiFilter(null)} className="text-[10px] text-slate-500 hover:text-white">limpar</button>
        )}
        {aiFilter === "BAIXA" && (
          <span className="text-[10px] text-slate-500">
            dica: selecione todos e mande pra Lixeira ou Spam de uma vez
          </span>
        )}
        <button onClick={toggleAiAuto} disabled={aiAuto === null}
          title={aiAuto
            ? "A IA analisa automaticamente cada email novo que chega (consome cota de IA). Clique pra desligar."
            : "Desligada: a IA só roda quando você clica em Resumo IA. Clique pra ligar a análise automática (consome cota a cada email novo)."}
          className={`ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] border ${
            aiAuto ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-200" : "border-white/10 text-slate-500 hover:bg-white/5"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${aiAuto ? "bg-emerald-400" : "bg-slate-600"}`} />
          Triagem automática: {aiAuto === null ? "…" : aiAuto ? "ligada" : "desligada"}
        </button>
      </div>

      {/* Tags — filtro */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <TagIcon size={12} className="text-slate-500" />
          {tags.map((t) => {
            const n = tagCounts[t.id] ?? 0;
            return (
              <button key={t.id} onClick={() => setTagFilter(tagFilter === t.id ? null : t.id)}
                title={`${t.name} — ${n} nesta pasta${typeof t.count === "number" ? ` (${t.count} no total)` : ""}`}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] border ${
                  tagFilter === t.id ? "border-indigo-500/50" : "border-white/10 hover:bg-white/5"} ${
                  n === 0 && tagFilter !== t.id ? "opacity-50" : ""}`}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                <span className="text-slate-300">{t.name}</span>
                {n > 0 && <span className="text-[9px] text-slate-500">{n}</span>}
              </button>
            );
          })}
          <button onClick={() => setTagFilter(tagFilter === "__none" ? null : "__none")}
            title="Emails sem nenhuma tag nesta pasta"
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] border ${
              tagFilter === "__none" ? "border-indigo-500/50 text-slate-200" : "border-dashed border-white/15 text-slate-500 hover:bg-white/5"}`}>
            sem tag
            {(tagCounts.__none ?? 0) > 0 && <span className="text-[9px] text-slate-500">{tagCounts.__none}</span>}
          </button>
          {tagFilter && (
            <button onClick={() => setTagFilter(null)} className="text-[10px] text-slate-500 hover:text-white">limpar</button>
          )}
        </div>
      )}

      {noAccounts && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Nenhuma conta de email cadastrada. Clique em <b>Contas</b> pra adicionar seus emails
          (ex: comercial@, suporte@) — cada conta envia (SMTP) e recebe (IMAP).
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[170px_320px_1fr] gap-4 h-[72vh]">
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
          <div className="p-2 border-b border-white/10 space-y-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" title="Selecionar todos"
                checked={emails.length > 0 && selectedIds.size === emails.length}
                onChange={toggleSelectAll}
                className="accent-indigo-500 flex-shrink-0" />
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por assunto, remetente…"
                  className="w-full rounded-lg bg-white/5 border border-white/10 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-slate-400 mr-1">{selectedIds.size} sel.</span>
                {folder !== "IMPORTANT" && (
                  <button onClick={() => bulkAction("IMPORTANT")} disabled={bulkBusy} title="Marcar importantes"
                    className="rounded-lg border border-white/10 p-1.5 text-amber-300 hover:bg-white/5 disabled:opacity-40"><Star size={13} /></button>
                )}
                {(folder === "INBOX" || folder === "IMPORTANT") && (
                  <button onClick={() => bulkAction("ARCHIVE")} disabled={bulkBusy} title="Resolvidos (arquivar)"
                    className="rounded-lg border border-white/10 p-1.5 text-emerald-300 hover:bg-white/5 disabled:opacity-40"><Check size={13} /></button>
                )}
                {folder !== "SPAM" && folder !== "SENT" && (
                  <button onClick={() => bulkAction("SPAM")} disabled={bulkBusy} title="Spam (bloqueia remetentes)"
                    className="rounded-lg border border-white/10 p-1.5 text-orange-300 hover:bg-white/5 disabled:opacity-40"><AlertOctagon size={13} /></button>
                )}
                {(folder === "SPAM" || folder === "TRASH" || folder === "ARCHIVE") && (
                  <button onClick={() => bulkAction("INBOX")} disabled={bulkBusy} title="Restaurar pra Entrada"
                    className="rounded-lg border border-white/10 p-1.5 text-emerald-300 hover:bg-white/5 disabled:opacity-40"><ArchiveRestore size={13} /></button>
                )}
                {folder !== "TRASH" ? (
                  <button onClick={() => bulkAction("TRASH")} disabled={bulkBusy} title="Lixeira"
                    className="rounded-lg border border-white/10 p-1.5 text-red-300 hover:bg-white/5 disabled:opacity-40"><Trash2 size={13} /></button>
                ) : (
                  <button onClick={() => bulkAction("DELETE_SERVER")} disabled={bulkBusy}
                    title="Excluir definitivamente (remove também do servidor de email)"
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/20 disabled:opacity-40">
                    Excluir do servidor
                  </button>
                )}
                <select value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) tagSelected(v); }}
                  disabled={bulkBusy}
                  title="Aplicar tag aos selecionados"
                  className="rounded-lg bg-white/5 border border-white/10 px-1.5 py-1 text-[10px] text-slate-300 focus:outline-none max-w-[110px]">
                  <option value="" className="bg-[#0f1623]">+ tag…</option>
                  {tags.map((t) => <option key={t.id} value={t.id} className="bg-[#0f1623]">{t.name}</option>)}
                  <option value="__new" className="bg-[#0f1623]">＋ criar nova tag</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="p-3 text-slate-500 text-sm">Carregando…</p>}
            {!loading && emails.length === 0 && (
              <p className="p-3 text-slate-500 text-sm">Nenhum email nesta pasta.</p>
            )}
            {emails.map((e) => (
              <div key={e.id} onClick={() => openEmail(e)} role="button" tabIndex={0}
                onKeyDown={(ev) => { if (ev.key === "Enter") openEmail(e); }}
                className={`flex gap-2 w-full text-left px-3 py-2.5 border-b border-white/5 hover:bg-white/5 cursor-pointer ${selected?.id === e.id ? "bg-white/10" : ""}`}>
                <input type="checkbox" checked={selectedIds.has(e.id)}
                  onChange={() => toggleSelect(e.id)}
                  onClick={(ev) => ev.stopPropagation()}
                  className="accent-indigo-500 flex-shrink-0 mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!e.seen && e.direction === "IN" && <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />}
                    <span className={`text-sm truncate flex-1 ${e.seen ? "text-slate-300" : "text-white font-semibold"}`}>
                      {e.direction === "OUT" ? `Para: ${e.toEmail}` : (e.fromName || e.fromEmail)}
                    </span>
                    {(e._count?.attachments ?? 0) > 0 && <span className="text-[10px] text-slate-500 flex-shrink-0" title="Com anexo">📎</span>}
                    <span className="text-[10px] text-slate-500 flex-shrink-0">{fmtDate(e.sentAt)}</span>
                  </div>
                  <p className={`text-xs truncate ${e.seen ? "text-slate-400" : "text-slate-200"}`}>{e.subject || "(sem assunto)"}</p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] text-slate-500 truncate flex-1">{e.aiSummary || e.snippet || "—"}</p>
                    {e.aiImportance && e.direction === "IN" && IMPORTANCE_BADGE[e.aiImportance] && (() => {
                      const b = IMPORTANCE_BADGE[e.aiImportance];
                      return (
                        <span className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${b.cls}`}>
                          <b.Icon size={9} /> {b.label}
                        </span>
                      );
                    })()}
                    {e.tags?.map((t) => (
                      <span key={t.id} className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-white/5 flex-shrink-0"
                        style={{ color: t.color }}>
                        <TagIcon size={9} />{t.name}
                      </span>
                    ))}
                    {e.account && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${accountColor(e.accountId)}`}>
                        {accountName(e.account)}
                      </span>
                    )}
                    {e.lead && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 flex-shrink-0">lead</span>}
                    {e.ticket && <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 flex-shrink-0">chamado</span>}
                  </div>
                </div>
              </div>
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
                    {selected.aiSummary && (
                      <p className="text-[11px] text-indigo-200/80 mt-1 flex items-start gap-1">
                        <Sparkles size={11} className="mt-0.5 flex-shrink-0 text-indigo-400" />
                        <span>{selected.aiSummary}</span>
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {selected.aiImportance && selected.direction === "IN" && IMPORTANCE_BADGE[selected.aiImportance] && (() => {
                        const b = IMPORTANCE_BADGE[selected.aiImportance];
                        return (
                          <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${b.cls}`}>
                            <b.Icon size={10} /> {b.label}
                          </span>
                        );
                      })()}
                      {selected.account && (
                        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${accountColor(selected.accountId)}`}>
                          <AtSign size={10} /> {selected.direction === "IN" ? "recebido em" : "enviado por"} {accountName(selected.account)}
                        </span>
                      )}
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
                      {selected.tags?.map((t) => (
                        <span key={t.id} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/5"
                          style={{ color: t.color }}>
                          <TagIcon size={10} />
                          {t.name}
                          <button onClick={() => untagCurrent(t.id)} title="Remover tag" className="text-slate-500 hover:text-red-300 ml-0.5">×</button>
                        </span>
                      ))}
                      <select value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) tagCurrent(v); }}
                        title="Adicionar tag"
                        className="rounded bg-white/5 border border-white/10 px-1 py-0.5 text-[10px] text-slate-400 focus:outline-none max-w-[90px]">
                        <option value="" className="bg-[#0f1623]">+ tag</option>
                        {tags.filter((t) => !selected.tags?.some((st) => st.id === t.id)).map((t) => (
                          <option key={t.id} value={t.id} className="bg-[#0f1623]">{t.name}</option>
                        ))}
                        <option value="__new" className="bg-[#0f1623]">＋ criar nova</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startReply(selected)} title="Responder"
                      className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/5"><Reply size={14} /></button>
                    {(selected.folder === "INBOX" || selected.folder === "IMPORTANT") && (
                      <button onClick={() => moveTo(selected.id, "ARCHIVE")} title="Resolvido (arquivar)"
                        className="rounded-lg border border-white/10 p-1.5 text-emerald-300 hover:bg-white/5"><Check size={14} /></button>
                    )}
                    {selected.folder !== "IMPORTANT" && selected.folder !== "SENT" && (
                      <button onClick={() => moveTo(selected.id, "IMPORTANT")} title="Marcar como importante"
                        className="rounded-lg border border-white/10 p-1.5 text-amber-300 hover:bg-white/5"><Star size={14} /></button>
                    )}
                    {selected.folder !== "SPAM" && selected.folder !== "SENT" && selected.direction === "IN" && (
                      <button onClick={() => moveTo(selected.id, "SPAM")} title="Spam (bloqueia o remetente)"
                        className="rounded-lg border border-white/10 p-1.5 text-orange-300 hover:bg-white/5"><AlertOctagon size={14} /></button>
                    )}
                    {(selected.folder === "SPAM" || selected.folder === "TRASH" || selected.folder === "ARCHIVE") && (
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
              {selected.attachments?.length > 0 && (
                <div className="px-4 py-2 border-b border-white/10 flex flex-wrap gap-1.5">
                  {selected.attachments.map((a) => (
                    <a key={a.id} href={`/api/email/inbox/attachments/${a.id}`} target="_blank" rel="noopener noreferrer"
                      title={a.contentType}
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-indigo-200 hover:bg-white/10">
                      📎 <span className="truncate max-w-[200px]">{a.filename}</span>
                      <span className="text-slate-500">({fmtSize(a.size)})</span>
                    </a>
                  ))}
                </div>
              )}
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
              {activeAccounts.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-8">De:</span>
                  <select value={compose.accountId} onChange={(e) => setCompose((c) => ({ ...c, accountId: e.target.value }))}
                    className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id} className="bg-[#0f1623]">
                        {a.label ? `${a.label} — ${a.fromEmail}` : a.fromEmail}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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

      {/* Modal: resumo IA */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAiOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-indigo-400/20 bg-[#0f1623] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <Sparkles size={15} className="text-indigo-400" /> Resumo da caixa de entrada
              </h3>
              <button onClick={() => setAiOpen(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            {aiLoading && (
              <p className="text-slate-400 text-sm py-4 text-center">Analisando seus emails… <span className="animate-pulse">✨</span></p>
            )}
            {aiError && <p className="text-red-400 text-sm">{aiError}</p>}
            {!aiLoading && aiDigest && (
              <>
                <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{aiDigest}</p>
                <p className="text-[10px] text-slate-500 mt-3">
                  Cada email da Entrada ganhou etiqueta de importância (🔥 alta / normal / baixa) e um resumo de 1 linha.
                  A análise consome 1 interação da cota de IA da empresa.
                </p>
              </>
            )}
            <div className="flex justify-end mt-3">
              <button onClick={() => setAiOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: regras de remetente (blacklist/whitelist) */}
      {rulesOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setRulesOpen(false)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0f1623] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white text-sm font-semibold">Regras de remetente</h3>
              <button onClick={() => setRulesOpen(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              <b>Blacklist</b>: emails do remetente caem direto no Spam (marcar um email como spam também cria a regra).
              <b> Whitelist</b>: remetente confiável, nunca vai pro Spam automático.
            </p>

            <div className="flex gap-2 mb-3">
              <input value={ruleForm.fromEmail} onChange={(e) => setRuleForm((f) => ({ ...f, fromEmail: e.target.value }))}
                placeholder="email@dominio.com" type="email"
                onKeyDown={(e) => { if (e.key === "Enter" && ruleForm.fromEmail.trim()) addRule(); }}
                className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              <select value={ruleForm.type} onChange={(e) => setRuleForm((f) => ({ ...f, type: e.target.value as "BLOCK" | "ALLOW" }))}
                className="rounded-lg bg-white/5 border border-white/10 px-2 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                <option value="BLOCK" className="bg-[#0f1623]">Bloquear</option>
                <option value="ALLOW" className="bg-[#0f1623]">Liberar</option>
              </select>
              <button onClick={addRule} disabled={ruleSaving || !ruleForm.fromEmail.trim()}
                className="rounded-lg bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-50">
                {ruleSaving ? "…" : "Adicionar"}
              </button>
            </div>
            {ruleMsg && <p className={`text-xs mb-2 ${ruleMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{ruleMsg.text}</p>}

            <div className="space-y-1.5">
              {rules.length === 0 && <p className="text-slate-500 text-sm">Nenhuma regra ainda.</p>}
              {rules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  {r.type === "BLOCK"
                    ? <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 flex-shrink-0"><ShieldBan size={10} /> bloqueado</span>
                    : <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 flex-shrink-0"><ShieldCheck size={10} /> liberado</span>}
                  <span className="text-sm text-white truncate flex-1">{r.fromEmail}</span>
                  <button onClick={() => deleteRule(r.id)} title="Remover regra"
                    className="rounded-lg border border-white/10 p-1 text-slate-400 hover:bg-white/5 hover:text-red-300 flex-shrink-0"><X size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: gerenciar contas */}
      {accountsOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAccountsOpen(false)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0f1623] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-sm font-semibold">Contas de email</h3>
              <button onClick={() => setAccountsOpen(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>

            {editingId === null && (
              <>
                <div className="space-y-2 mb-3">
                  {accountsFull.length === 0 && (
                    <p className="text-slate-500 text-sm">Nenhuma conta cadastrada ainda.</p>
                  )}
                  {accountsFull.map((a) => (
                    <div key={a.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 flex items-center gap-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${accountColor(a.id)}`}>
                        <AtSign size={10} className="inline mr-0.5" />{accountName(a)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm truncate">{a.fromEmail}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          SMTP {a.smtpVerified ? "✓" : "não testado"} · {a.imapHost ? `IMAP ${a.imapVerified ? "✓" : "não testado"}` : "sem IMAP"}
                          {!a.active && " · pausada"}
                          {a.lastError && <span className="text-red-400"> · {a.lastError}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => testAccount(a.id)} disabled={accTestingId === a.id}
                          className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50">
                          {accTestingId === a.id ? "Testando…" : "Testar"}
                        </button>
                        <button onClick={() => startEditAccount(a)} title="Editar"
                          className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/5"><Pencil size={13} /></button>
                        <button onClick={() => deleteAccount(a.id, a.fromEmail)} title="Remover"
                          className="rounded-lg border border-white/10 p-1.5 text-red-300 hover:bg-white/5"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
                {accMsg && <p className={`text-xs mb-2 ${accMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{accMsg.text}</p>}
                <button onClick={startNewAccount}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-400">
                  <Plus size={14} /> Adicionar conta
                </button>
              </>
            )}

            {editingId !== null && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input value={accForm.label} onChange={(e) => setAccForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="Etiqueta (ex: Comercial)"
                    className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                  <input value={accForm.fromName} onChange={(e) => setAccForm((f) => ({ ...f, fromName: e.target.value }))}
                    placeholder="Nome do remetente"
                    className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                </div>
                <input value={accForm.fromEmail} onChange={(e) => setAccForm((f) => ({ ...f, fromEmail: e.target.value }))}
                  placeholder="Endereço de email (ex: comercial@suaempresa.com.br)" type="email"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={accForm.user} onChange={(e) => setAccForm((f) => ({ ...f, user: e.target.value }))}
                    placeholder="Usuário (geralmente o email)"
                    className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                  <input value={accForm.pass} onChange={(e) => setAccForm((f) => ({ ...f, pass: e.target.value }))}
                    placeholder={editingId !== "new" ? "Senha (vazio = manter)" : "Senha"} type="password"
                    className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Envio (SMTP)</p>
                  <div className="grid grid-cols-[1fr_80px_auto] gap-2 items-center">
                    <input value={accForm.smtpHost} onChange={(e) => setAccForm((f) => ({ ...f, smtpHost: e.target.value }))}
                      placeholder="smtp.seudominio.com"
                      className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                    <input value={accForm.smtpPort} onChange={(e) => setAccForm((f) => ({ ...f, smtpPort: e.target.value }))}
                      placeholder="465" inputMode="numeric"
                      className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                    <label className="flex items-center gap-1.5 text-xs text-slate-400">
                      <input type="checkbox" checked={accForm.smtpSecure} onChange={(e) => setAccForm((f) => ({ ...f, smtpSecure: e.target.checked }))} />
                      SSL
                    </label>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Recebimento (IMAP) — opcional</p>
                  <div className="grid grid-cols-[1fr_80px_auto] gap-2 items-center">
                    <input value={accForm.imapHost} onChange={(e) => setAccForm((f) => ({ ...f, imapHost: e.target.value }))}
                      placeholder="imap.seudominio.com (vazio = só envio)"
                      className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                    <input value={accForm.imapPort} onChange={(e) => setAccForm((f) => ({ ...f, imapPort: e.target.value }))}
                      placeholder="993" inputMode="numeric"
                      className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                    <label className="flex items-center gap-1.5 text-xs text-slate-400">
                      <input type="checkbox" checked={accForm.imapSecure} onChange={(e) => setAccForm((f) => ({ ...f, imapSecure: e.target.checked }))} />
                      SSL
                    </label>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={accForm.active} onChange={(e) => setAccForm((f) => ({ ...f, active: e.target.checked }))} />
                  Conta ativa (envia e sincroniza)
                </label>

                {accMsg && <p className={`text-xs ${accMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{accMsg.text}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setEditingId(null); setAccMsg(null); }}
                    className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Voltar</button>
                  <button onClick={() => saveAccount(false)} disabled={accSaving}
                    className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">Salvar</button>
                  <button onClick={() => saveAccount(true)} disabled={accSaving}
                    className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-50">
                    {accSaving ? "Salvando…" : "Salvar e testar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
