"use client";

import { useEffect, useState, useCallback } from "react";

type Convo = {
  id: string;
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
  source: "ORGANIC" | "AUTOMATION" | "AGENT";
  text: string | null;
  createdAt: string;
};

const SOURCE_LABEL: Record<string, string> = { AUTOMATION: "automação", AGENT: "atendente", ORGANIC: "" };

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
    } finally {
      setThreadLoading(false);
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
        <h1 className="text-xl font-semibold text-white">Inbox · Instagram</h1>
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
                <span className="text-white text-sm font-medium truncate">@{c.participantUsername || c.participantId}</span>
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
              <div className="px-4 py-3 border-b border-white/10 text-white text-sm font-medium">
                @{selected.participantUsername || selected.participantId}
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
