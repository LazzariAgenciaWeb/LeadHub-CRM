"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

type Item = {
  id: string;
  username: string | null;
  commentText: string | null;
  likeCount: number;
  intent: string | null;
  reason: string | null;
  replyText: string | null;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  errorDetail: string | null;
  source: string;
  createdAt: string;
};

const TABS: { key: string; label: string }[] = [
  { key: "AWAITING_APPROVAL", label: "Para aprovar" },
  { key: "NEEDS_YOU", label: "Precisam de você" },
  { key: "SCHEDULED", label: "Agendadas" },
  { key: "SENT", label: "Publicadas" },
  { key: "QUEUED", label: "Na fila da IA" },
  { key: "SKIPPED", label: "Puladas" },
  { key: "HIDDEN", label: "Spam ocultado" },
  { key: "FAILED", label: "Falharam" },
];

const INTENT_LABEL: Record<string, { label: string; cls: string }> = {
  JOKE: { label: "Brincadeira", cls: "bg-amber-500/20 text-amber-300" },
  PRAISE: { label: "Elogio", cls: "bg-emerald-500/20 text-emerald-300" },
  QUESTION: { label: "Pergunta", cls: "bg-sky-500/20 text-sky-300" },
  INTEREST: { label: "Interesse 💰", cls: "bg-indigo-500/30 text-indigo-200" },
  LOW_EFFORT: { label: "Emoji/risada", cls: "bg-slate-500/20 text-slate-300" },
  CRITICISM: { label: "Crítica", cls: "bg-red-500/20 text-red-300" },
  SPAM: { label: "Spam", cls: "bg-red-500/20 text-red-300" },
};

function fmtTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AiRepliesPanel({
  automation,
  onClose,
}: {
  automation: { id: string; name: string; mediaId: string | null; aiApproval: boolean };
  onClose: () => void;
}) {
  const [tab, setTab] = useState(automation.aiApproval ? "AWAITING_APPROVAL" : "SCHEDULED");
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/instagram/ai-replies?automationId=${automation.id}&status=${tab}`).then((r) => r.json());
      setItems(res.items || []);
      setCounts(res.counts || {});
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }, [automation.id, tab]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: string, replyText?: string) {
    setBusy(id);
    setMsg("");
    try {
      const res = await fetch(`/api/instagram/ai-replies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, replyText }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "Erro"); return; }
      if (action === "regenerate") {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, replyText: j.replyText } : it)));
        setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
      } else {
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  async function approveAll() {
    if (!confirm(`Aprovar as ${counts.AWAITING_APPROVAL ?? 0} respostas? Elas saem espaçadas, aos poucos.`)) return;
    setBusy("all");
    try {
      const j = await fetch("/api/instagram/ai-replies/approve-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automationId: automation.id }),
      }).then((r) => r.json());
      setMsg(`${j.approved ?? 0} aprovadas — vão saindo aos poucos.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function backfill() {
    setBusy("backfill");
    setMsg("Buscando os comentários do post…");
    try {
      const res = await fetch(`/api/instagram/automations/${automation.id}/backfill`, { method: "POST" });
      const j = await res.json();
      setMsg(res.ok ? `${j.found} comentários lidos · ${j.queued} novos na fila da IA (os mais curtidos primeiro).` : j.error || "Erro");
      await load();
    } finally {
      setBusy(null);
    }
  }

  const editable = tab === "AWAITING_APPROVAL" || tab === "NEEDS_YOU" || tab === "SKIPPED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl border border-white/10 bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 pb-3 border-b border-white/10">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-white font-semibold flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-pink-400 flex-shrink-0" />
              <span className="truncate">Respostas da IA · {automation.name}</span>
            </h3>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button onClick={load} className="text-slate-400 hover:text-white" title="Atualizar"><RefreshCw className="w-4 h-4" /></button>
              <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">Fechar</button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {automation.mediaId ? (
              <button
                onClick={backfill}
                disabled={busy === "backfill"}
                className="text-xs rounded-lg border border-white/10 px-2.5 py-1 text-slate-200 hover:bg-white/5 disabled:opacity-50"
              >
                {busy === "backfill" ? "Buscando…" : "Puxar comentários antigos do post"}
              </button>
            ) : (
              <span className="text-[11px] text-slate-500">Pra puxar comentários antigos, escolha um post específico na automação.</span>
            )}
            {tab === "AWAITING_APPROVAL" && (counts.AWAITING_APPROVAL ?? 0) > 0 && (
              <button
                onClick={approveAll}
                disabled={busy === "all"}
                className="text-xs rounded-lg bg-emerald-600 px-2.5 py-1 text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Aprovar todas ({counts.AWAITING_APPROVAL})
              </button>
            )}
          </div>
          {msg && <p className="mt-2 text-xs text-slate-300">{msg}</p>}

          <div className="mt-3 flex gap-1 overflow-x-auto -mx-1 px-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap text-xs px-2.5 py-1 rounded-full border ${tab === t.key ? "border-indigo-500 text-indigo-200 bg-indigo-500/10" : "border-white/10 text-slate-400 hover:text-slate-200"}`}
              >
                {t.label}
                {(counts[t.key] ?? 0) > 0 && <span className="ml-1 opacity-70">{counts[t.key]}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 pt-3 overflow-y-auto flex flex-col gap-2">
          {loading && <p className="text-slate-400 text-sm">Carregando…</p>}
          {!loading && items.length === 0 && <p className="text-slate-500 text-sm">Nada aqui.</p>}
          {items.map((it) => {
            const intent = it.intent ? INTENT_LABEL[it.intent] : null;
            const draft = drafts[it.id] ?? it.replyText ?? "";
            return (
              <div key={it.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-medium">@{it.username || "?"}</span>
                  {intent && <span className={`text-[11px] px-2 py-0.5 rounded-full ${intent.cls}`}>{intent.label}</span>}
                  {it.likeCount > 0 && <span className="text-[11px] text-slate-400">♥ {it.likeCount}</span>}
                  {it.source === "BACKFILL" && <span className="text-[11px] text-slate-500">antigo</span>}
                  <span className="text-[11px] text-slate-500 ml-auto">
                    {it.status === "SENT" ? `publicada ${fmtTime(it.sentAt)}` : it.status === "SCHEDULED" ? `sai ~${fmtTime(it.scheduledAt)}` : fmtTime(it.createdAt)}
                  </span>
                </div>
                <p className="text-slate-300 mt-1">{it.commentText || "—"}</p>

                {editable ? (
                  <textarea
                    className="mt-2 w-full rounded-lg bg-slate-950/60 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    rows={2}
                    value={draft}
                    placeholder="Sua resposta"
                    onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                  />
                ) : (
                  it.replyText && <p className="mt-2 text-indigo-200 border-l-2 border-indigo-500/50 pl-2">↳ {it.replyText}</p>
                )}
                {it.reason && <p className="mt-1 text-[11px] text-slate-500">IA: {it.reason}</p>}
                {it.errorDetail && <p className="mt-1 text-[11px] text-red-400 break-words">{it.errorDetail.slice(0, 200)}</p>}

                <div className="mt-2 flex flex-wrap gap-2">
                  {editable && (
                    <>
                      <button
                        onClick={() => act(it.id, "approve", draft)}
                        disabled={busy === it.id || !draft.trim()}
                        className="text-xs rounded-lg bg-emerald-600 px-2.5 py-1 text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {tab === "AWAITING_APPROVAL" ? "Aprovar" : "Responder com este texto"}
                      </button>
                      <button
                        onClick={() => act(it.id, "regenerate")}
                        disabled={busy === it.id}
                        className="text-xs rounded-lg border border-white/10 px-2.5 py-1 text-slate-200 hover:bg-white/5 disabled:opacity-50"
                      >
                        {busy === it.id ? "…" : "Outra resposta"}
                      </button>
                      {tab !== "SKIPPED" && (
                        <button
                          onClick={() => act(it.id, "skip")}
                          disabled={busy === it.id}
                          className="text-xs px-2.5 py-1 text-slate-400 hover:text-white disabled:opacity-50"
                        >
                          Não responder
                        </button>
                      )}
                    </>
                  )}
                  {tab === "SCHEDULED" && (
                    <button onClick={() => act(it.id, "skip")} disabled={busy === it.id} className="text-xs px-2.5 py-1 text-slate-400 hover:text-white">
                      Cancelar
                    </button>
                  )}
                  {(tab === "FAILED" || tab === "QUEUED") && it.errorDetail && (
                    <button onClick={() => act(it.id, "retry")} disabled={busy === it.id} className="text-xs rounded-lg border border-white/10 px-2.5 py-1 text-slate-200 hover:bg-white/5">
                      Tentar de novo
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
