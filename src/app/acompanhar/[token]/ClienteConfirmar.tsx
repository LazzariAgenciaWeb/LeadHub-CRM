"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Fecho do chamado na página pública (lib/ticket-confirm):
//   • Resolvido → "Ficou tudo certo?" com "Sim, resolvido" (fecha) e "Ainda
//     não" (leva pra caixa de mensagem, que reabre o chamado).
//   • Encerrado → nota de 1 a 5 pro atendimento (interna) e, SEMPRE, o botão
//     de avaliar a agência no Google. O botão não depende da nota: o Google
//     proíbe pedir avaliação só de quem está satisfeito.

const NOME_KEY = "acompanhar:nome"; // o mesmo da caixa de resposta

const CSS = `
.cfm h3{font-size:17px;text-transform:none;letter-spacing:-.01em;color:var(--ink);margin:0 0 6px}
.cfm .lb{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink3);margin:0 0 6px}
.cfm .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.cfm .row .btn{flex:1;min-width:150px}
.cfm.ask{border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:color-mix(in srgb,var(--ok) 7%,transparent)}
.cfm.ask h3{color:var(--ok)}
.cfm .stars{display:flex;gap:4px;margin:2px 0 12px}
.cfm .stars button{background:none;border:0;padding:2px;cursor:pointer;font-size:32px;line-height:1;color:#3A3F4E;transition:transform .1s}
.cfm .stars button.on{color:#FBBF24}
.cfm .stars button:hover{transform:scale(1.12)}
.cfm .okmsg{margin:10px 0 0;font-size:13.5px;color:var(--ok)}
.cfm .gbtn{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px;padding:13px 14px;border-radius:14px;
  background:#fff;color:#1F2937;font-weight:700;font-size:15px;text-decoration:none}
.cfm .gbtn svg{width:18px;height:18px;flex:none}
.cfm .sep{height:1px;background:var(--line);margin:16px 0 0}
.cfm .mine{font-size:14px;margin:0}
.cfm .mine b{color:#FBBF24;letter-spacing:1px}
.cfm .link{background:none;border:0;color:var(--accent);cursor:pointer;font-size:13px;font-weight:600;padding:0;margin-left:8px;font-family:inherit}
`;

const LABEL = ["", "Ruim", "Fraco", "Ok", "Bom", "Excelente"];

