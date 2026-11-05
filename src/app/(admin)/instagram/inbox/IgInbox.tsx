"use client";

import { useEffect, useState, useCallback, useRef } from "react";

type Flags = {
  inCount: number;
  outCount: number;
  interacted: boolean;
  weStarted: boolean;
  returned: boolean;
  repliedToOutreach: boolean;
};

type ConvoLead = { id: string; name: string | null; pipeline: string | null };

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
  lead?: ConvoLead | null;
  flags?: Flags;
};

type Msg = {
  id: string;
  direction: "IN" | "OUT";
  source: "ORGANIC" | "AUTOMATION" | "AGENT" | "EXTERNAL" | "AI";
  text: string | null;
  createdAt: string;
};

type AiMode = "ACTIVE" | "PAUSED_HUMAN" | "OFF";
type FollowGate = { status: string; followState: string; updatedAt: string } | null;

type Filter = "all" | "needsReply" | "returned" | "interacted" | "lead" | "automation";

type Conn = {
  kind: "INSTAGRAM" | "MESSENGER";
  id: string;
  label: string;
  avatar: string | null;
  state: "ONLINE" | "EXPIRING" | "OFFLINE";
  reason: string | null;
  tokenExpiresAt: string | null;
  reconnectUrl: string;
  canResubscribe: boolean;
};

type Overview = {
  connections: Conn[];
  connectUrl: string;
  fbConnectUrl: string;
  stats: {
    days: number;
    conversas: number;
    interagiram: number;
    retornaram: number;
    responderamProspeccao: number;
    nossoContatoSemResposta: number;
    semResposta: number;
    automacao: number;
    porCanal: Record<string, number>;
  };
  leads: {
    total: number;
    prospeccao: number;
    leads: number;
    oportunidades: number;
    ganhos: number;
    perdidos: number;
    valorGanho: number;
    deComentario: number;
  };
};

// Deep-link pro lead na tela certa do CRM conforme o pipeline atual.
function leadUrl(l: ConvoLead): string {
  const page = l.pipeline === "OPORTUNIDADES" ? "oportunidades" : l.pipeline === "LEADS" ? "leads" : "prospeccao";
  return `/crm/${page}?lead=${l.id}`;
}

