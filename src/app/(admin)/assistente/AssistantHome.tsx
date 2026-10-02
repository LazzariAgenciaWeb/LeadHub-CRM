"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/* ── tipos espelhando as APIs ─────────────────────────────────────────────── */
interface ExecutedAction { tool: string; ok: boolean; message: string; link?: string }
interface ChatMsg { role: "user" | "assistant"; content: string; actions?: ExecutedAction[]; transcribed?: boolean }
interface Pending { id: string; summary: string }
interface FilaItem { id: string; kind: string; title: string; sub?: string; when?: string | null; overdue?: boolean; link?: string }
interface Fila { esperandoPorMim: FilaItem[]; hoje: FilaItem[]; followUps: FilaItem[]; semProximaAcao: FilaItem[]; financeiro: FilaItem[]; bloquinho: FilaItem[]; generatedAt: string }
interface NoteEvent { id: string; type: "CREATED" | "EDITED" | "DONE" | "REOPENED" | string; detail: string | null; source: string; createdAt: string }
interface Note { id: string; kind: string; title: string; body: string | null; dueAt: string | null; done: boolean; doneAt?: string | null; doneNote?: string | null; createdAt: string; tags: string[]; events?: NoteEvent[] }

const EVENT_LABEL: Record<string, string> = { CREATED: "criado", EDITED: "editado", DONE: "concluído", REOPENED: "reaberto" };
const SOURCE_LABEL: Record<string, string> = { APP: "no app", WHATSAPP: "pelo WhatsApp", MCP: "pelo Claude", WEBHOOK: "por rotina externa" };

