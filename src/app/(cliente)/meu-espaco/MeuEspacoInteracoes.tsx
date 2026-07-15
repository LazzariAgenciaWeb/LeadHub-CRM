"use client";

import { useState } from "react";

type Ticket = { id: string; title: string; category: string | null; status: string; createdAt: string };
type Service = { id: string; name: string; description: string | null };
type Msg = { id: string; body: string; authorName: string; mine: boolean; createdAt: string };
type Detail = { id: string; title: string; category: string | null; status: string; createdAt: string; messages: Msg[] };

const ST: Record<string, { label: string; tone: string }> = {
  OPEN:        { label: "Aberto",        tone: "info" },
  IN_PROGRESS: { label: "Em atendimento", tone: "info" },
  RESOLVED:    { label: "Resolvido",     tone: "ok" },
  CLOSED:      { label: "Fechado",       tone: "muted" },
};
const COVERS = [
  "linear-gradient(135deg,#8B5CF6,#EC4899)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
  "linear-gradient(135deg,#F59E0B,#F97316)",
  "linear-gradient(135deg,#10B981,#0D9488)",
  "linear-gradient(135deg,#3D5AF1,#6366F1)",
];
const fmt = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const fmtDT = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function MeuEspacoInteracoes({
  tickets: initialTickets, services, stats,
}: {
  tickets: Ticket[]; services: Service[];
  stats: { open: number; inProgress: number; resolved: number; total: number };
}) {
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);

  // Modal: kind SUPPORT|REQUEST, com serviço opcional (pedido a partir do catálogo).
  const [modal, setModal] = useState<null | { kind: "SUPPORT" | "REQUEST"; serviceId?: string; serviceName?: string }>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function open(kind: "SUPPORT" | "REQUEST", service?: Service) {
    setErr(""); setTitle(""); setDesc("");
    setModal({ kind, serviceId: service?.id, serviceName: service?.name });
  }

  async function submit() {
    if (!title.trim()) { setErr("Escreva um assunto."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/meu-espaco/chamados", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: modal!.kind, serviceId: modal!.serviceId, title: title.trim(), description: desc.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setTickets((t) => [data.ticket, ...t]);
      setModal(null);
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  }

  const isPedido = modal?.kind === "REQUEST";

  // Detalhe do chamado (thread + responder)
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);

  async function openDetail(id: string) {
    setDetailId(id); setDetail(null); setReply("");
    const res = await fetch(`/api/meu-espaco/chamados/${id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function sendReply() {
    if (!reply.trim() || !detail) return;
    setReplying(true);
    const res = await fetch(`/api/meu-espaco/chamados/${detail.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply.trim() }),
    });
    setReplying(false);
    if (res.ok) {
      const d = await res.json();
      setDetail({ ...detail, status: d.status, messages: [...detail.messages, d.message] });
      setTickets((ts) => ts.map((t) => (t.id === detail.id ? { ...t, status: d.status } : t)));
      setReply("");
    }
  }

  return (
    <>
      {/* CHAMADOS & PEDIDOS */}
      <section className="row">
        <div className="rowhead"><h2>Chamados &amp; pedidos</h2><span className="sub">suporte e solicitações</span></div>
        {stats.total > 0 && (
          <div className="tkstats">
            <div className="tkstat open"><span className="dot" /><b>{stats.open}</b><span>Em aberto</span></div>
            <div className="tkstat prog"><span className="dot" /><b>{stats.inProgress}</b><span>Em atendimento</span></div>
            <div className="tkstat done"><span className="dot" /><b>{stats.resolved}</b><span>Atendidos</span></div>
          </div>
        )}
        <div className="acrow">
          <button className="actcard sup" onClick={() => open("SUPPORT")}>
            <span className="acic">🛟</span>
            <span className="acb"><b>Abrir chamado</b><span>problema, dúvida ou ajuste</span></span>
          </button>
          <button className="actcard ped" onClick={() => open("REQUEST")}>
            <span className="acic">✨</span>
            <span className="acb"><b>Pedir algo extra</b><span>serviço ou conteúdo pontual</span></span>
          </button>
        </div>
        {tickets.length > 0 && (
          <div className="demands">
            <div className="dhead">Últimas demandas · por ordem de execução</div>
            {tickets.map((t, i) => {
              const st = ST[t.status] ?? { label: t.status, tone: "muted" };
              const ped = t.category === "Pedido";
              return (
                <div key={t.id} className="drow" onClick={() => openDetail(t.id)}>
                  <span className="didx">{i + 1}</span>
                  <div className="dmid">
                    <div className="dtt">{t.title}</div>
                    <div className="dsub">{ped ? "Pedido" : "Suporte"}</div>
                  </div>
                  <span className={`pill ${st.tone}`}>{st.label}</span>
                  <span className="dwhen">{fmt(t.createdAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* DISPONÍVEL PARA VOCÊ */}
      {services.length > 0 && (
        <section className="row">
          <div className="rowhead"><h2>Disponível para você</h2><span className="sub">serviços que a gente pode fazer por você</span></div>
          <div className="rail">
            {services.map((s, i) => (
              <div key={s.id} className="poster avail">
                <div className="cover" style={{ background: COVERS[i % COVERS.length] }}>
                  <span className="pico">{s.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="pbody">
                  <h3>{s.name}</h3>
                  {s.description && <div className="benefit">{s.description}</div>}
                  <button className="btnint" onClick={() => open("REQUEST", s)}>Tenho interesse</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* MODAL */}
      {modal && (
        <div className="mkov" onClick={() => setModal(null)}>
          <div className="mkcard" onClick={(e) => e.stopPropagation()}>
            <div className="mkhead">
              <b>{isPedido ? (modal.serviceName ? `Tenho interesse: ${modal.serviceName}` : "Pedir algo extra") : "Abrir chamado"}</b>
              <button className="mkx" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="mkbody">
              <label>Assunto</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
                placeholder={isPedido ? "O que você precisa?" : "Qual o problema ou dúvida?"} />
              <label>Detalhes (opcional)</label>
              <textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)}
                placeholder="Conte um pouco mais pra gente já entender…" />
              {err && <p className="mkerr">{err}</p>}
            </div>
            <div className="mkfoot">
              <button className="mkcancel" onClick={() => setModal(null)}>Cancelar</button>
              <button className="mksend" onClick={submit} disabled={saving}>{saving ? "Enviando…" : "Enviar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALHE — andamento do chamado + responder */}
      {detailId && (
        <div className="mkov" onClick={() => setDetailId(null)}>
          <div className="mkcard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="mkhead">
              <b>{detail ? detail.title : "Carregando…"}</b>
              <button className="mkx" onClick={() => setDetailId(null)}>✕</button>
            </div>
            <div className="mkbody">
              {!detail ? (
                <p style={{ color: "#727A8C", fontSize: 13 }}>Carregando o andamento…</p>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                    <span className={`tktype ${detail.category === "Pedido" ? "ped" : "sup"}`}>{detail.category === "Pedido" ? "Pedido" : "Suporte"}</span>
                    <span className={`pill ${(ST[detail.status] ?? { tone: "muted" }).tone}`}>{(ST[detail.status] ?? { label: detail.status }).label}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "42vh", overflowY: "auto", paddingRight: 4 }}>
                    {detail.messages.map((m) => (
                      <div key={m.id} style={{ alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "86%" }}>
                        <div style={{ fontSize: 11, color: "#727A8C", margin: "0 2px 3px", textAlign: m.mine ? "right" : "left" }}>
                          {m.mine ? "Você" : m.authorName} · {fmtDT(m.createdAt)}
                        </div>
                        <div style={{
                          background: m.mine ? "linear-gradient(135deg,#6E86FF,#9B7BFF)" : "rgba(255,255,255,.06)",
                          color: m.mine ? "#fff" : "#E7EAF3",
                          border: m.mine ? "none" : "1px solid rgba(255,255,255,.10)",
                          borderRadius: 13, padding: "9px 13px", fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap",
                        }}>{m.body}</div>
                      </div>
                    ))}
                  </div>
                  <label style={{ marginTop: 16 }}>Sua resposta</label>
                  <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)}
                    placeholder="Escreva um retorno pra equipe…" />
                </>
              )}
            </div>
            <div className="mkfoot">
              <button className="mkcancel" onClick={() => setDetailId(null)}>Fechar</button>
              <button className="mksend" onClick={sendReply} disabled={replying || !reply.trim() || !detail}>{replying ? "Enviando…" : "Responder"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
