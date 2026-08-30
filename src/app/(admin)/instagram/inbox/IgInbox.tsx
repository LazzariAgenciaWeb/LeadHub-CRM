"use client";

import { useEffect, useState, useCallback } from "react";

type Convo = {
  id: string;
  channel: "INSTAGRAM" | "MESSENGER" | "FACEBOOK";
  participantId: string;
  participantUsername: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  lastDirection: "IN" | "OUT" | null;
  needsReply: boolean;
  hadAutomation: boolean;
};

type Msg = {
  id: string;
  direction: "IN" | "OUT";
  source: "ORGANIC" | "AUTOMATION" | "AGENT" | "EXTERNAL" | "AI";
  text: string | null;
  createdAt: string;
};

type AiMode = "ACTIVE" | "PAUSED_HUMAN" | "OFF";

const SOURCE_LABEL: Record<string, string> = { AUTOMATION: "automação", AGENT: "atendente", EXTERNAL: "fora do LeadHub", AI: "agente IA", ORGANIC: "" };
const AI_MODE_LABEL: Record<AiMode, string> = { ACTIVE: "IA ativa", PAUSED_HUMAN: "IA pausada (humano assumiu)", OFF: "IA desligada" };
const CHANNEL: Record<string, { label: string; cls: string }> = {
  INSTAGRAM: { label: "Instagram", cls: "bg-pink-500/20 text-pink-300" },
  MESSENGER: { label: "Messenger", cls: "bg-blue-500/20 text-blue-300" },
  FACEBOOK: { label: "Facebook", cls: "bg-indigo-500/20 text-indigo-300" },
};

export default function IgInbox() {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [pending, setPending] = useState(0);
  const [filter, setFilter] = useState<"all" | "needsReply">("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Convo | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [aiMode, setAiMode] = useState<AiMode | null>(null);
  const [aiSaving, setAiSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter === "needsReply" ? "?filter=needsReply" : "";
      const res = await fetch(`/api/instagram/inbox${q}`).then((r) => r.json());
      setConvos(res.conversations || []);
      setPending(res.pending || 0);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function openConvo(c: Convo) {
    setSelected(c);
    setMsgs([]);
    setSendErr("");
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/instagram/inbox/${c.id}`).then((r) => r.json());
      setMsgs(res.messages || []);
      setAiMode(res.conversation?.aiMode ?? null);
    } finally {
      setThreadLoading(false);
    }
  }

  async function toggleAi() {
    if (!selected || !aiMode) return;
    const next: AiMode = aiMode === "ACTIVE" ? "OFF" : "ACTIVE";
    setAiSaving(true);
    try {
      const res = await fetch(`/api/instagram/inbox/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiMode: next }),
      });
      if (res.ok) setAiMode(next);
    } finally {
      setAiSaving(false);
    }
  }

  async function send() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    setSendErr("");
    try {
      const res = await fetch(`/api/instagram/inbox/${selected.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply.trim() }),
      });
      const j = await res.json();
      if (!res.ok) { setSendErr(j.error || "Falha ao enviar"); return; }
      setReply("");
      await openConvo(selected);
      load();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold text-white">Inbox · Social</h1>
        <div className="flex gap-1 text-xs">
          <button onClick={() => setFilter("all")} className={`px-2.5 py-1 rounded-lg ${filter === "all" ? "bg-indigo-500 text-white" : "border border-white/10 text-slate-400"}`}>Todas</button>
          <button onClick={() => setFilter("needsReply")} className={`px-2.5 py-1 rounded-lg ${filter === "needsReply" ? "bg-indigo-500 text-white" : "border border-white/10 text-slate-400"}`}>
            Sem resposta{pending ? ` (${pending})` : ""}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[70vh]">
        {/* Lista */}
        <div className="rounded-xl border border-white/10 bg-white/5 overflow-y-auto">
          {loading && <p className="p-3 text-slate-500 text-sm">Carregando…</p>}
          {!loading && convos.length === 0 && <p className="p-3 text-slate-500 text-sm">Nenhuma conversa.</p>}
          {convos.map((c) => (
            <button
              key={c.id}
              onClick={() => openConvo(c)}
              className={`w-full text-left px-3 py-2.5 border-b border-white/5 hover:bg-white/5 ${selected?.id === c.id ? "bg-white/10" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${CHANNEL[c.channel]?.cls || "bg-slate-500/20 text-slate-300"} flex-shrink-0`}>
                  {CHANNEL[c.channel]?.label || c.channel}
                </span>
                <span className="text-white text-sm font-medium truncate">{c.participantUsername || c.participantId}</span>
                {c.needsReply && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="Sem resposta" />}
                {c.hadAutomation && <span className="text-[10px] text-indigo-300 flex-shrink-0">auto</span>}
              </div>
              <p className="text-xs text-slate-400 truncate">{c.lastMessageText || "—"}</p>
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="rounded-xl border border-white/10 bg-white/5 flex flex-col min-h-0">
          {!selected && <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Selecione uma conversa</div>}
          {selected && (
            <>
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${CHANNEL[selected.channel]?.cls || ""} flex-shrink-0`}>
                    {CHANNEL[selected.channel]?.label || selected.channel}
                  </span>
                  <span className="text-white text-sm font-medium truncate">{selected.participantUsername || selected.participantId}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selected.channel === "INSTAGRAM" && aiMode && (
                    <button
                      onClick={toggleAi}
                      disabled={aiSaving}
                      title={AI_MODE_LABEL[aiMode]}
                      className={`text-[10px] px-2 py-1 rounded-lg border disabled:opacity-50 ${
                        aiMode === "ACTIVE"
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                          : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                      }`}
                    >
                      {aiMode === "ACTIVE" ? "🤖 IA ativa · pausar" : aiMode === "PAUSED_HUMAN" ? "🤖 pausada · reativar" : "🤖 desligada · ligar"}
                    </button>
                  )}
                  {selected.channel === "INSTAGRAM" && selected.participantUsername && (
                    <a
                      href={`https://instagram.com/${selected.participantUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-300 hover:text-indigo-200"
                    >
                      Abrir perfil ↗
                    </a>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                {threadLoading && <p className="text-slate-500 text-sm">Carregando…</p>}
                {msgs.map((m) => (
                  <div key={m.id} className={`max-w-[75%] ${m.direction === "OUT" ? "self-end" : "self-start"}`}>
                    <div className={`rounded-2xl px-3 py-2 text-sm ${m.direction === "OUT" ? "bg-indigo-500 text-white" : "bg-white/10 text-slate-100"}`}>
                      {m.text || "—"}
                    </div>
                    {m.direction === "OUT" && SOURCE_LABEL[m.source] && (
                      <div className="text-[10px] text-slate-500 text-right mt-0.5">{SOURCE_LABEL[m.source]}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-white/10">
                {sendErr && <p className="text-red-400 text-xs mb-1">{sendErr}</p>}
                <div className="flex gap-2">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                    placeholder="Responder…"
                    className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button onClick={send} disabled={sending} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-50">
                    {sending ? "…" : "Enviar"}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">O Instagram só permite responder dentro de 24h da última mensagem do contato.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
