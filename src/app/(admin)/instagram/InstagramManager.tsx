"use client";

import { useEffect, useState, useCallback } from "react";
import { Camera, Plus, Trash2, RefreshCw } from "lucide-react";

type Account = {
  id: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  status: string;
} | null;

type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  mediaId: string | null;
  mediaLabel: string | null;
  triggerType: "KEYWORD" | "ANY";
  keywords: string[];
  replyToComment: boolean;
  commentReplies: string[];
  sendDm: boolean;
  dmText: string | null;
  dmLinkUrl: string | null;
  dmButtonLabel: string | null;
  deliveredText: string | null;
  requireFollow: boolean;
  notFollowingText: string | null;
};

type Media = {
  id: string;
  caption: string;
  thumbnail: string | null;
  permalink: string;
};

type Run = {
  id: string;
  igCommenterId?: string;
  username: string | null;
  commentText: string | null;
  status: string;
  followState: string;
  leadId?: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  COMMENT_REPLIED: "Respondeu comentário",
  DM_SENT: "DM enviado",
  AWAITING_FOLLOW: "Esperando follow",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
  SKIPPED: "Ignorado",
};

const emptyForm = {
  id: "" as string | null,
  name: "",
  mediaId: "" as string | null,
  triggerType: "KEYWORD" as "KEYWORD" | "ANY",
  keywords: "",
  replyToComment: true,
  commentReplies: "",
  sendDm: true,
  dmText: "",
  dmLinkUrl: "",
  dmButtonLabel: "",
  deliveredText: "",
  requireFollow: false,
  notFollowingText: "",
};