const SOURCE_LABEL: Record<string, string> = { AUTOMATION: "automação", AGENT: "atendente", EXTERNAL: "fora do LeadHub", AI: "agente IA", ORGANIC: "" };
const AI_MODE_LABEL: Record<AiMode, string> = { ACTIVE: "IA ativa", PAUSED_HUMAN: "IA pausada (humano assumiu)", OFF: "IA desligada" };
// Follow-gate: "não deu pra verificar" é um estado de verdade — a Meta às vezes
// não responde e o sistema libera no benefício da dúvida. Mostrar isso evita a
// leitura errada de que todo mundo que recebeu o link seguiu o perfil.
const FOLLOW_BADGE: Record<string, { label: string; cls: string; hint: string }> = {
  FOLLOWING: { label: "✅ segue", cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300", hint: "Confirmado pela Meta: segue o perfil que recebe este DM." },
  NOT_FOLLOWING: { label: "❌ não segue", cls: "border-red-400/30 bg-red-500/10 text-red-300", hint: "A Meta respondeu que não segue o perfil que recebe este DM." },
  UNKNOWN: { label: "⚠️ não verificado", cls: "border-amber-400/30 bg-amber-500/10 text-amber-300", hint: "A Meta não respondeu se segue — o sistema liberou no benefício da dúvida." },
};
// Motivo da última tentativa do agente (IgConversation.aiLastResult).
// warn = ele queria responder e algo impediu — fica à vista.
function describeIgResult(code: string | null | undefined): { text: string; warn: boolean } | null {
  if (!code) return null;
  if (code === "ok:NONE:sem_envio") return { text: "leu e não viu nada a responder", warn: false };
  if (code.startsWith("ok:HANDOFF")) return { text: "respondeu e passou pro time", warn: false };
  if (code.startsWith("ok:")) return { text: "respondeu", warn: false };
  const map: Record<string, { text: string; warn: boolean }> = {
    aiMode_PAUSED_HUMAN: { text: "pausada — um humano assumiu (clique em Continuar atendimento)", warn: false },
    aiMode_OFF: { text: "desligada nesta conversa", warn: false },
    ja_respondida: { text: "a conversa já estava respondida", warn: false },
    sem_agente_vinculado: { text: "nenhum agente ativo ligado a esta conta do Instagram", warn: true },
    automacao_em_andamento: { text: "uma automação ou pedido de follow está em andamento com esse contato", warn: true },
    conversa_de_automacao: { text: "a conversa nasceu de automação (opção \"não assumir\" ligada)", warn: true },
    conta_sem_token: { text: "conta do Instagram sem token — reconectar", warn: true },
    fora_janela_24h: { text: "passou da janela de 24h da Meta — só dá pra responder manualmente", warn: true },
    sem_texto_do_contato: { text: "o contato mandou só mídia/figurinha, sem texto", warn: false },
    contato_e_robo: { text: "quem respondeu foi o robô de atendimento do contato", warn: false },
    follow_pedido: { text: "pediu o follow e está esperando a confirmação", warn: false },
    respondida_durante_ia: { text: "alguém respondeu enquanto ela pensava", warn: false },
    contato_escreveu_durante_ia: { text: "o contato mandou outra mensagem — respondeu tudo junto na rodada seguinte", warn: false },
    ia_QUOTA: { text: "cota de IA da empresa esgotada", warn: true },
    ia_NO_CONFIG: { text: "IA sem configuração (chave/modelo)", warn: true },
    ia_AI_ERROR: { text: "o provedor de IA não respondeu", warn: true },
    envio_falhou: { text: "a mensagem não saiu pelo Instagram", warn: true },
  };
  return map[code] ?? { text: code, warn: false };
}

const CHANNEL: Record<string, { label: string; cls: string }> = {
  INSTAGRAM: { label: "Instagram", cls: "bg-pink-500/20 text-pink-300" },
  MESSENGER: { label: "Messenger", cls: "bg-blue-500/20 text-blue-300" },
  FACEBOOK: { label: "Facebook", cls: "bg-indigo-500/20 text-indigo-300" },
};

const FILTER_LABEL: Record<Filter, { label: string; hint: string }> = {
  all: { label: "Todas", hint: "Todas as conversas da empresa, mais recentes primeiro." },
  needsReply: { label: "Sem resposta", hint: "O contato falou por último e ninguém do time respondeu." },
  returned: { label: "Retornaram", hint: "O contato escreveu DEPOIS da nossa primeira mensagem — voltou a conversa." },
  interacted: { label: "Interagiram", hint: "O contato escreveu alguma coisa (não é só o que nós mandamos)." },
  lead: { label: "Viraram lead", hint: "Conversa vinculada a um lead do CRM." },
  automation: { label: "De automação", hint: "Conversa que nasceu de uma automação de comentário." },
};

const PERIODS = [7, 30, 90] as const;

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

/**
 * Saúde da conexão — a parte que faltava.
 *
 * Token vencido ou conta desautorizada deixa a inbox MUDA: nenhum DM entra,
 * nenhuma resposta sai, e a tela parecia só "sem conversa nova". Agora o
 * motivo e o botão de reconectar ficam no topo da própria inbox, sem ter que
 * passar por Configurações → Integrações pra descobrir.
 */
function ConnectionStrip({ data, onReload }: { data: Overview | null; onReload: () => void }) {
  const [resub, setResub] = useState("");
  const [resubbing, setResubbing] = useState(false);

  async function resubscribe() {
    setResubbing(true);
    setResub("");
    try {
      const r = await fetch("/api/instagram/account/resubscribe", { method: "POST" }).then((x) => x.json());
      setResub(r.ok ? `Webhooks reativados ✓ (${(r.fields || []).join(", ")})` : `Erro: ${r.error || "falhou"}`);
      if (r.ok) onReload();
    } catch {
      setResub("Erro de rede");
    } finally {
      setResubbing(false);
    }
  }

  if (!data) return null;
  const conns = data.connections;

  if (conns.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 flex items-center justify-between gap-3">
        <p className="text-amber-200 text-sm">
          Nenhuma conta conectada — a inbox não recebe nem envia mensagem.
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <a href={data.connectUrl} className="rounded-lg bg-gradient-to-r from-pink-500 to-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
            Conectar Instagram
          </a>
          <a href={data.fbConnectUrl} className="rounded-lg border border-blue-400/40 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/10">
            Conectar Facebook
          </a>
        </div>
      </div>
    );
  }

  const broken = conns.filter((c) => c.state !== "ONLINE");

  if (broken.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-3 flex-wrap text-xs">
        {conns.map((c) => (
          <span key={c.id} className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-slate-300">{c.label}</span>
            <span className="text-slate-500">
              {c.kind === "INSTAGRAM" ? "Instagram" : "Messenger"} online
            </span>
          </span>
        ))}
        <button
          onClick={resubscribe}
          disabled={resubbing}
          className="text-slate-500 hover:text-slate-300 underline decoration-dotted disabled:opacity-50"
          title="Reassina os webhooks (comentários, DMs, cliques de botão). Use quando a conta está conectada mas nada chega."
        >
          {resubbing ? "Atualizando…" : "Atualizar conexão"}
        </button>
        {resub && <span className="text-slate-500">{resub}</span>}
      </div>
    );
  }

  const severe = broken.some((c) => c.state === "OFFLINE");
  return (
    <div className={`mb-4 rounded-xl border p-3 ${severe ? "border-red-400/30 bg-red-500/10" : "border-amber-400/30 bg-amber-500/10"}`}>
      <p className={`text-sm font-medium ${severe ? "text-red-200" : "text-amber-200"}`}>
        {severe
          ? "Conexão offline — a inbox não recebe nem envia mensagem"
          : "Conexão perto de vencer"}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {broken.map((c) => (
          <div key={c.id} className="flex items-center gap-2 flex-wrap">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.state === "OFFLINE" ? "bg-red-400" : "bg-amber-400"}`} />
            <span className="text-white text-xs font-medium">{c.label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${CHANNEL[c.kind]?.cls || "bg-slate-500/20 text-slate-300"}`}>
              {c.kind === "INSTAGRAM" ? "Instagram" : "Messenger"}
            </span>
            <span className="text-xs text-slate-300 flex-1 min-w-[12rem]">{c.reason}</span>
            <a
              href={c.reconnectUrl}
              className="rounded-lg bg-gradient-to-r from-pink-500 to-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 flex-shrink-0"
              title="Refaz a autorização na Meta e renova o token"
            >
              Reconectar
            </a>
            {c.canResubscribe && (
              <button
                onClick={resubscribe}
                disabled={resubbing}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50 flex-shrink-0"
                title="Reassina os webhooks sem refazer a autorização"
              >
                {resubbing ? "Atualizando…" : "Atualizar conexão"}
              </button>
            )}
          </div>
        ))}
      </div>
      {resub && <p className="text-xs text-slate-300 mt-2">{resub}</p>}
      {/* Conexões sadias continuam listadas: numa empresa com IG + 2 páginas,
          saber QUAL caiu é metade do diagnóstico. */}
      {conns.length > broken.length && (
        <p className="text-[11px] text-slate-400 mt-2">
          Online: {conns.filter((c) => c.state === "ONLINE").map((c) => c.label).join(", ")}
        </p>
      )}
    </div>
  );
}