const KIND_ICON: Record<string, string> = { IDEA: "💡", NOTE: "📝", REMINDER: "⏰", TASK: "☑️" };
const KIND_LABEL: Record<string, string> = { IDEA: "Ideia", NOTE: "Nota", REMINDER: "Lembrete", TASK: "Tarefa" };

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
          return <a key={i} href={href} className="text-indigo-300 underline hover:text-indigo-200">{md[1]}</a>;
        }
        if (/^https?:\/\//.test(p)) {
          let href = p; try { const u = new URL(p); href = u.pathname + u.search; } catch {}
          return <a key={i} href={href} className="text-indigo-300 underline hover:text-indigo-200">{p.replace(/^https?:\/\/[^/]+/, "")}</a>;
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
  const search = useSearchParams();
  const [tab, setTab] = useState<"fila" | "bloquinho">(search.get("aba") === "bloquinho" ? "bloquinho" : "fila");

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

  const loadFila = useCallback(async () => {
    setFilaLoading(true);
    try { const r = await fetch("/api/assistente/fila"); if (r.ok) setFila(await r.json()); } finally { setFilaLoading(false); }
  }, []);
  const loadNotes = useCallback(async () => {
    const r = await fetch(`/api/assistente/notas${showDone ? "?done=1" : ""}`); if (r.ok) setNotes(await r.json());
  }, [showDone]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, sending]);

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
  const allTags = [...new Set(notes.flatMap((n) => n.tags ?? []))].sort();
  const visibleNotes = tagFilter ? notes.filter((n) => (n.tags ?? []).includes(tagFilter)) : notes;
  const totalFila = fila ? fila.esperandoPorMim.length + fila.hoje.length + fila.followUps.length + fila.semProximaAcao.length + fila.financeiro.length : 0;

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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        {/* ── Chat ── */}
        <div className="lg:col-span-3 bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden flex flex-col" style={{ minHeight: 560 }}>
          <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto" style={{ maxHeight: 620 }}>
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
                          {a.link && <a href={a.link.replace(/^https?:\/\/[^/]+/, "")} className="px-2 py-0.5 rounded bg-[#1a2535] border border-[#253449] text-slate-300 hover:text-white">Abrir</a>}
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

        {/* ── Fila / Bloquinho ── */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center gap-1 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-1">
            <button onClick={() => setTab("fila")} className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${tab === "fila" ? "bg-fuchsia-600/20 text-white border border-fuchsia-500/30" : "text-slate-400 hover:text-white"}`}>
              Fila do dia {fila ? <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[#1a2535] text-slate-300">{totalFila}</span> : null}
            </button>
            <button onClick={() => setTab("bloquinho")} className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${tab === "bloquinho" ? "bg-fuchsia-600/20 text-white border border-fuchsia-500/30" : "text-slate-400 hover:text-white"}`}>
              Bloquinho <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[#1a2535] text-slate-300">{notes.filter((n) => !n.done).length}</span>
            </button>
          </div>

          {tab === "fila" && (
            <div className="space-y-3">
              {filaLoading && !fila && <div className="text-xs text-slate-500 px-1">Montando a fila…</div>}
              {fila && totalFila === 0 && <div className="bg-[#0f1623] border border-emerald-500/25 rounded-xl p-4 text-sm text-emerald-200">Nada pedindo ação agora. ✅</div>}
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
                  <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-0.5">
                    {items.map((it) => (
                      <a key={it.id} href={it.link ? it.link.replace(/^https?:\/\/[^/]+/, "") : "#"} className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-[#131c2c] hover:bg-[#182234] border border-transparent hover:border-[#253449] transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs truncate ${it.overdue ? "text-red-300" : "text-slate-200"}`}>{it.overdue ? "⚠️ " : ""}{it.title}</div>
                          {(it.sub || it.when) && <div className="text-[10px] text-slate-500 truncate">{it.sub}{it.sub && it.when ? " · " : ""}{fmtWhen(it.when)}</div>}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={loadFila} className="text-[11px] text-slate-500 hover:text-slate-300 px-1">↻ atualizar</button>
            </div>
          )}

          {tab === "bloquinho" && (
            <div className="space-y-3">
              <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-3 space-y-2">
                <div className="flex gap-2">
                  <select value={noteKind} onChange={(e) => setNoteKind(e.target.value as any)} className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-2 py-2 text-xs text-white">
                    <option value="TASK">☑️ Tarefa</option><option value="IDEA">💡 Ideia</option><option value="NOTE">📝 Nota</option><option value="REMINDER">⏰ Lembrete</option>
                  </select>
                  <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} placeholder="Anotar rápido…" className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-fuchsia-500/50" />
                  <button onClick={addNote} disabled={!noteInput.trim()} className="px-3 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs disabled:opacity-40">+</button>
                </div>
                <div className="flex gap-2">
                  {(noteKind === "REMINDER" || noteKind === "TASK") && (
                    <input type="datetime-local" value={noteDue} onChange={(e) => setNoteDue(e.target.value)} className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-slate-300" />
                  )}
                  <input value={noteTags} onChange={(e) => setNoteTags(e.target.value)} placeholder="etiquetas: pessoal, financeiro…" className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-slate-300 placeholder-slate-600" />
                </div>
              </div>
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] text-slate-500">Clique num item pra ler tudo e editar.</span>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-fuchsia-500" /> mostrar concluídas
                </label>
              </div>
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  <button onClick={() => setTagFilter(null)} className={`text-[10px] px-2 py-0.5 rounded-full border ${!tagFilter ? "bg-fuchsia-600/25 border-fuchsia-500/40 text-white" : "bg-[#131c2c] border-[#253449] text-slate-400 hover:text-white"}`}>todas</button>
                  {allTags.map((t) => (
                    <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)} className={`text-[10px] px-2 py-0.5 rounded-full border ${tagFilter === t ? "bg-fuchsia-600/25 border-fuchsia-500/40 text-white" : "bg-[#131c2c] border-[#253449] text-slate-400 hover:text-white"}`}>#{t}</button>
                  ))}
                </div>
              )}
              <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-2 space-y-1 max-h-[560px] overflow-y-auto">
                {visibleNotes.length === 0 && <div className="text-xs text-slate-500 px-2 py-3">{tagFilter ? "Nada com essa etiqueta." : "Bloquinho vazio. Mande \"anota: …\" no chat ou no WhatsApp."}</div>}
                {visibleNotes.map((n) => (
                  <NoteItem
                    key={n.id}
                    note={n}
                    open={openNote === n.id}
                    onToggleOpen={() => setOpenNote(openNote === n.id ? null : n.id)}
                    onToggleDone={(doneNote) => toggleNote(n, doneNote)}
                    onDelete={() => { if (confirm("Excluir este item?")) deleteNote(n); }}
                    onSave={(patch) => saveNote(n.id, patch)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Item do bloquinho: fechado mostra resumo; aberto mostra tudo e permite editar. */
function NoteItem({ note, open, onToggleOpen, onToggleDone, onDelete, onSave }: {
  note: Note; open: boolean; onToggleOpen: () => void; onToggleDone: (doneNote?: string) => void; onDelete: () => void;
  onSave: (patch: Partial<Pick<Note, "title" | "body" | "dueAt" | "kind" | "tags">>) => Promise<boolean>;
}) {
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
    <div className={`rounded-lg border transition-colors ${open ? "bg-[#131c2c] border-fuchsia-500/30" : "bg-[#131c2c] border-transparent hover:border-[#253449]"} ${note.done ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2 px-2.5 py-2">
        <button onClick={() => { if (note.done) onToggleDone(); else { if (!open) onToggleOpen(); setConcluding(true); } }} title={note.done ? "Reabrir" : "Concluir"} className="text-sm leading-none mt-0.5 flex-shrink-0">{note.done ? "✅" : KIND_ICON[note.kind] ?? "•"}</button>
        <button onClick={onToggleOpen} className="flex-1 min-w-0 text-left">
          <div className={`text-xs ${note.done ? "line-through text-slate-500" : "text-slate-200"} ${open ? "" : "truncate"}`}>{note.title}</div>
          {!open && !!(note.body || note.dueAt || note.tags?.length) && <div className="text-[10px] text-slate-500 truncate">{KIND_LABEL[note.kind]}{note.dueAt ? ` · ${fmtWhen(note.dueAt)}` : ""}{note.tags?.length ? ` · ${note.tags.map((t) => `#${t}`).join(" ")}` : ""}{note.body ? ` · ${note.body}` : ""}</div>}
        </button>
        <button onClick={onDelete} className="text-slate-600 hover:text-red-400 text-xs flex-shrink-0" title="Excluir">✕</button>
      </div>

      {open && !editing && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-1">
            <span>{KIND_LABEL[note.kind]}{note.dueAt ? ` · ${fmtWhen(note.dueAt)}` : ""} · criado {fmtWhen(note.createdAt)}</span>
            {(note.tags ?? []).map((t) => <span key={t} className="px-1.5 py-0.5 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/25 text-fuchsia-200">#{t}</span>)}
          </div>
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
