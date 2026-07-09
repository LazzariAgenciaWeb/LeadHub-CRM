"use client";

import { useState } from "react";

type Ticket = { id: string; title: string; category: string | null; status: string; createdAt: string };
type Service = { id: string; name: string; description: string | null };

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

export default function MeuEspacoInteracoes({
  tickets: initialTickets, services,
}: {
  tickets: Ticket[]; services: Service[];
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

  return (
    <>
      {/* CHAMADOS & PEDIDOS */}
      <section className="row">
        <div className="rowhead"><h2>Chamados &amp; pedidos</h2><span className="sub">suporte e solicitações</span></div>
        <div className="rail">
          <button className="actcard sup" onClick={() => open("SUPPORT")}>
            <span className="acic">🛟</span>
            <span className="acb"><b>Abrir chamado</b><span>problema, dúvida ou ajuste</span></span>
          </button>
          <button className="actcard ped" onClick={() => open("REQUEST")}>
            <span className="acic">✨</span>
            <span className="acb"><b>Pedir algo extra</b><span>serviço ou conteúdo pontual</span></span>
          </button>
          {tickets.map((t) => {
            const st = ST[t.status] ?? { label: t.status, tone: "muted" };
            const ped = t.category === "Pedido";
            return (
              <div key={t.id} className="tkt">
                <div className="tkttop">
                  <span className={`tktype ${ped ? "ped" : "sup"}`}>{ped ? "Pedido" : "Suporte"}</span>
                  <span className={`pill ${st.tone}`}>{st.label}</span>
                </div>
                <h3>{t.title}</h3>
                <div className="tktmeta">{fmt(t.createdAt)}</div>
              </div>
            );
          })}
        </div>
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
    </>
  );
}