export default function InstagramManager() {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account>(null);
  const [connectUrl, setConnectUrl] = useState("");
  const [fbConnectUrl, setFbConnectUrl] = useState("");
  const [fbPages, setFbPages] = useState<{ id: string; name: string | null }[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resub, setResub] = useState("");
  const [resubbing, setResubbing] = useState(false);
  const [reportFor, setReportFor] = useState<Automation | null>(null);
  const [reportRuns, setReportRuns] = useState<Run[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  async function openReport(a: Automation) {
    setReportFor(a);
    setReportLoading(true);
    setReportRuns([]);
    try {
      const res = await fetch(`/api/instagram/runs?automationId=${a.id}`).then((r) => r.json());
      setReportRuns(res.runs || []);
    } finally {
      setReportLoading(false);
    }
  }

  async function convertLead(runId: string) {
    const res = await fetch(`/api/instagram/runs/${runId}/convert-lead`, { method: "POST" }).then((r) => r.json());
    if (res.ok) setReportRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, leadId: res.leadId } : r)));
  }

  async function resubscribe() {
    setResubbing(true);
    setResub("");
    try {
      const r = await fetch("/api/instagram/account/resubscribe", { method: "POST" }).then((x) => x.json());
      setResub(r.ok ? `Conexão atualizada ✓ (${(r.fields || []).join(", ")})` : `Erro: ${r.error || "falhou"}`);
    } catch {
      setResub("Erro de rede");
    } finally {
      setResubbing(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const accRes = await fetch("/api/instagram/account").then((r) => r.json());
      setAccount(accRes.account);
      setConnectUrl(accRes.connectUrl || "");
      setFbConnectUrl(accRes.fbConnectUrl || "");
      setFbPages(accRes.facebookPages || []);
      if (accRes.account) {
        const [autRes, runRes] = await Promise.all([
          fetch("/api/instagram/automations").then((r) => r.json()),
          fetch("/api/instagram/runs").then((r) => r.json()),
        ]);
        setAutomations(autRes.automations || []);
        setRuns(runRes.runs || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function removeFbPage(id: string) {
    if (!confirm("Remover esta página desta empresa?")) return;
    await fetch(`/api/instagram/facebook-pages/${id}`, { method: "DELETE" });
    load();
  }

  async function loadMedia() {
    setMediaLoading(true);
    try {
      const res = await fetch("/api/instagram/media").then((r) => r.json());
      setMedia(res.media || []);
    } finally {
      setMediaLoading(false);
    }
  }

  function openNew() {
    setForm(emptyForm);
    setError("");
    setShowForm(true);
    if (!media.length) loadMedia();
  }

  function openEdit(a: Automation) {
    setForm({
      id: a.id,
      name: a.name,
      mediaId: a.mediaId,
      triggerType: a.triggerType,
      keywords: a.keywords.join(", "),
      replyToComment: a.replyToComment,
      commentReplies: a.commentReplies.join("\n"),
      sendDm: a.sendDm,
      dmText: a.dmText || "",
      dmLinkUrl: a.dmLinkUrl || "",
      dmButtonLabel: a.dmButtonLabel || "",
      deliveredText: a.deliveredText || "",
      requireFollow: a.requireFollow,
      notFollowingText: a.notFollowingText || "",
    });
    setError("");
    setShowForm(true);
    if (!media.length) loadMedia();
  }

  async function save() {
    setSaving(true);
    setError("");
    const payload = {
      name: form.name,
      mediaId: form.mediaId || null,
      mediaLabel: form.mediaId ? media.find((m) => m.id === form.mediaId)?.caption?.slice(0, 60) || null : null,
      triggerType: form.triggerType,
      keywords: form.keywords.split(",").map((s) => s.trim()).filter(Boolean),
      replyToComment: form.replyToComment,
      commentReplies: form.commentReplies.split("\n").map((s) => s.trim()).filter(Boolean),
      sendDm: form.sendDm,
      dmText: form.dmText,
      dmLinkUrl: form.dmLinkUrl,
      dmButtonLabel: form.dmButtonLabel,
      deliveredText: form.deliveredText,
      requireFollow: form.requireFollow,
      notFollowingText: form.notFollowingText,
    };
    try {
      const url = form.id ? `/api/instagram/automations/${form.id}` : "/api/instagram/automations";
      const res = await fetch(url, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Erro ao salvar"); return; }
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(a: Automation) {
    await fetch(`/api/instagram/automations/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Apagar esta automação?")) return;
    await fetch(`/api/instagram/automations/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) {
    return <div className="p-6 text-slate-400 text-sm">Carregando…</div>;
  }

  // ─── Sem conta conectada ───
  if (!account) {
    return (
      <div className="p-6 max-w-2xl">
        <Header />
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-6">
          <p className="text-slate-300 text-sm mb-4">
            Conecte uma conta profissional do Instagram para criar automações de comentário e direct.
          </p>
          <a
            href={connectUrl}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-pink-500 to-indigo-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Camera className="w-4 h-4" /> Conectar Instagram
          </a>
        </div>
      </div>
    );
  }

  // ─── Conta conectada ───
  return (
    <div className="p-6 max-w-4xl">
      <Header />

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
        {account.profilePictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.profilePictureUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-indigo-500" />
        )}
        <div className="flex-1">
          <p className="text-white font-medium">@{account.username}</p>
          <p className="text-xs text-emerald-400">Conectado</p>
          {resub && <p className="text-[11px] text-slate-400 mt-0.5">{resub}</p>}
        </div>
        <button
          onClick={resubscribe}
          disabled={resubbing}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
          title="Reativa os webhooks (comentários, DMs e cliques de botão) desta conta"
        >
          {resubbing ? "Atualizando…" : "Atualizar conexão"}
        </button>
        <button onClick={load} className="text-slate-400 hover:text-white" title="Recarregar">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Facebook / Messenger */}
      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white text-sm font-medium">Facebook / Messenger</p>
            {!fbPages.length && <p className="text-xs text-slate-400">Nenhuma página conectada</p>}
          </div>
          {fbConnectUrl && (
            <a href={fbConnectUrl} className="rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/10 flex-shrink-0">
              {fbPages.length ? "Reconectar / adicionar" : "Conectar Facebook"}
            </a>
          )}
        </div>
        {fbPages.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {fbPages.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                <span className="text-slate-200 truncate flex-1">{p.name || p.id}</span>
                <button onClick={() => removeFbPage(p.id)} className="text-slate-500 hover:text-red-400 flex-shrink-0">Remover</button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-500 mt-2">
          Os DMs do Messenger caem na <a href="/instagram/inbox" className="text-indigo-300">Inbox Social</a> com o selo Messenger.
        </p>
      </div>

      {/* Automações */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-white font-semibold">Automações</h2>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
        >
          <Plus className="w-4 h-4" /> Nova
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {automations.length === 0 && (
          <p className="text-slate-500 text-sm">Nenhuma automação ainda.</p>
        )}
        {automations.map((a) => (
          <div key={a.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => toggleEnabled(a)}
                className={`w-9 h-5 rounded-full transition-colors relative ${a.enabled ? "bg-emerald-500" : "bg-slate-600"}`}
                title={a.enabled ? "Ativa" : "Desativada"}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${a.enabled ? "left-4" : "left-0.5"}`} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{a.name}</p>
                <p className="text-xs text-slate-400 truncate">
                  {a.triggerType === "ANY" ? "Qualquer comentário" : `Palavras: ${a.keywords.join(", ") || "—"}`}
                  {a.mediaId ? " · post específico" : " · todos os posts"}
                  {a.requireFollow ? " · 🔒 follow-gate" : ""}
                </p>
              </div>
              <button onClick={() => openReport(a)} className="text-xs text-slate-300 hover:text-white">Relatório</button>
              <button onClick={() => openEdit(a)} className="text-xs text-indigo-300 hover:text-indigo-200">Editar</button>
              <button onClick={() => remove(a.id)} className="text-slate-400 hover:text-red-400" title="Apagar">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Disparos recentes */}
      <h2 className="text-white font-semibold mt-8 mb-3">Disparos recentes</h2>
      <div className="rounded-lg border border-white/10 overflow-hidden">
        {runs.length === 0 && <p className="text-slate-500 text-sm p-3">Nenhum disparo ainda.</p>}
        {runs.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-0 text-sm">
            <span className="text-slate-300">@{r.username || "?"}</span>
            <span className="text-slate-500 truncate flex-1">{r.commentText || "—"}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "COMPLETED" ? "bg-emerald-500/20 text-emerald-300" : r.status === "FAILED" ? "bg-red-500/20 text-red-300" : "bg-slate-500/20 text-slate-300"}`}>
              {STATUS_LABEL[r.status] || r.status}
            </span>
          </div>
        ))}
      </div>

      {showForm && (
        <FormModal
          form={form}
          setForm={setForm}
          media={media}
          mediaLoading={mediaLoading}
          saving={saving}
          error={error}
          onClose={() => setShowForm(false)}
          onSave={save}
        />
      )}

      {reportFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setReportFor(null)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Relatório · {reportFor.name}</h3>
              <button onClick={() => setReportFor(null)} className="text-slate-400 hover:text-white text-sm">Fechar</button>
            </div>
            {reportLoading && <p className="text-slate-400 text-sm">Carregando…</p>}
            {!reportLoading && reportRuns.length === 0 && <p className="text-slate-500 text-sm">Nenhum comentário ainda.</p>}
            <div className="flex flex-col gap-2">
              {reportRuns.map((r) => (
                <div key={r.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">@{r.username || r.igCommenterId}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${r.status === "COMPLETED" ? "bg-emerald-500/20 text-emerald-300" : r.status === "FAILED" ? "bg-red-500/20 text-red-300" : "bg-slate-500/20 text-slate-300"}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </div>
                  <p className="text-slate-400 mt-1">{r.commentText || "—"}</p>
                  <div className="mt-2">
                    {r.leadId ? (
                      <span className="text-xs text-emerald-400">✓ Convertido em lead</span>
                    ) : (
                      <button onClick={() => convertLead(r.id)} className="text-xs rounded-lg bg-indigo-500 px-2.5 py-1 text-white hover:bg-indigo-400">
                        Converter em Lead
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <Camera className="w-6 h-6 text-pink-400" />
      <h1 className="text-xl font-semibold text-white">Instagram</h1>
    </div>
  );
}

function FormModal({
  form, setForm, media, mediaLoading, saving, error, onClose, onSave,
}: {
  form: typeof emptyForm;
  setForm: (f: typeof emptyForm) => void;
  media: Media[];
  mediaLoading: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const set = (k: keyof typeof emptyForm, v: any) => setForm({ ...form, [k]: v });
  const input = "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-white font-semibold mb-4">{form.id ? "Editar automação" : "Nova automação"}</h3>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nome</label>
            <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex: Link do ebook" />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Post</label>
            <div className="flex gap-2 items-center mb-2">
              <button
                onClick={() => set("mediaId", null)}
                className={`text-xs px-2 py-1 rounded-lg border ${!form.mediaId ? "border-indigo-500 text-indigo-300" : "border-white/10 text-slate-400"}`}
              >Todos os posts</button>
              {mediaLoading && <span className="text-xs text-slate-500">carregando posts…</span>}
            </div>
            {media.length > 0 && (
              <div className="grid grid-cols-5 gap-1.5">
                {media.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => set("mediaId", m.id)}
                    className={`aspect-square rounded-lg overflow-hidden border-2 ${form.mediaId === m.id ? "border-indigo-500" : "border-transparent"}`}
                    title={m.caption}
                  >
                    {m.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-white/10" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Gatilho</label>
            <select className={input} value={form.triggerType} onChange={(e) => set("triggerType", e.target.value)}>
              <option value="KEYWORD">Comentário contém palavra-chave</option>
              <option value="ANY">Qualquer comentário</option>
            </select>
          </div>

          {form.triggerType === "KEYWORD" && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Palavras-chave (separadas por vírgula)</label>
              <input className={input} value={form.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="quero, link, eu quero" />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.replyToComment} onChange={(e) => set("replyToComment", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
            Responder o comentário publicamente
          </label>
          {form.replyToComment && (
            <textarea
              className={input}
              rows={3}
              value={form.commentReplies}
              onChange={(e) => set("commentReplies", e.target.value)}
              placeholder="Uma resposta por linha — o sistema escolhe uma aleatória a cada comentário"
            />
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.sendDm} onChange={(e) => set("sendDm", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
            Enviar DM (direct)
          </label>
          {form.sendDm && (
            <>
              <input className={input} value={form.dmText} onChange={(e) => set("dmText", e.target.value)} placeholder={form.dmButtonLabel ? "Mensagem de abertura (ex: Legal que você quer X! Toca abaixo 👇)" : "Texto do DM"} />
              <input className={input} value={form.dmButtonLabel} onChange={(e) => set("dmButtonLabel", e.target.value)} placeholder='Texto do botão (opcional, ex: "Quero receber") — ativa o fluxo de botão' />
              {form.dmButtonLabel && (
                <textarea className={input} rows={2} value={form.deliveredText} onChange={(e) => set("deliveredText", e.target.value)} placeholder="Conteúdo entregue depois do clique (texto)" />
              )}
              <input className={input} value={form.dmLinkUrl} onChange={(e) => set("dmLinkUrl", e.target.value)} placeholder="Link entregue (https://...)" />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={form.requireFollow} onChange={(e) => set("requireFollow", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                🔒 Só liberar depois de seguir (follow-gate)
              </label>
              {form.requireFollow && (
                <input className={input} value={form.notFollowingText} onChange={(e) => set("notFollowingText", e.target.value)} placeholder='Mensagem de "me segue antes" (o link do perfil é anexado)' />
              )}
              {form.dmButtonLabel && (
                <p className="text-[11px] text-slate-500">
                  Fluxo de botão: manda a abertura com o botão; ao clicar{form.requireFollow ? " (e seguir)" : ""}, entrega o conteúdo + link.
                </p>
              )}
            </>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-300 hover:text-white">Cancelar</button>
            <button onClick={onSave} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-50">
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