/** Card de métrica. Clicável quando existe filtro equivalente na lista. */
function Kpi({
  label, value, hint, sub, tone = "slate", filter, active, onPick,
}: {
  label: string;
  value: string | number;
  hint: string;
  sub?: string;
  tone?: "slate" | "emerald" | "amber" | "indigo";
  filter?: Filter;
  active?: boolean;
  onPick?: (f: Filter) => void;
}) {
  const toneCls = {
    slate: "text-white",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    indigo: "text-indigo-300",
  }[tone];
  const clickable = !!filter && !!onPick;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => filter && onPick?.(filter)}
      title={hint + (clickable ? "\n\nClique pra filtrar a lista." : "")}
      className={`text-left rounded-xl border bg-white/5 px-3 py-2.5 transition ${
        active ? "border-indigo-400/50 bg-indigo-500/10" : "border-white/10"
      } ${clickable ? "hover:bg-white/10 cursor-pointer" : "cursor-default"}`}
    >
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-semibold leading-tight ${toneCls}`}>{value}</p>
      <p className="text-[10px] text-slate-500 truncate">{sub ?? " "}</p>
    </button>
  );
}

export default function IgInbox() {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [pending, setPending] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<number>(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<Convo | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [aiMode, setAiMode] = useState<AiMode | null>(null);
  const [aiSaving, setAiSaving] = useState(false);
  const [convoLead, setConvoLead] = useState<ConvoLead | null>(null);
  const [followGate, setFollowGate] = useState<FollowGate>(null);
  const [aiLast, setAiLast] = useState<{ result: string | null; at: string | null }>({ result: null, at: null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/instagram/inbox?filter=${filter}`).then((r) => r.json());
      setConvos(res.conversations || []);
      setPending(res.pending || 0);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadOverview = useCallback(async () => {
    const res = await fetch(`/api/instagram/inbox/overview?days=${days}`).then((r) => r.json()).catch(() => null);
    if (res && res.connections) setOverview(res);
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);

  // Deep-link: /instagram/inbox?ig=usuario abre a conversa daquele @ (vindo
  // do card do lead no CRM).
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || loading || !convos.length) return;
    const ig = new URLSearchParams(window.location.search).get("ig")?.replace(/^@/, "").toLowerCase();
    if (!ig) { deepLinked.current = true; return; }
    const match = convos.find((c) => (c.participantUsername ?? "").toLowerCase() === ig);
    if (match) void openConvo(match);
    deepLinked.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, convos]);

  async function openConvo(c: Convo) {
    setSelected(c);
    setMsgs([]);
    setSendErr("");
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/instagram/inbox/${c.id}`).then((r) => r.json());
      setMsgs(res.messages || []);
      setAiMode(res.conversation?.aiMode ?? null);
      setConvoLead(res.conversation?.lead ?? null);
      setFollowGate(res.followGate ?? null);
      setAiLast({ result: res.conversation?.aiLastResult ?? null, at: res.conversation?.aiLastRunAt ?? null });
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
      void loadOverview();
    } finally {
      setSending(false);
    }
  }

  const st = overview?.stats;
  const lead = overview?.leads;
  const taxaRetorno = st && st.conversas > 0 ? Math.round((st.retornaram / st.conversas) * 100) : 0;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h1 className="text-xl font-semibold text-white">Inbox · Social</h1>
        <div className="flex gap-1 text-xs ml-auto">
          {PERIODS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg ${days === d ? "bg-white/10 text-white border border-white/20" : "border border-white/10 text-slate-400 hover:bg-white/5"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <ConnectionStrip data={overview} onReload={loadOverview} />

      {/* Resultado do canal: o que entrou, quem voltou a falar e o que virou
          lead. Tudo sobre as conversas ATIVAS no período escolhido. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <Kpi
          label={`Conversas · ${days}d`}
          value={st?.conversas ?? "—"}
          hint={`Conversas com mensagem nos últimos ${days} dias, somando Instagram, Messenger e Facebook.`}
          sub={st ? Object.entries(st.porCanal).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${CHANNEL[k]?.label ?? k}`).join(" · ") : undefined}
          filter="all"
          active={filter === "all"}
          onPick={setFilter}
        />
        <Kpi
          label="Interagiram"
          value={st?.interagiram ?? "—"}
          hint="O contato escreveu alguma coisa na conversa — não é só o que nós mandamos."
          sub={st && st.conversas ? `${Math.round((st.interagiram / st.conversas) * 100)}% das conversas` : undefined}
          tone="indigo"
          filter="interacted"
          active={filter === "interacted"}
          onPick={setFilter}
        />
        <Kpi
          label="Retornaram"
          value={st?.retornaram ?? "—"}
          hint="O contato escreveu DEPOIS da nossa primeira mensagem: respondeu a prospecção ou voltou depois do nosso atendimento."
          sub={st ? `${taxaRetorno}% de retorno` : undefined}
          tone="emerald"
          filter="returned"
          active={filter === "returned"}
          onPick={setFilter}
        />
        <Kpi
          label="Prospecção"
          value={st ? `${st.responderamProspeccao}/${st.responderamProspeccao + st.nossoContatoSemResposta}` : "—"}
          hint="Conversas em que NÓS falamos primeiro (prospecção, automação): quantas foram respondidas do total abordado."
          sub={st && st.responderamProspeccao + st.nossoContatoSemResposta > 0
            ? `${Math.round((st.responderamProspeccao / (st.responderamProspeccao + st.nossoContatoSemResposta)) * 100)}% respondeu`
            : "nenhuma abordagem"}
          tone="indigo"
        />
        <Kpi
          label="Sem resposta"
          value={pending}
          hint="O contato falou por último e ninguém do time respondeu. Número de agora, não do período."
          sub={st ? `${st.automacao} de automação` : undefined}
          tone={pending > 0 ? "amber" : "slate"}
          filter="needsReply"
          active={filter === "needsReply"}
          onPick={setFilter}
        />
        <Kpi
          label="Leads daqui"
          value={lead?.total ?? "—"}
          hint="Leads do CRM vinculados a estas conversas (match pelo @ na prospecção e promoção automática quando o contato responde no Direct)."
          sub={lead
            ? [
                lead.oportunidades ? `${lead.oportunidades} oport.` : null,
                lead.ganhos ? `${lead.ganhos} ganho${lead.ganhos > 1 ? "s" : ""} · ${brl(lead.valorGanho)}` : null,
                lead.deComentario ? `+${lead.deComentario} de comentário` : null,
              ].filter(Boolean).join(" · ") || "nenhum fechado ainda"
            : undefined}
          tone="emerald"
          filter="lead"
          active={filter === "lead"}
          onPick={setFilter}
        />
      </div>

      <div className="flex gap-1 text-xs mb-3 flex-wrap">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            title={FILTER_LABEL[f].hint}
            className={`px-2.5 py-1 rounded-lg ${filter === f ? "bg-indigo-500 text-white" : "border border-white/10 text-slate-400 hover:bg-white/5"}`}
          >
            {FILTER_LABEL[f].label}
            {f === "needsReply" && pending ? ` (${pending})` : ""}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[70vh]">
        {/* Lista */}
        <div className="rounded-xl border border-white/10 bg-white/5 overflow-y-auto">
          {loading && <p className="p-3 text-slate-500 text-sm">Carregando…</p>}
          {!loading && convos.length === 0 && (
            <p className="p-3 text-slate-500 text-sm">
              {filter === "all" ? "Nenhuma conversa." : `Nenhuma conversa em "${FILTER_LABEL[filter].label}".`}
            </p>
          )}
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
              {/* Selos de resultado: dá pra varrer a lista e ver quem voltou a
                  falar e quem já é lead, sem abrir conversa por conversa. */}
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {c.flags?.returned && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-400/30 bg-emerald-500/10 text-emerald-300" title="Escreveu depois da nossa primeira mensagem">
                    ↩ retornou
                  </span>
                )}
                {c.flags?.weStarted && !c.flags?.interacted && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-slate-500" title="Nós falamos e o contato nunca respondeu">
                    sem retorno
                  </span>
                )}
                {c.lead && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-indigo-400/30 bg-indigo-500/10 text-indigo-300" title={`Lead no CRM (${c.lead.pipeline ?? "?"})`}>
                    🎯 {c.lead.pipeline === "OPORTUNIDADES" ? "oportunidade" : c.lead.pipeline === "LEADS" ? "lead" : "prospect"}
                  </span>
                )}
                {c.lastMessageAt && (
                  <span className="text-[9px] text-slate-600 ml-auto">
                    {new Date(c.lastMessageAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </span>
                )}
              </div>
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
                  {convoLead && (
                    <a
                      href={leadUrl(convoLead)}
                      className="text-[10px] px-2 py-1 rounded-lg border border-indigo-400/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                      title={`Abrir no CRM (${convoLead.pipeline ?? "?"})`}
                    >
                      🎯 {convoLead.name || "Lead"} · {convoLead.pipeline === "OPORTUNIDADES" ? "Oportunidade" : convoLead.pipeline === "LEADS" ? "Lead" : "Prospecção"}
                    </a>
                  )}
                  {selected.channel === "INSTAGRAM" && followGate && FOLLOW_BADGE[followGate.followState] && (
                    <span
                      className={`text-[10px] px-2 py-1 rounded-lg border ${FOLLOW_BADGE[followGate.followState].cls}`}
                      title={
                        followGate.status === "AWAITING_FOLLOW"
                          ? "Pedimos o follow e ainda não confirmamos."
                          : FOLLOW_BADGE[followGate.followState].hint
                      }
                    >
                      {FOLLOW_BADGE[followGate.followState].label}
                      {followGate.status === "AWAITING_FOLLOW" ? " · aguardando" : ""}
                    </span>
                  )}
                  {selected.channel === "INSTAGRAM" && describeIgResult(aiLast.result)?.warn && (
                    <span
                      className="text-[10px] px-2 py-1 rounded-lg border border-amber-400/30 bg-amber-500/10 text-amber-300"
                      title="Motivo da última vez que o agente tentou responder nesta conversa"
                    >
                      ⚠️ IA não respondeu: {describeIgResult(aiLast.result)!.text}
                    </span>
                  )}
                  {selected.channel === "INSTAGRAM" && aiMode && (
                    <button
                      onClick={toggleAi}
                      disabled={aiSaving}
                      title={
                        AI_MODE_LABEL[aiMode] +
                        (describeIgResult(aiLast.result)
                          ? `\n\nÚltima tentativa${aiLast.at ? ` (${new Date(aiLast.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})` : ""}: ${describeIgResult(aiLast.result)!.text}`
                          : "")
                      }
                      className={`text-[10px] px-2 py-1 rounded-lg border disabled:opacity-50 ${
                        aiMode === "ACTIVE"
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                          : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                      }`}
                    >
                      {/* Reativar agora responde na hora o que ficou pendente
                          — por isso o rótulo diz o que acontece de fato. */}
                      {aiMode === "ACTIVE" ? "🤖 IA ativa · pausar" : "▶ Continuar atendimento com IA"}
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
