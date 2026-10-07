"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Tela do CLIENTE pra aprovar uma peça pelo link do WhatsApp (sem login).
 * Pensada pro celular: carrossel com swipe, botões fixos no rodapé, nome
 * lembrado no aparelho pra não digitar toda vez.
 */

export type ApprovalFile = { id: string; fileName: string; mimeType: string; status: string | null; note: string | null };

type Props = {
  token: string;
  title: string;
  description: string | null;
  clientName: string | null;
  projectName: string;
  panelToken: string | null;
  status: string;
  round: number;
  sentAt: string | null;
  dueDate: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  versionText: string;
  files: ApprovalFile[];
  links: { url: string; title: string }[];
  history: { text: string; at: string; byClient: boolean }[];
};

const NAME_KEY = "lh-aprovador-nome";

const STYLE = `
.ap{--accent:#6E86FF;--ok:#4FD1A0;--warn:#F5B564;--ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;
  --line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--card:rgba(255,255,255,.04);
  min-height:100vh;color:var(--ink);background:radial-gradient(110% 70% at 85% -10%,rgba(110,134,255,.16),transparent 60%),#06070C;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5}
.ap *{box-sizing:border-box}
.apw{max-width:640px;margin:0 auto;padding:22px 16px 180px}
.eyebrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--ink3)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid var(--line2);font-size:11px;font-weight:600;color:var(--ink2)}
.chip.warn{color:var(--warn);border-color:rgba(245,181,100,.35);background:rgba(245,181,100,.08)}
.chip.ok{color:var(--ok);border-color:rgba(79,209,160,.35);background:rgba(79,209,160,.08)}
h1{font-size:22px;line-height:1.25;margin:10px 0 4px;letter-spacing:-.01em}
.sub{color:var(--ink3);font-size:13px}
.car{margin:18px -16px 0;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:10px;padding:0 16px;scrollbar-width:none}
.car::-webkit-scrollbar{display:none}
.slide{flex:0 0 100%;scroll-snap-align:center;border-radius:18px;overflow:hidden;background:#0B0D15;border:1px solid var(--line);position:relative}
.slide img,.slide video{display:block;width:100%;height:auto;max-height:78vh;object-fit:contain;background:#000}
.slide .doc{padding:28px 18px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.slide .tag{position:absolute;top:10px;left:10px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(6,7,12,.75);border:1px solid var(--line2)}
.dots{display:flex;justify-content:center;gap:6px;margin-top:10px}
.dot{width:7px;height:7px;border-radius:999px;background:var(--line2);border:0;padding:0}
.dot.on{background:var(--accent);width:18px}
.count{text-align:center;color:var(--ink3);font-size:12px;margin-top:6px}
.card{margin-top:16px;padding:14px 16px;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.card h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3)}
.pre{white-space:pre-wrap;word-break:break-word;font-size:14px;color:var(--ink2)}
.hist{display:flex;flex-direction:column;gap:8px}
.msg{padding:9px 12px;border-radius:12px;font-size:13px;white-space:pre-wrap;word-break:break-word;max-width:92%}
.msg.me{align-self:flex-end;background:rgba(110,134,255,.14);border:1px solid rgba(110,134,255,.3)}
.msg.them{align-self:flex-start;background:var(--card);border:1px solid var(--line)}
.msg small{display:block;color:var(--ink3);font-size:11px;margin-top:2px}
.bar{position:fixed;left:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(6,7,12,0),rgba(6,7,12,.92) 22%,#06070C);padding:22px 16px calc(14px + env(safe-area-inset-bottom))}
.barw{max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:8px}
.row{display:flex;gap:8px}
input.f,textarea.f{width:100%;background:#0B0D15;border:1px solid var(--line2);border-radius:12px;color:var(--ink);padding:11px 12px;font-size:16px;font-family:inherit}
textarea.f{min-height:84px;resize:vertical}
input.f:focus,textarea.f:focus{outline:none;border-color:var(--accent)}
.btn{flex:1;border:0;border-radius:14px;padding:14px 12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit}
.btn:disabled{opacity:.5;cursor:default}
.btn.ok{background:var(--ok);color:#04150F}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line2)}
.err{color:#FF8A8A;font-size:13px}
.banner{margin-top:18px;padding:16px;border-radius:16px;font-size:14px}
.banner.ok{background:rgba(79,209,160,.1);border:1px solid rgba(79,209,160,.35);color:#BDF3DF}
.banner.info{background:rgba(110,134,255,.1);border:1px solid rgba(110,134,255,.3);color:#D5DCFF}
.lk{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid var(--line2);background:#0B0D15;color:var(--ink);text-decoration:none;font-size:14px;font-weight:600;margin-top:8px}
.lk:first-of-type{margin-top:0}
.lk span.t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lk span.go{color:var(--accent);font-size:13px}
.links{margin-top:22px;display:flex;flex-direction:column;gap:8px;font-size:13px}
.links a{color:var(--ink2)}
a.open{color:var(--accent);font-size:13px;font-weight:600}
`;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export default function AprovarClient(p: Props) {
  const [status, setStatus] = useState(p.status);
  const [mode, setMode] = useState<"idle" | "adjust">("idle");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | "approve" | "adjust">(null);
  const [idx, setIdx] = useState(0);
  const carRef = useRef<HTMLDivElement>(null);

  const pending = status === "AGUARDANDO_CLIENTE" && !done;
  const fileUrl = (id: string) => `/api/aprovar/${p.token}/arquivo/${id}`;

  useEffect(() => {
    // Nome lembrado no aparelho: só existe no navegador, então entra depois da
    // hidratação (ler no useState quebraria o HTML do servidor).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setName(localStorage.getItem(NAME_KEY) ?? ""); } catch { /* sem storage */ }
    // "Visto" só pelo navegador — o robô de prévia do WhatsApp não roda JS.
    if (p.status === "AGUARDANDO_CLIENTE") {
      fetch(`/api/aprovar/${p.token}/visto`, { method: "POST" }).catch(() => {});
    }
  }, [p.status, p.token]);

  function onScroll() {
    const el = carRef.current;
    if (!el) return;
    setIdx(Math.round(el.scrollLeft / el.clientWidth));
  }
  function goTo(i: number) {
    const el = carRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  async function submit(action: "approve" | "adjust") {
    setErr(null);
    if (name.trim().length < 2) { setErr("Escreva seu nome pra registrar quem respondeu."); return; }
    if (action === "adjust" && !text.trim() && !Object.values(notes).some((n) => n.trim())) {
      setErr("Conte o que precisa ajustar.");
      return;
    }
    setBusy(true);
    try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* sem storage */ }
    const res = await fetch(`/api/aprovar/${p.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, name: name.trim(), text: text.trim(), notes: action === "adjust" ? notes : {} }),
    }).catch(() => null);
    setBusy(false);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) { setErr(data?.error ?? "Não deu certo. Tente de novo."); return; }
    setStatus(data.status);
    setDone(action);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const statusChip =
    status === "APROVADO" ? <span className="chip ok">✓ Aprovada</span>
    : status === "AGUARDANDO_CLIENTE" ? <span className="chip warn">● Esperando sua aprovação</span>
    : <span className="chip">Em ajuste pela equipe</span>;

  return (
    <div className="ap">
      <style>{STYLE}</style>
      <div className="apw">
        <div className="eyebrow">
          {p.clientName && <span>{p.clientName}</span>}
          {statusChip}
          {p.round > 1 && <span className="chip">Versão {p.round}</span>}
        </div>
        <h1>{p.title}</h1>
        <div className="sub">
          {p.sentAt && <>Enviada em {fmt(p.sentAt)}</>}
          {p.dueDate && <> · publicação prevista {fmtDate(p.dueDate)}</>}
        </div>

        {done === "approve" && (
          <div className="banner ok">✅ Aprovada! Obrigado, {name.split(" ")[0]}. A equipe já foi avisada.</div>
        )}
        {done === "adjust" && (
          <div className="banner info">✏️ Pedido de ajuste enviado. A nova versão chega pelo grupo do WhatsApp.</div>
        )}
        {!done && status === "APROVADO" && (
          <div className="banner ok">
            ✓ Aprovada{p.approvedByName ? ` por ${p.approvedByName}` : ""}{p.approvedAt ? ` em ${fmt(p.approvedAt)}` : ""}.
          </div>
        )}
        {!done && status !== "APROVADO" && status !== "AGUARDANDO_CLIENTE" && (
          <div className="banner info">A equipe está trabalhando nos ajustes. A nova versão chega pelo grupo do WhatsApp.</div>
        )}

        {p.files.length > 0 ? (
          <>
            <div className="car" ref={carRef} onScroll={onScroll}>
              {p.files.map((f, i) => (
                <div className="slide" key={f.id}>
                  {p.files.length > 1 && <span className="tag">{i + 1}</span>}
                  {f.mimeType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(f.id)} alt={`${p.title}: arquivo ${i + 1}`} loading={i < 2 ? "eager" : "lazy"} />
                  ) : f.mimeType.startsWith("video/") ? (
                    <video src={fileUrl(f.id)} controls playsInline preload="metadata" />
                  ) : (
                    <div className="doc">
                      <span style={{ fontSize: 28 }}>📄</span>
                      <span style={{ fontSize: 14, wordBreak: "break-all" }}>{f.fileName}</span>
                      <a className="open" href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer">Abrir arquivo ↗</a>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {p.files.length > 1 && (
              <>
                <div className="dots">
                  {p.files.map((f, i) => (
                    <button key={f.id} className={`dot ${i === idx ? "on" : ""}`} onClick={() => goTo(i)} aria-label={`Ir para o arquivo ${i + 1}`} />
                  ))}
                </div>
                <div className="count">{idx + 1} de {p.files.length} · arraste pro lado</div>
              </>
            )}
          </>
        ) : (
          <div className="card"><div className="pre">A peça ainda não foi anexada. Fale com a agência pelo grupo.</div></div>
        )}

        {p.links.length > 0 && (
          <div className="card">
            <h3>Arquivos e links</h3>
            {p.links.map((l) => {
              const drive = /drive\.google\.com|docs\.google\.com/i.test(l.url);
              return (
                <a key={l.url} className="lk" href={l.url} target="_blank" rel="noopener noreferrer">
                  <span>{drive ? "📁" : "🔗"}</span>
                  <span className="t">{l.title || (drive ? "Pasta no Google Drive" : l.url.replace(/^https?:\/\//, ""))}</span>
                  <span className="go">Abrir ↗</span>
                </a>
              );
            })}
          </div>
        )}

        {p.versionText.trim() && (
          <div className="card">
            <h3>Recado da equipe / legenda</h3>
            <div className="pre">{p.versionText}</div>
          </div>
        )}
        {p.description?.trim() && (
          <div className="card">
            <h3>Sobre a peça</h3>
            <div className="pre">{p.description.replace(/<[^>]+>/g, "")}</div>
          </div>
        )}

        {p.history.length > 0 && (
          <div className="card">
            <h3>Conversa sobre esta peça</h3>
            <div className="hist">
              {p.history.map((h, i) => (
                <div key={i} className={`msg ${h.byClient ? "me" : "them"}`}>
                  {h.text}
                  <small>{h.byClient ? "Você" : "Equipe"} · {fmt(h.at)}</small>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="links">
          {p.panelToken && <Link href={`/c/${p.panelToken}`}>Ver todas as entregas de {p.projectName} →</Link>}
          <Link href="/meu-espaco">Entrar no meu painel →</Link>
        </div>
      </div>

      {pending && (
        <div className="bar">
          <div className="barw">
            {mode === "adjust" && (
              <>
                <textarea
                  className="f"
                  placeholder="O que precisa mudar? (texto, cor, foto, data…)"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                />
                {p.files.length > 1 && (
                  <input
                    className="f"
                    placeholder={`Ajuste só no arquivo ${idx + 1}? Escreva aqui (opcional)`}
                    value={notes[p.files[idx]?.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [p.files[idx].id]: e.target.value }))}
                  />
                )}
              </>
            )}
            <input
              className="f"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            {err && <div className="err">{err}</div>}
            {mode === "idle" ? (
              <div className="row">
                <button className="btn ghost" onClick={() => { setMode("adjust"); setErr(null); }} disabled={busy}>✎ Pedir ajuste</button>
                <button className="btn ok" onClick={() => submit("approve")} disabled={busy}>{busy ? "Enviando…" : "✓ Aprovar"}</button>
              </div>
            ) : (
              <div className="row">
                <button className="btn ghost" onClick={() => { setMode("idle"); setErr(null); }} disabled={busy}>Voltar</button>
                <button className="btn ok" style={{ background: "var(--warn)", color: "#1A1205" }} onClick={() => submit("adjust")} disabled={busy}>
                  {busy ? "Enviando…" : "Enviar ajuste"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