const erro = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function ClienteConfirmar(p: {
  token: string;
  status: string;
  /** Prazo pra fechar sozinho, já formatado ("quarta-feira, 02/12"). */
  dueText: string | null;
  confirmedBy: string | null;
  autoClosed: boolean;
  rating: number | null;
  ratingComment: string | null;
  reviewUrl: string | null;
  agencyName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setName(localStorage.getItem(NOME_KEY) ?? ""); } catch { /* sem storage */ }
  }, []);

  const rememberName = () => { try { localStorage.setItem(NOME_KEY, name.trim()); } catch { /* sem storage */ } };

  async function post(path: string, body: object) {
    const res = await fetch(`/api/acompanhar/${encodeURIComponent(p.token)}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Não deu certo. Tente de novo.");
  }

  async function confirm() {
    if (name.trim().length < 2) { setErr("Escreva seu nome pra registrar quem confirmou."); return; }
    setBusy(true); setErr("");
    try {
      await post("confirmar", { name: name.trim() });
      rememberName();
      router.refresh();
    } catch (e) { setErr(erro(e, "Não deu certo.")); }
    setBusy(false);
  }

  function notYet() {
    const box = document.getElementById("resp-msg") as HTMLTextAreaElement | null;
    box?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => box?.focus(), 350);
  }

  async function rate() {
    if (name.trim().length < 2) { setErr("Escreva seu nome."); return; }
    if (!stars) { setErr("Toque nas estrelas pra dar a nota."); return; }
    setBusy(true); setErr("");
    try {
      await post("avaliar", { name: name.trim(), rating: stars, comment: comment.trim() });
      rememberName();
      setRated(true); setEditing(false);
      router.refresh();
    } catch (e) { setErr(erro(e, "Não deu certo.")); }
    setBusy(false);
  }

  const nameField = (
    <div style={{ marginTop: 12 }}>
      <label className="lb" htmlFor="cfm-nome">Seu nome</label>
      <input id="cfm-nome" className="f" value={name} maxLength={80} autoComplete="name"
        onChange={(e) => setName(e.target.value)} placeholder="Como a equipe te chama" />
    </div>
  );

  // ── Resolvido: pede a confirmação ──
  if (p.status === "RESOLVED") {
    return (
      <div className="card cfm ask">
        <style>{CSS}</style>
        <h3>✅ Ficou tudo certo?</h3>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          A equipe marcou este chamado como resolvido. Confirme pra gente — ou diga o que ainda falta.
        </p>
        {nameField}
        {err && <p className="err" style={{ margin: "10px 0 0" }}>{err}</p>}
        <div className="row">
          <button type="button" className="btn ok" onClick={confirm} disabled={busy}>
            {busy ? "Enviando…" : "✓ Sim, resolvido"}
          </button>
          <button type="button" className="btn ghost" onClick={notYet} disabled={busy}>Ainda não</button>
        </div>
        {p.dueText && (
          <p className="hint" style={{ margin: "10px 0 0" }}>
            Sem resposta até {p.dueText}, encerramos o chamado automaticamente. Se precisar depois, é só escrever por este link.
          </p>
        )}
      </div>
    );
  }

  if (p.status !== "CLOSED") return null;

  // ── Encerrado: nota do atendimento + Google ──
  const hasRating = (p.rating ?? 0) > 0 && !editing;
  const shown = hover || stars;
  return (
    <div className="card cfm">
      <style>{CSS}</style>
      <h3>Como foi o atendimento?</h3>
      {p.confirmedBy && <p className="hint" style={{ margin: "0 0 10px" }}>✓ Confirmado por {p.confirmedBy}. Obrigado!</p>}
      {p.autoClosed && !p.confirmedBy && <p className="hint" style={{ margin: "0 0 10px" }}>Encerrado automaticamente depois do prazo de confirmação.</p>}

      {hasRating ? (
        <p className="mine">
          Sua nota: <b>{"★".repeat(p.rating!)}{"☆".repeat(5 - p.rating!)}</b>
          <button type="button" className="link" onClick={() => { setEditing(true); setStars(p.rating!); setComment(p.ratingComment ?? ""); }}>Mudar</button>
          {rated && <span className="okmsg" style={{ display: "block" }}>Recebemos sua avaliação. Obrigado!</span>}
        </p>
      ) : (
        <>
          <div className="stars" role="radiogroup" aria-label="Nota de 1 a 5" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} — ${LABEL[n]}`}
                className={n <= shown ? "on" : ""} onMouseEnter={() => setHover(n)} onClick={() => { setStars(n); setErr(""); }}>
                ★
              </button>
            ))}
            {shown > 0 && <span className="hint" style={{ alignSelf: "center", marginLeft: 6 }}>{LABEL[shown]}</span>}
          </div>
          <label className="lb" htmlFor="cfm-coment">Quer contar mais? (opcional)</label>
          <textarea id="cfm-coment" className="f" rows={3} maxLength={1000} value={comment}
            onChange={(e) => setComment(e.target.value)} placeholder="O que foi bom, o que podemos melhorar…" />
          {nameField}
          {err && <p className="err" style={{ margin: "10px 0 0" }}>{err}</p>}
          <div className="row">
            <button type="button" className="btn ok" onClick={rate} disabled={busy}>{busy ? "Enviando…" : "Enviar avaliação"}</button>
            {editing && <button type="button" className="btn ghost" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>}
          </div>
        </>
      )}

      {p.reviewUrl && (
        <>
          <div className="sep" />
          <p className="hint" style={{ margin: "14px 0 0" }}>
            Sua opinião no Google ajuda outras empresas a conhecerem a {p.agencyName}. Leva 1 minuto.
          </p>
          <a className="gbtn" href={p.reviewUrl} target="_blank" rel="noopener noreferrer">
            <GoogleG /> Avaliar a {p.agencyName} no Google
          </a>
        </>
      )}
    </div>
  );
}
