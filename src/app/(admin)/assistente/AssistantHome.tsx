"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/* ── tipos espelhando as APIs ─────────────────────────────────────────────── */
interface ExecutedAction { tool: string; ok: boolean; message: string; link?: string }
interface ChatMsg { role: "user" | "assistant"; content: string; actions?: ExecutedAction[]; transcribed?: boolean }
interface Pending { id: string; summary: string }
type Quadrant = "fazer" | "agendar" | "delegar" | "eliminar";
interface FilaItem { id: string; kind: string; title: string; sub?: string; when?: string | null; overdue?: boolean; link?: string; quadrant?: Quadrant; noteId?: string; fromRoutine?: boolean }
interface Fila { esperandoPorMim: FilaItem[]; hoje: FilaItem[]; atrasadosAntigos: FilaItem[]; followUps: FilaItem[]; semProximaAcao: FilaItem[]; financeiro: FilaItem[]; bloquinho: FilaItem[]; generatedAt: string }
interface CompanyUser { id: string; name: string }
const QUAD: Record<Quadrant, { icon: string; label: string; hint: string; cls: string }> = {
  fazer:    { icon: "🔥", label: "Fazer",    hint: "importante e urgente",     cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  agendar:  { icon: "📅", label: "Agendar",  hint: "importante, sem urgência", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  delegar:  { icon: "👉", label: "Delegar",  hint: "urgente, não precisa ser você", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  eliminar: { icon: "🗑️", label: "Eliminar", hint: "nem importante nem urgente", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};
const QUAD_FLAGS: Record<Quadrant, { important: boolean; urgent: boolean }> = {
  fazer: { important: true, urgent: true }, agendar: { important: true, urgent: false },
  delegar: { important: false, urgent: true }, eliminar: { important: false, urgent: false },
};
const quadrantOf = (n: { important?: boolean; urgent?: boolean }): Quadrant => (n.important ?? true) ? ((n.urgent ?? false) ? "fazer" : "agendar") : ((n.urgent ?? false) ? "delegar" : "eliminar");
function plusDays(d: number, hour = 9): string { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(hour, 0, 0, 0); return x.toISOString(); }
interface NoteEvent { id: string; type: "CREATED" | "EDITED" | "DONE" | "REOPENED" | string; detail: string | null; source: string; createdAt: string }
interface Note { id: string; kind: string; title: string; body: string | null; dueAt: string | null; done: boolean; doneAt?: string | null; doneNote?: string | null; createdAt: string; tags: string[]; events?: NoteEvent[]; important?: boolean; urgent?: boolean; archivedAt?: string | null; source?: string }

const EVENT_LABEL: Record<string, string> = { CREATED: "criado", EDITED: "editado", APPENDED: "acrescentado", DONE: "concluído", REOPENED: "reaberto" };
const SOURCE_LABEL: Record<string, string> = { APP: "no app", WHATSAPP: "pelo WhatsApp", MCP: "pelo Claude", WEBHOOK: "por rotina externa", IPHONE: "no iPhone" };

const KIND_ICON: Record<string, string> = { IDEA: "💡", NOTE: "📝", REMINDER: "⏰", TASK: "☑️" };
const KIND_LABEL: Record<string, string> = { IDEA: "Ideia", NOTE: "Nota", REMINDER: "Lembrete", TASK: "Tarefa" };

/** Links pra fora do assistente (conversa, chamado, lead…) abrem em nova aba —
 *  assim o assistente fica aberto e não precisa voltar toda vez. */
function linkProps(link?: string | null): { href: string; target?: string; rel?: string } {
  if (!link) return { href: "#" };
  let href = link;
  try { if (/^https?:/.test(link)) { const u = new URL(link); href = u.pathname + u.search + u.hash; } } catch {}
  return href.startsWith("/assistente") ? { href } : { href, target: "_blank", rel: "noopener" };
}

function fmtWhen(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Render leve: quebra de linha + links clicáveis + **negrito**. */
function RichText({ text }: { text: string }) {
  // [texto](url) · URL solta · **negrito**
  const parts = text.split(/(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\)|https?:\/\/[^\s)]+|\*\*[^*]+\*\*)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        const md = p.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)$/);
        if (md) {
          let href = md[2]; try { if (/^https?:/.test(href)) { const u = new URL(href); href = u.pathname + u.search; } } catch {}
          return <a key={i} {...linkProps(href)} className="text-indigo-300 underline hover:text-indigo-200">{md[1]}</a>;
        }
        if (/^https?:\/\//.test(p)) {
          let href = p; try { const u = new URL(p); href = u.pathname + u.search; } catch {}
          return <a key={i} {...linkProps(href)} className="text-indigo-300 underline hover:text-indigo-200">{p.replace(/^https?:\/\/[^/]+/, "")}</a>;
        }
        if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i} className="text-white">{p.slice(2, -2)}</b>;
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

export default function AssistantHome({ userName, whatsappLinked, aiConfigured, canConfigureAi, hasCompany, spend }: {
  userName: string; whatsappLinked: boolean; aiConfigured: boolean; canConfigureAi: boolean; hasCompany: boolean;
  spend?: { todayUSD: number; monthUSD: number; todayCalls: number; model: string | null } | null;
}) {
  const usd = (v: number) => `US$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 0.1 ? 4 : 2 })}`;
  const search = useSearchParams()!; // nunca nulo no App Router (o tipo vira nullable porque existe src/pages)
  const aba = search.get("aba");
  const [tab, setTab] = useState<"fila" | "bloquinho" | "entrada">(aba === "bloquinho" ? "bloquinho" : aba === "entrada" ? "entrada" : "fila");

  /* ── chat ── */
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ── áudio ── */
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  /* ── fila + bloquinho ── */
  const [fila, setFila] = useState<Fila | null>(null);
  const [filaLoading, setFilaLoading] = useState(true);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [noteKind, setNoteKind] = useState<"TASK" | "IDEA" | "NOTE" | "REMINDER">("TASK");
  const [noteDue, setNoteDue] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [noteTags, setNoteTags] = useState("");
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [quadFilter, setQuadFilter] = useState<Quadrant | null>(null);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [matrixSrc, setMatrixSrc] = useState<MatrixSrc>("meu");
  const [chatOpen, setChatOpen] = useState(false);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [triage, setTriage] = useState(false);
  const [noteMore, setNoteMore] = useState(false);

  const loadFila = useCallback(async () => {
    setFilaLoading(true);
    try { const r = await fetch("/api/assistente/fila"); if (r.ok) setFila(await r.json()); } finally { setFilaLoading(false); }
  }, []);
  const loadNotes = useCallback(async () => {
    const qs = new URLSearchParams();
    if (showDone) qs.set("done", "1");
    if (showArchived) qs.set("archived", "all");
    const r = await fetch(`/api/assistente/notas?${qs}`); if (r.ok) setNotes(await r.json());
  }, [showDone, showArchived]);
  useEffect(() => { loadNotes(); }, [loadNotes]);
  useEffect(() => { fetch("/api/assistente/usuarios").then(async (r) => { if (r.ok) setUsers(await r.json()); }).catch(() => {}); }, []);

  /** Ações rápidas de um item (lista, entrada, fila e triagem). */
  async function quick(id: string, op: "done" | "reopen" | "tomorrow" | "week" | "nodate" | "archive" | "unarchive" | "delete" | { set: Partial<{ important: boolean; urgent: boolean }> } | { delegate: string }) {
    let r: Response;
    if (op === "delete") { if (!confirm("Excluir este item?")) return; r = await fetch(`/api/assistente/notas/${id}`, { method: "DELETE" }); }
    else if (typeof op === "object" && "delegate" in op) r = await fetch(`/api/assistente/notas/${id}/delegar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assigneeId: op.delegate }) });
    else {
      const patch = op === "done" ? { done: true } : op === "reopen" ? { done: false } : op === "tomorrow" ? { dueAt: plusDays(1) } : op === "week" ? { dueAt: plusDays(7) } : op === "nodate" ? { dueAt: null } : op === "archive" ? { archived: true } : op === "unarchive" ? { archived: false } : op.set;
      r = await fetch(`/api/assistente/notas/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    }
    if (r.ok) { loadNotes(); loadFila(); }
    else { const j = await r.json().catch(() => ({})); alert(j.error ?? "Falhou"); }
  }

  async function saveNote(id: string, patch: Partial<Pick<Note, "title" | "body" | "dueAt" | "kind" | "tags">>) {
    const r = await fetch(`/api/assistente/notas/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (r.ok) { loadNotes(); loadFila(); }
    return r.ok;
  }

  useEffect(() => {
    fetch("/api/assistente/chat").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      setHistory((j.history ?? []).map((t: any) => ({ role: t.role, content: t.content })));
      setPending(j.pending ?? null);
    });
    loadFila(); loadNotes();
  }, [loadFila, loadNotes]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, sending, chatOpen]);
  useEffect(() => { if (chatOpen) setTimeout(() => inputRef.current?.focus(), 50); }, [chatOpen]);
  // Ctrl/⌘ K abre o assistente; Esc fecha (menos durante a gravação)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setChatOpen(true); }
      else if (e.key === "Escape" && recRef.current?.state !== "recording") setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(text: string, transcribed = false) {
    const t = text.trim();
    if (!t || sending) return;
    setInput(""); setChatErr(null); setSending(true);
    setHistory((h) => [...h, { role: "user", content: t, transcribed }]);
    try {
      const res = await fetch("/api/assistente/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setChatErr(j.error ?? "Erro ao processar."); return; }
      setHistory((h) => [...h, { role: "assistant", content: j.reply, actions: j.actions }]);
      setPending(j.pending ?? null);
      if ((j.actions?.length ?? 0) > 0) { loadFila(); loadNotes(); }
    } catch { setChatErr("Erro de conexão."); }
    finally { setSending(false); inputRef.current?.focus(); }
  }

  async function resolvePending(op: "confirm" | "cancel") {
    setSending(true);
    try {
      const res = await fetch("/api/assistente/acoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op }) });
      const j = await res.json().catch(() => ({}));
      setHistory((h) => [...h, { role: "assistant", content: j.ok ? j.message : `Erro: ${j.error ?? "falhou"}`, actions: j.ok && op === "confirm" ? [{ tool: "confirm", ok: true, message: j.message, link: j.link }] : undefined }]);
      setPending(null);
      if (op === "confirm") loadFila();
    } finally { setSending(false); }
  }

  async function toggleRecording() {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1000) return;
        setTranscribing(true);
        try {
          const fd = new FormData(); fd.append("file", blob, "audio.webm");
          const res = await fetch("/api/assistente/transcrever", { method: "POST", body: fd });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j.text) { setChatErr(j.error ?? "Não consegui transcrever."); return; }
          await send(j.text, true);
        } finally { setTranscribing(false); }
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch { setChatErr("Microfone indisponível (permissão negada?)."); }
  }

  async function addNote() {
    const title = noteInput.trim(); if (!title) return;
    const body: any = { kind: noteKind, title, tags: noteTags };
    if (noteDue && (noteKind === "REMINDER" || noteKind === "TASK")) body.dueAt = new Date(noteDue).toISOString();
    const r = await fetch("/api/assistente/notas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { setNoteInput(""); setNoteDue(""); setNoteTags(""); loadNotes(); loadFila(); }
  }
  async function toggleNote(n: Note, doneNote?: string) {
    await fetch(`/api/assistente/notas/${n.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: !n.done, ...(doneNote ? { doneNote } : {}) }) });
    loadNotes(); loadFila();
  }
  async function deleteNote(n: Note) {
    await fetch(`/api/assistente/notas/${n.id}`, { method: "DELETE" });
    loadNotes(); loadFila();
  }

  const firstName = userName.split(" ")[0];
  /** Clique num card da matriz: abre o item na lista da esquerda. */
  function openFromMatrix(n: Note) {
    setTab(isRoutine(n) ? "entrada" : "bloquinho");
    setQuadFilter(null); setKindFilter(null); setTagFilter(null);
    setOpenNote(n.id);
    setTimeout(() => document.getElementById(`note-${n.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }
  const isRoutine = (n: Note) => n.source === "MCP" || n.source === "WEBHOOK";
  const myNotes = notes.filter((n) => !isRoutine(n));
  const inboxNotes = notes.filter(isRoutine);
  const pool = tab === "entrada" ? inboxNotes : myNotes;
  const allTags = [...new Set(pool.flatMap((n) => n.tags ?? []))].sort();
  const visibleNotes = pool
    .filter((n) => !tagFilter || (n.tags ?? []).includes(tagFilter))
    .filter((n) => !quadFilter || quadrantOf(n) === quadFilter)
    .filter((n) => !kindFilter || n.kind === kindFilter);
  const totalFila = fila ? fila.esperandoPorMim.length + fila.hoje.length + fila.followUps.length + fila.semProximaAcao.length + fila.financeiro.length : 0;
  const openCount = (arr: Note[]) => arr.filter((n) => !n.done && !n.archivedAt).length;

  return (
    <div className="min-h-screen bg-[#080b12] text-white p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500/30 to-pink-500/30 border border-fuchsia-500/40 flex items-center justify-center text-xl">🤖</div>
          <div>
            <h1 className="text-lg font-bold">Assistente</h1>
            <p className="text-xs text-slate-500">Seu bloquinho, sua memória e suas mãos no GoHub. Fale ou escreva.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {whatsappLinked
            ? <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">📱 WhatsApp vinculado</span>
            : <Link href="/configuracoes?secao=meu-perfil" className="px-2.5 py-1 rounded-full bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white">📱 Vincular grupo do WhatsApp →</Link>}
          <Link href="/configuracoes?secao=meu-perfil" className="px-2.5 py-1 rounded-full bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white">🔌 Claude (MCP)</Link>
          <Link href="/assistente/atendimento" className="px-2.5 py-1 rounded-full bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white">Análise de atendimento →</Link>
          {spend && (
            <Link href={canConfigureAi ? "/configuracoes?secao=integracoes-openai" : "#"} title={`Gasto estimado do assistente · ${spend.todayCalls} chamada(s) hoje${spend.model ? ` · modelo ${spend.model}` : ""}`} className="px-2.5 py-1 rounded-full bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white tabular-nums">
              💸 hoje {usd(spend.todayUSD)} · mês {usd(spend.monthUSD)}
            </Link>
          )}
        </div>
      </div>

      {!aiConfigured && (
        <div className="px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">
          ⚠️ A chave do provedor de IA do assistente ainda não foi configurada — o chat não vai responder.
          {canConfigureAi ? <> Configure em <Link href="/configuracoes?secao=integracoes-openai" className="underline">Configurações → Integrações → OpenAI / Anthropic</Link>.</> : " Peça ao administrador da plataforma."}
        </div>
      )}
      {!hasCompany && (
        <div className="px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm">Seu usuário não está vinculado a uma empresa — o assistente não tem onde agir.</div>
      )}

      {/* ── Acesso ao assistente (o chat abre num modal) ── */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-fuchsia-600/20 via-fuchsia-600/10 to-indigo-600/10 border border-fuchsia-500/35 rounded-2xl p-2 pl-4 shadow-lg shadow-fuchsia-900/10">
        <span className="text-lg">🤖</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { e.preventDefault(); setChatOpen(true); send(input); } }}
          placeholder={`${firstName}, fale ou escreva: "me lembra…", "anota…", "abre chamado…", "o que tenho hoje?"`}
          className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none py-2"
        />
        {pending && <button onClick={() => setChatOpen(true)} className="text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 whitespace-nowrap">⚠️ confirmar</button>}
        {history.length > 0 && <button onClick={() => setChatOpen(true)} title="Abrir a conversa" className="hidden sm:block text-[11px] px-2.5 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white whitespace-nowrap">💬 conversa</button>}
        <button onClick={() => { setChatOpen(true); toggleRecording(); }} disabled={sending || transcribing} title="Gravar áudio" className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-[#161f30] border border-[#1e2d45] text-slate-200 hover:border-fuchsia-500/50 disabled:opacity-40">🎙️</button>
        <button onClick={() => { setChatOpen(true); if (input.trim()) send(input); }} title="Abrir o assistente (Ctrl/⌘ K)" className="h-10 flex-shrink-0 px-4 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-sm font-semibold whitespace-nowrap">{input.trim() ? "Enviar ➤" : "Abrir"}</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ── Fila / Bloquinho / Entrada ── */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center gap-1 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-1">
            {([
              ["fila", "Fila do dia", fila ? totalFila : null],
              ["bloquinho", "Bloquinho", openCount(myNotes)],
              ["entrada", "Entrada", openCount(inboxNotes)],
            ] as [typeof tab, string, number | null][]).map(([key, label, count]) => (
              <button key={key} onClick={() => { setTab(key); setQuadFilter(null); setKindFilter(null); setTagFilter(null); }} className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${tab === key ? "bg-fuchsia-600/20 text-white border border-fuchsia-500/30" : "text-slate-400 hover:text-white"}`}>
                {label} {count !== null && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[#1a2535] text-slate-300">{count}</span>}
              </button>
            ))}
          </div>

          {tab === "fila" && (
            <div className="space-y-3">
              {filaLoading && !fila && <div className="text-xs text-slate-500 px-1">Montando a fila…</div>}
              {fila && totalFila === 0 && fila.atrasadosAntigos.length === 0 && <div className="bg-[#0f1623] border border-emerald-500/25 rounded-xl p-4 text-sm text-emerald-200">Nada pedindo ação agora. ✅</div>}
              {fila && fila.atrasadosAntigos.length > 0 && (
                <div className="bg-[#0f1623] border border-amber-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-amber-200"><b>{fila.atrasadosAntigos.length}</b> atrasado(s) há mais de 7 dias. Não estão em "Hoje" de propósito: decida o destino de cada um.</div>
                  <button onClick={() => setTriage(true)} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-black font-semibold hover:bg-amber-400 whitespace-nowrap">Triagem →</button>
                </div>
              )}
              {fila && ([
                ["⏳ Esperando por você", fila.esperandoPorMim],
                ["📅 Hoje", fila.hoje],
                ["🔁 Follow-ups", fila.followUps],
                ["🕳️ Sem próxima ação", fila.semProximaAcao],
                ["💰 Financeiro", fila.financeiro],
              ] as [string, FilaItem[]][]).map(([title, items]) => items.length > 0 && (
                <div key={title} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">{items.length}</span>
                  </div>
                  <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-0.5">
                    {items.map((it) => (
                      <div key={it.id} className="group flex items-start gap-2 px-2.5 py-2 rounded-lg bg-[#131c2c] hover:bg-[#182234] border border-transparent hover:border-[#253449] transition-colors">
                        {it.quadrant && <span title={QUAD[it.quadrant].hint} className="text-xs leading-none mt-0.5">{QUAD[it.quadrant].icon}</span>}
                        <a {...linkProps(it.link)} onClick={(e) => { const n = it.noteId && notes.find((x) => x.id === it.noteId); if (n) { e.preventDefault(); openFromMatrix(n); } }} className="flex-1 min-w-0">
                          <div className={`text-xs truncate ${it.overdue ? "text-red-300" : "text-slate-200"}`}>{it.overdue ? "⚠️ " : ""}{it.title}</div>
                          {(it.sub || it.when) && <div className="text-[10px] text-slate-500 truncate">{it.sub}{it.sub && it.when ? " · " : ""}{fmtWhen(it.when)}{it.fromRoutine ? " · rotina" : ""}</div>}
                        </a>
                        {it.noteId && (
                          <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => quick(it.noteId!, "done")} title="Feito" className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/50">✓</button>
                            <button onClick={() => quick(it.noteId!, "tomorrow")} title="Adiar pra amanhã" className="text-[11px] px-1.5 py-0.5 rounded bg-[#1a2535] text-slate-300 hover:text-white">+1d</button>
                            <button onClick={() => quick(it.noteId!, "week")} title="Adiar 7 dias" className="text-[11px] px-1.5 py-0.5 rounded bg-[#1a2535] text-slate-300 hover:text-white">+7d</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={loadFila} className="text-[11px] text-slate-500 hover:text-slate-300 px-1">↻ atualizar</button>
            </div>
          )}

          {(tab === "bloquinho" || tab === "entrada") && (
            <div className="space-y-3">
              {tab === "bloquinho" ? (
                <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-3 space-y-2">
                  <div className="flex gap-2">
                    <select value={noteKind} onChange={(e) => setNoteKind(e.target.value as any)} className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-2 py-2 text-xs text-white">
                      <option value="TASK">☑️</option><option value="IDEA">💡</option><option value="NOTE">📝</option><option value="REMINDER">⏰</option>
                    </select>
                    <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} placeholder="Anotar rápido e seguir…" autoFocus className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-fuchsia-500/50" />
                    <button onClick={() => setNoteMore((v) => !v)} title="Prazo e etiquetas" className={`px-2 rounded-lg border text-xs ${noteMore ? "border-fuchsia-500/40 text-white" : "border-[#1e2d45] text-slate-400 hover:text-white"}`}>⋯</button>
                    <button onClick={addNote} disabled={!noteInput.trim()} className="px-3 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs disabled:opacity-40">+</button>
                  </div>
                  {noteMore && (
                    <div className="flex gap-2">
                      <input type="datetime-local" value={noteDue} onChange={(e) => setNoteDue(e.target.value)} className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-slate-300" />
                      <input value={noteTags} onChange={(e) => setNoteTags(e.target.value)} placeholder="etiquetas: pessoal, financeiro…" className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-slate-300 placeholder-slate-600" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 px-1">O que chegou das rotinas (Gmail, reels, alertas, Claude). Trie: ✓ feito · ⏩ adiar · 👉 delegar · 🗄️ arquivar. Diga no chat "sempre que chegar X, faça Y" pra automatizar.</div>
              )}

              {/* Matriz de Eisenhower — filtro + visão */}
              <div className="flex flex-wrap items-center gap-1.5 px-1">
                <button onClick={() => setQuadFilter(null)} className={`text-[10px] px-2 py-0.5 rounded-full border ${!quadFilter ? "bg-fuchsia-600/25 border-fuchsia-500/40 text-white" : "bg-[#131c2c] border-[#253449] text-slate-400 hover:text-white"}`}>todos</button>
                {(Object.keys(QUAD) as Quadrant[]).map((q) => {
                  const n = pool.filter((x) => !x.done && !x.archivedAt && quadrantOf(x) === q).length;
                  return <button key={q} onClick={() => setQuadFilter(quadFilter === q ? null : q)} title={QUAD[q].hint} className={`text-[10px] px-2 py-0.5 rounded-full border ${quadFilter === q ? QUAD[q].cls : "bg-[#131c2c] border-[#253449] text-slate-400 hover:text-white"}`}>{QUAD[q].icon} {QUAD[q].label} {n > 0 && <span className="opacity-70">{n}</span>}</button>;
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 px-1">
                {(["TASK", "REMINDER", "IDEA", "NOTE"] as const).map((k) => {
                  const n = pool.filter((x) => !x.done && !x.archivedAt && x.kind === k).length;
                  return n > 0 && <button key={k} onClick={() => setKindFilter(kindFilter === k ? null : k)} className={`text-[10px] px-2 py-0.5 rounded-full border ${kindFilter === k ? "bg-fuchsia-600/25 border-fuchsia-500/40 text-white" : "bg-[#131c2c] border-[#253449] text-slate-400 hover:text-white"}`}>{KIND_ICON[k]} {KIND_LABEL[k]} {n}</button>;
                })}
                {allTags.slice(0, 8).map((t) => (
                  <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)} className={`text-[10px] px-2 py-0.5 rounded-full border ${tagFilter === t ? "bg-fuchsia-600/25 border-fuchsia-500/40 text-white" : "bg-[#131c2c] border-[#253449] text-slate-500 hover:text-white"}`}>#{t}</button>
                ))}
                <span className="flex-1" />
                <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-fuchsia-500" /> concluídas</label>
                <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-fuchsia-500" /> arquivadas</label>
              </div>

              <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-2 space-y-1 max-h-[600px] overflow-y-auto">
                {visibleNotes.length === 0 && <div className="text-xs text-slate-500 px-2 py-3">{tab === "entrada" ? "Nada chegou das rotinas." : quadFilter || tagFilter || kindFilter ? "Nada com esse filtro." : "Bloquinho vazio. Anote acima ou mande \"anota: …\" no WhatsApp."}</div>}
                {visibleNotes.map((n) => (
                  <div key={n.id} id={`note-${n.id}`}><NoteItem
                    note={n}
                    users={users}
                    open={openNote === n.id}
                    onToggleOpen={() => setOpenNote(openNote === n.id ? null : n.id)}
                    onToggleDone={(doneNote) => toggleNote(n, doneNote)}
                    onDelete={() => { if (confirm("Excluir este item?")) deleteNote(n); }}
                    onSave={(patch) => saveNote(n.id, patch)}
                    onQuick={(op) => quick(n.id, op)}
                  /></div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Matriz de Eisenhower ── */}
        <div className="lg:col-span-7 lg:sticky lg:top-4">
          <EisenhowerMatrix
            notes={notes.filter((n) => !n.done && !n.archivedAt && (matrixSrc === "tudo" || (matrixSrc === "rotinas") === isRoutine(n)))}
            src={matrixSrc}
            onSrc={setMatrixSrc}
            onOpen={openFromMatrix}
            onMove={(id, q) => {
              const set = QUAD_FLAGS[q];
              setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...set } : n)));
              quick(id, { set });
            }}
            onQuick={(id, op) => quick(id, op)}
            onFilter={(q) => { if (tab === "fila") setTab(matrixSrc === "rotinas" ? "entrada" : "bloquinho"); setQuadFilter(quadFilter === q ? null : q); }}
            activeFilter={tab === "fila" ? null : quadFilter}
          />
        </div>
      </div>

      {/* ── Triagem dos atrasados antigos ── */}
      {triage && fila && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setTriage(false)}>
          <div className="w-full max-w-3xl bg-[#0f1623] border border-[#1e2d45] rounded-2xl mt-6" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <div>
                <h2 className="font-bold">Triagem · {fila.atrasadosAntigos.length} atrasado(s) há mais de 7 dias</h2>
                <p className="text-xs text-slate-500">Pra cada um: já fiz · adiar · delegar · arquivar. O que sobrar continua aqui.</p>
              </div>
              <button onClick={() => setTriage(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-3 space-y-1 max-h-[70vh] overflow-y-auto">
              {fila.atrasadosAntigos.length === 0 && <div className="text-sm text-emerald-200 px-2 py-4">Tudo triado. ✅</div>}
              {fila.atrasadosAntigos.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-[#131c2c]">
                  {it.quadrant && <span title={QUAD[it.quadrant].hint} className="text-xs">{QUAD[it.quadrant].icon}</span>}
                  <a {...linkProps(it.link)} className="flex-1 min-w-[200px]">
                    <div className="text-xs text-slate-200 truncate">{it.title}</div>
                    <div className="text-[10px] text-slate-500">{it.sub}{it.sub ? " · " : ""}venceu {fmtWhen(it.when)}{it.fromRoutine ? " · rotina" : ""}</div>
                  </a>
                  {it.noteId ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      <button onClick={() => quick(it.noteId!, "done")} className="text-[11px] px-2 py-1 rounded bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/50">✓ feito</button>
                      <button onClick={() => quick(it.noteId!, "tomorrow")} className="text-[11px] px-2 py-1 rounded bg-[#1a2535] text-slate-300 hover:text-white">amanhã</button>
                      <button onClick={() => quick(it.noteId!, "week")} className="text-[11px] px-2 py-1 rounded bg-[#1a2535] text-slate-300 hover:text-white">+7d</button>
                      <button onClick={() => quick(it.noteId!, "nodate")} className="text-[11px] px-2 py-1 rounded bg-[#1a2535] text-slate-300 hover:text-white" title="Tira o prazo: fica no bloquinho sem entrar em Hoje">sem prazo</button>
                      {users.length > 0 && (
                        <select defaultValue="" onChange={(e) => { if (e.target.value) quick(it.noteId!, { delegate: e.target.value }); }} className="text-[11px] px-1.5 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-200">
                          <option value="">👉 delegar…</option>
                          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => quick(it.noteId!, "archive")} className="text-[11px] px-2 py-1 rounded bg-[#1a2535] text-slate-400 hover:text-white">🗄️</button>
                    </div>
                  ) : (
                    <a {...linkProps(it.link)} className="text-[11px] px-2 py-1 rounded bg-[#1a2535] text-slate-300 hover:text-white">abrir →</a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Chat (modal) ── */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={() => { if (!recording) setChatOpen(false); }}>
          <div className="w-full max-w-2xl h-full bg-[#0f1623] border-l border-[#1e2d45] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#1e2d45] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-fuchsia-600/30 border border-fuchsia-500/40 flex items-center justify-center text-sm">🤖</span>
                <div>
                  <div className="text-sm font-semibold">Assistente</div>
                  <div className="text-[10px] text-slate-500">Esc fecha · Ctrl/⌘ K abre · o que ele criar aparece na hora na lista e na matriz</div>
                </div>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-white px-2">✕</button>
            </div>

            <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto">
              {history.length === 0 && !sending && (
                <div className="text-slate-500 text-sm py-6 space-y-3">
                  <p className="text-slate-300">Oi, {firstName}. Exemplos do que dá pra fazer:</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {[
                      "O que tenho pra hoje?",
                      "Anota: ideia de reels pro cliente Padaria sobre promoção de sexta",
                      "Me lembra amanhã às 9h de cobrar a aprovação da arte da Ótica",
                      "Abre chamado pra Clínica Sorriso: revisar banner do site, quinta 15h",
                      "Cria uma tarefa no projeto Site da Padaria: enviar wireframe, sexta",
                      "Como está o cliente Ótica Visão?",
                    ].map((ex) => (
                      <button key={ex} onClick={() => send(ex)} className="text-left text-xs px-3 py-2 rounded-lg bg-[#131c2c] border border-[#1e2d45] text-slate-300 hover:border-fuchsia-500/40 hover:text-white transition-colors">{ex}</button>
                    ))}
                  </div>
                </div>
              )}
              {history.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && <div className="w-6 h-6 rounded-full bg-fuchsia-600/30 border border-fuchsia-500/40 flex items-center justify-center text-xs mr-2 flex-shrink-0 mt-1">🤖</div>}
                  <div className={`max-w-[85%] space-y-2`}>
                    <div className={`rounded-xl px-4 py-3 text-sm ${m.role === "user" ? "bg-indigo-600 text-white rounded-tr-sm" : "bg-[#162033] border border-[#1e2d45] text-slate-200 rounded-tl-sm"}`}>
                      {m.transcribed && <div className="text-[10px] text-indigo-200/80 mb-1">🎙️ transcrito do áudio</div>}
                      <RichText text={m.content} />
                    </div>
                    {m.actions && m.actions.length > 0 && (
                      <div className="space-y-1">
                        {m.actions.map((a, j) => (
                          <div key={j} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${a.ok ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-200" : "bg-red-500/10 border-red-500/25 text-red-200"}`}>
                            <span>{a.ok ? "✅" : "❌"}</span>
                            <span className="flex-1 truncate">{a.message}</span>
                            {a.link && <a {...linkProps(a.link)} className="px-2 py-0.5 rounded bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">Abrir</a>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {pending && (
                <div className="ml-8 px-4 py-3 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-2">
                  <div className="text-xs font-semibold text-amber-200">Confirmação necessária</div>
                  <div className="text-sm text-amber-100">{pending.summary}</div>
                  <div className="flex gap-2">
                    <button onClick={() => resolvePending("confirm")} disabled={sending} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-black font-semibold hover:bg-amber-400 disabled:opacity-40">Confirmar</button>
                    <button onClick={() => resolvePending("cancel")} disabled={sending} className="text-xs px-3 py-1.5 rounded-lg border border-[#1e2d45] text-slate-300 hover:text-white disabled:opacity-40">Cancelar</button>
                  </div>
                </div>
              )}
              {(sending || transcribing) && (
                <div className="flex items-center gap-2 text-xs text-slate-500 ml-8">
                  <span className="w-1.5 h-1.5 bg-fuchsia-400 rounded-full animate-bounce" /><span className="w-1.5 h-1.5 bg-fuchsia-400 rounded-full animate-bounce [animation-delay:150ms]" /><span className="w-1.5 h-1.5 bg-fuchsia-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  {transcribing ? "transcrevendo…" : "pensando…"}
                </div>
              )}
              {chatErr && <p className="text-xs text-red-400 text-center">{chatErr}</p>}
              <div ref={bottomRef} />
            </div>
            <div className="px-4 py-3 border-t border-[#1e2d45] flex items-end gap-2">
              <button
                onClick={toggleRecording}
                disabled={sending || transcribing}
                title={recording ? "Parar e enviar" : "Gravar áudio"}
                className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border transition-colors ${recording ? "bg-red-600 border-red-500 text-white animate-pulse" : "bg-[#161f30] border-[#1e2d45] text-slate-300 hover:text-white hover:border-fuchsia-500/50"} disabled:opacity-40`}
              >
                {recording ? "■" : "🎙️"}
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                rows={1}
                placeholder={recording ? "Gravando… clique em ■ pra enviar" : "Escreva ou grave: \"me lembra…\", \"abre chamado…\", \"anota…\", \"o que tenho hoje?\""}
                className="flex-1 bg-[#0a1120] border border-[#1e2d45] rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-fuchsia-500/50"
                style={{ minHeight: 40, maxHeight: 120 }}
              />
              <button onClick={() => send(input)} disabled={sending || !input.trim()} className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white">➤</button>
            </div>
          </div>
        </div>
      )}

      {/* Acesso flutuante (quando a barra do topo sai da tela) */}
      {!chatOpen && (
        <button onClick={() => setChatOpen(true)} title="Assistente (Ctrl/⌘ K)" className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-2xl bg-fuchsia-600 hover:bg-fuchsia-500 text-2xl shadow-xl shadow-fuchsia-900/40 flex items-center justify-center">
          🤖{pending && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-[#080b12]" />}
        </button>
      )}
    </div>
  );
}

/* ── Matriz de Eisenhower (visão) ─────────────────────────────────────────── */
type MatrixSrc = "meu" | "rotinas" | "tudo";
const MATRIX_ORDER: Quadrant[] = ["fazer", "agendar", "delegar", "eliminar"]; // linhas: importante/não · colunas: urgente/não

function EisenhowerMatrix({ notes, src, onSrc, onOpen, onMove, onQuick, onFilter, activeFilter }: {
  notes: Note[]; src: MatrixSrc; onSrc: (s: MatrixSrc) => void;
  onOpen: (n: Note) => void; onMove: (id: string, q: Quadrant) => void;
  onQuick: (id: string, op: QuickOp) => void; onFilter: (q: Quadrant) => void; activeFilter: Quadrant | null;
}) {
  const [over, setOver] = useState<Quadrant | null>(null);
  const [now] = useState(() => Date.now());
  const byQuad = (q: Quadrant) => notes
    .filter((n) => quadrantOf(n) === q)
    .sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity));

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Matriz de Eisenhower</h3>
          <p className="text-[10px] text-slate-500">Arraste um item pra outro quadrante · clique pra abrir na lista</p>
        </div>
        <div className="flex items-center gap-0.5 bg-[#131c2c] border border-[#1e2d45] rounded-lg p-0.5">
          {([["meu", "Bloquinho"], ["rotinas", "Entrada"], ["tudo", "Tudo"]] as [MatrixSrc, string][]).map(([k, label]) => (
            <button key={k} onClick={() => onSrc(k)} className={`text-[10px] px-2 py-1 rounded-md ${src === k ? "bg-fuchsia-600/25 text-white" : "text-slate-400 hover:text-white"}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[18px_1fr_1fr] gap-2">
        <div />
        <div className="text-[10px] uppercase tracking-wider text-slate-500 text-center">Urgente</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 text-center">Não urgente</div>
        {MATRIX_ORDER.map((q, i) => {
          const items = byQuad(q);
          return [
            i % 2 === 0 && (
              <div key={`${q}-axis`} className="flex items-center justify-center">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 whitespace-nowrap [writing-mode:vertical-rl] rotate-180">{i === 0 ? "Importante" : "Não importante"}</span>
              </div>
            ),
            <div
              key={q}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== q) setOver(q); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === q ? null : o)); }}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) onMove(id, q); }}
              className={`rounded-xl border p-2 flex flex-col min-h-[220px] transition-colors ${QUAD[q].cls.replace(/text-[^ ]+/, "")} ${over === q ? "ring-2 ring-fuchsia-400/60" : ""}`}
            >
              <button onClick={() => onFilter(q)} title="Filtrar a lista por este quadrante" className={`flex items-center justify-between gap-2 mb-1.5 text-left ${activeFilter === q ? "underline underline-offset-4" : ""}`}>
                <span className="text-xs font-semibold text-white">{QUAD[q].icon} {QUAD[q].label} <span className="text-[10px] text-slate-400 font-normal hidden xl:inline">· {QUAD[q].hint}</span></span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/25 text-slate-200 tabular-nums">{items.length}</span>
              </button>
              <div className="space-y-1 overflow-y-auto max-h-[300px] pr-0.5 flex-1">
                {items.length === 0 && <div className="text-[10px] text-slate-500 px-1 py-2">{over === q ? "Solte aqui" : "—"}</div>}
                {items.map((n) => {
                  const late = !!n.dueAt && new Date(n.dueAt).getTime() < now;
                  return (
                    <div
                      key={n.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", n.id); e.dataTransfer.effectAllowed = "move"; }}
                      className="group flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-[#0f1623]/80 hover:bg-[#182234] border border-transparent hover:border-[#253449] cursor-grab active:cursor-grabbing"
                    >
                      <span className="text-[11px] leading-none mt-0.5">{KIND_ICON[n.kind] ?? "•"}</span>
                      <button onClick={() => onOpen(n)} className="flex-1 min-w-0 text-left">
                        <div className={`text-[11px] leading-snug line-clamp-2 ${late ? "text-red-300" : "text-slate-200"}`}>{n.title}</div>
                        {(n.dueAt || n.tags?.length) ? <div className="text-[9px] text-slate-500 truncate">{n.dueAt ? `${late ? "⚠️ " : ""}${fmtWhen(n.dueAt)}` : ""}{n.dueAt && n.tags?.length ? " · " : ""}{(n.tags ?? []).slice(0, 2).map((t) => `#${t}`).join(" ")}</div> : null}
                      </button>
                      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => onQuick(n.id, "done")} title="Feito" className="text-[10px] px-1 py-0.5 rounded bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/50">✓</button>
                        {q === "eliminar" && <button onClick={() => onQuick(n.id, "archive")} title="Arquivar" className="text-[10px] px-1 py-0.5 rounded bg-[#1a2535] text-slate-300 hover:text-white">🗄️</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>,
          ];
        })}
      </div>
    </div>
  );
}

/** Item do bloquinho: fechado mostra resumo; aberto mostra tudo e permite editar. */
type QuickOp = "done" | "reopen" | "tomorrow" | "week" | "nodate" | "archive" | "unarchive" | "delete" | { set: Partial<{ important: boolean; urgent: boolean }> } | { delegate: string };

function NoteItem({ note, users, open, onToggleOpen, onToggleDone, onDelete, onSave, onQuick }: {
  note: Note; users: CompanyUser[]; open: boolean; onToggleOpen: () => void; onToggleDone: (doneNote?: string) => void; onDelete: () => void;
  onSave: (patch: Partial<Pick<Note, "title" | "body" | "dueAt" | "kind" | "tags">>) => Promise<boolean>;
  onQuick: (op: QuickOp) => void;
}) {
  const q = quadrantOf(note);
  const overdue = !!note.dueAt && !note.done && new Date(note.dueAt) < new Date();
  const [editing, setEditing] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const [doneNote, setDoneNote] = useState("");
  const [tags, setTags] = useState((note.tags ?? []).join(", "));
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body ?? "");
  const [kind, setKind] = useState(note.kind);
  const [due, setDue] = useState(note.dueAt ? toLocalInput(note.dueAt) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setTitle(note.title); setBody(note.body ?? ""); setKind(note.kind); setTags((note.tags ?? []).join(", ")); setDue(note.dueAt ? toLocalInput(note.dueAt) : ""); setEditing(false); setConcluding(false); setDoneNote(""); }, [note]);

  async function save() {
    setSaving(true);
    const ok = await onSave({ title: title.trim(), body: body.trim() || null, kind, dueAt: due ? new Date(due).toISOString() : null, tags: tags.split(/[,;]/).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean) });
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <div className={`group rounded-lg border transition-colors ${open ? "bg-[#131c2c] border-fuchsia-500/30" : "bg-[#131c2c] border-transparent hover:border-[#253449]"} ${note.done || note.archivedAt ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2 px-2.5 py-2">
        <button onClick={() => { if (note.done) onToggleDone(); else { if (!open) onToggleOpen(); setConcluding(true); } }} title={note.done ? "Reabrir" : "Concluir"} className="text-sm leading-none mt-0.5 flex-shrink-0">{note.done ? "✅" : KIND_ICON[note.kind] ?? "•"}</button>
        <button onClick={onToggleOpen} className="flex-1 min-w-0 text-left">
          <div className={`text-xs ${note.done ? "line-through text-slate-500" : overdue ? "text-red-300" : "text-slate-200"} ${open ? "" : "truncate"}`}>{note.archivedAt ? "🗄️ " : ""}{note.title}</div>
          {!open && <div className="text-[10px] text-slate-500 truncate"><span title={QUAD[q].hint}>{QUAD[q].icon}</span>{note.dueAt ? ` · ${overdue ? "⚠️ " : ""}${fmtWhen(note.dueAt)}` : ""}{note.tags?.length ? ` · ${note.tags.map((t) => `#${t}`).join(" ")}` : ""}{note.body ? ` · ${note.body}` : ""}</div>}
        </button>
        {!note.done && !note.archivedAt && (
          <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
            <button onClick={() => onQuick("tomorrow")} title="Adiar pra amanhã 9h" className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a2535] text-slate-300 hover:text-white">+1d</button>
            <button onClick={() => onQuick("week")} title="Adiar 7 dias" className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a2535] text-slate-300 hover:text-white">+7d</button>
            <button onClick={() => onQuick("archive")} title="Arquivar (guardar sem ocupar espaço)" className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a2535] text-slate-300 hover:text-white">🗄️</button>
          </div>
        )}
        <button onClick={onDelete} className="text-slate-600 hover:text-red-400 text-xs flex-shrink-0" title="Excluir">✕</button>
      </div>

      {open && !editing && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-1">
            <span>{KIND_LABEL[note.kind]}{note.dueAt ? ` · ${fmtWhen(note.dueAt)}` : ""} · criado {fmtWhen(note.createdAt)}{note.source && SOURCE_LABEL[note.source] ? ` ${SOURCE_LABEL[note.source]}` : ""}</span>
            {(note.tags ?? []).map((t) => <span key={t} className="px-1.5 py-0.5 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/25 text-fuchsia-200">#{t}</span>)}
          </div>
          {/* Matriz de Eisenhower: dois toggles + ação do quadrante */}
          {!note.done && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${QUAD[q].cls}`} title={QUAD[q].hint}>{QUAD[q].icon} {QUAD[q].label}</span>
              <button onClick={() => onQuick({ set: { important: !(note.important ?? true) } })} className={`text-[10px] px-2 py-0.5 rounded-full border ${(note.important ?? true) ? "bg-fuchsia-600/20 border-fuchsia-500/40 text-white" : "bg-[#0f1623] border-[#253449] text-slate-500"}`}>importante</button>
              <button onClick={() => onQuick({ set: { urgent: !(note.urgent ?? false) } })} className={`text-[10px] px-2 py-0.5 rounded-full border ${(note.urgent ?? false) ? "bg-fuchsia-600/20 border-fuchsia-500/40 text-white" : "bg-[#0f1623] border-[#253449] text-slate-500"}`}>urgente</button>
              <span className="flex-1" />
              {q === "delegar" && users.length > 0 && (
                <select defaultValue="" onChange={(e) => { if (e.target.value) onQuick({ delegate: e.target.value }); }} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200">
                  <option value="">👉 delegar pra…</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              {q === "eliminar" && !note.archivedAt && <button onClick={() => onQuick("archive")} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/15 border border-slate-500/30 text-slate-300 hover:text-white">🗄️ arquivar</button>}
              {q === "agendar" && !note.dueAt && <button onClick={() => onQuick("week")} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 hover:text-white">📅 marcar pra daqui 7 dias</button>}
              {note.archivedAt && <button onClick={() => onQuick("unarchive")} className="text-[10px] px-2 py-0.5 rounded-full bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">📂 desarquivar</button>}
            </div>
          )}
          {note.body && <div className="text-xs text-slate-300 whitespace-pre-wrap break-words bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2">{note.body}</div>}
          {note.done && note.doneNote && (
            <div className="text-xs text-emerald-200 whitespace-pre-wrap break-words bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
              <span className="text-[10px] uppercase tracking-wide text-emerald-400/80 block mb-0.5">O que foi feito</span>{note.doneNote}
            </div>
          )}

          {concluding ? (
            <div className="space-y-1.5 bg-[#0f1623] border border-emerald-500/30 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-emerald-400/80">Concluir — o que foi feito? (opcional)</div>
              <textarea value={doneNote} onChange={(e) => setDoneNote(e.target.value)} rows={2} autoFocus placeholder="Ex.: liguei, ele aprovou a arte e pediu a versão pro Instagram" className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-slate-200 resize-y focus:outline-none focus:border-emerald-500/50" />
              <div className="flex gap-2">
                <button onClick={() => { onToggleDone(doneNote.trim() || undefined); setConcluding(false); }} className="text-[11px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">✅ Concluir</button>
                <button onClick={() => setConcluding(false)} className="text-[11px] px-3 py-1.5 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-white">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(true)} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">✏️ Editar</button>
              <button onClick={() => (note.done ? onToggleDone() : setConcluding(true))} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">{note.done ? "↩ Reabrir" : "✅ Concluir"}</button>
            </div>
          )}

          {(note.events?.length ?? 0) > 0 && (
            <div className="border-t border-[#1e2d45] pt-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Histórico</div>
              <ul className="space-y-0.5">
                {note.events!.map((ev) => (
                  <li key={ev.id} className="text-[11px] text-slate-400 flex gap-2">
                    <span className="text-slate-600 tabular-nums flex-shrink-0">{fmtWhen(ev.createdAt)}</span>
                    <span>
                      <span className={ev.type === "DONE" ? "text-emerald-300" : ev.type === "REOPENED" ? "text-amber-300" : "text-slate-300"}>{EVENT_LABEL[ev.type] ?? ev.type.toLowerCase()}</span>
                      {" "}{SOURCE_LABEL[ev.source] ?? ev.source}
                      {ev.detail && <span className="text-slate-500"> — {ev.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {open && editing && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="flex gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="TASK">☑️ Tarefa</option><option value="IDEA">💡 Ideia</option><option value="NOTE">📝 Nota</option><option value="REMINDER">⏰ Lembrete</option>
            </select>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-300" />
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-500/50" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="etiquetas separadas por vírgula: pessoal, financeiro, cliente" className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-slate-300 placeholder-slate-600" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Detalhes…" className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-slate-200 resize-y focus:outline-none focus:border-fuchsia-500/50" />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !title.trim()} className="text-[11px] px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white disabled:opacity-40">{saving ? "Salvando…" : "Salvar"}</button>
            <button onClick={() => setEditing(false)} className="text-[11px] px-3 py-1.5 rounded-lg border border-[#1e2d45] text-slate-400 hover:text-white">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
