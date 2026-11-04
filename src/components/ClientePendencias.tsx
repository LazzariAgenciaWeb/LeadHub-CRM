"use client";

import { useState } from "react";

/**
 * Bloco que vai no fim dos dois links públicos do cliente: o chamado
 * (/acompanhar) e a peça (/aprovar).
 *
 * Faz duas coisas: avisa que tem MAIS coisa esperando ele (peça pra aprovar,
 * chamado em aberto) com link direto, e abre a porta do portal — entrar, se a
 * empresa dele já tem login, ou pedir acesso, que cai como chamado na agência
 * e aviso no WhatsApp da equipe.
 *
 * Vive nas duas telas, então não depende do CSS de nenhuma: traz o seu, e usa
 * a cor da marca (--accent, definida na tela de aprovação) só se existir.
 */

export type ItemPendente = { title: string; url: string; sub: string | null };

type Props = {
  aprovacoes: ItemPendente[];
  chamados: ItemPendente[];
  temAcesso: boolean;
  agencia: { name: string; phone: string | null };
  /** De qual link ele veio — é o que autoriza o pedido de acesso. */
  origem: { kind: "chamado" | "aprovacao"; token: string };
};

const CSS = `
.cpd{--cpd-ink:#E2E8F0;--cpd-ink2:#AFB6C6;--cpd-ink3:#727A8C;--cpd-warn:#F5B564;
  --cpd-line:rgba(255,255,255,.1);--cpd-card:rgba(255,255,255,.04);
  margin-top:26px;font-family:inherit;color:var(--cpd-ink)}
.cpd *{box-sizing:border-box}
.cpd-box{padding:14px 16px;border-radius:16px;border:1px solid var(--cpd-line);background:var(--cpd-card)}
.cpd-box+.cpd-box{margin-top:10px}
.cpd-box.warn{border-color:rgba(245,181,100,.32);background:rgba(245,181,100,.07)}
.cpd-h{margin:0 0 2px;font-size:14px;font-weight:700}
.cpd-h.warn{color:var(--cpd-warn)}
.cpd-sub{margin:0;font-size:12.5px;color:var(--cpd-ink3);line-height:1.5}
.cpd-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}
.cpd-item{display:flex;gap:9px;align-items:center;padding:9px 11px;border-radius:11px;border:1px solid var(--cpd-line);
  background:rgba(0,0,0,.25);text-decoration:none;color:inherit}
.cpd-item span.ico{flex:none;font-size:15px;line-height:1}
.cpd-item .tx{min-width:0;flex:1}
.cpd-item .tx b{display:block;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpd-item .tx small{display:block;font-size:11.5px;color:var(--cpd-ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpd-item .go{flex:none;font-size:13px;color:var(--accent,#7C9BFF);font-weight:600}
.cpd-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:11px}
.cpd-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;border:0;cursor:pointer;
  font-family:inherit;font-size:13px;font-weight:700;text-decoration:none;background:var(--accent,#6E86FF);color:#fff}
.cpd-btn.ghost{background:none;border:1px solid var(--cpd-line);color:var(--cpd-ink2);font-weight:600}
.cpd-btn:disabled{opacity:.5;cursor:default}
.cpd-form{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.cpd-form input{width:100%;padding:10px 12px;border-radius:11px;border:1px solid var(--cpd-line);background:rgba(0,0,0,.3);
  color:var(--cpd-ink);font-family:inherit;font-size:14px}
.cpd-form input::placeholder{color:var(--cpd-ink3)}
.cpd-erro{margin:0;font-size:12.5px;color:#FCA5A5}
.cpd-ok{margin:0;font-size:13px;color:#86EFAC;line-height:1.5}
.cpd-wa{font-size:12.5px;color:var(--accent,#7C9BFF);text-decoration:none;font-weight:600}
`;

const LOGIN = `/login?callbackUrl=${encodeURIComponent("/meu-espaco")}`;

export default function ClientePendencias(p: Props) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome]     = useState("");
  const [email, setEmail]   = useState("");
  const [fone, setFone]     = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro]     = useState("");
  const [pronto, setPronto] = useState(false);

  const total = p.aprovacoes.length + p.chamados.length;
  const waLink = p.agencia.phone
    ? `https://wa.me/${p.agencia.phone.replace(/\D/g, "")}`
    : null;

  async function pedir(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const r = await fetch("/api/acesso-portal", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...p.origem, name: nome, email, phone: fone }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(data?.error ?? "Não deu pra enviar agora. Tente de novo."); return; }
      setPronto(true);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cpd">
      <style>{CSS}</style>

      {total > 0 && (
        <div className="cpd-box warn">
          <p className="cpd-h warn">⏳ Também esperando você</p>
          <p className="cpd-sub">
            {p.aprovacoes.length > 0 && p.chamados.length > 0
              ? `${p.aprovacoes.length} ${p.aprovacoes.length === 1 ? "peça pra aprovar" : "peças pra aprovar"} e ${p.chamados.length} ${p.chamados.length === 1 ? "chamado em aberto" : "chamados em aberto"}.`
              : p.aprovacoes.length > 0
                ? `${p.aprovacoes.length} ${p.aprovacoes.length === 1 ? "peça esperando sua aprovação" : "peças esperando sua aprovação"}.`
                : `${p.chamados.length} ${p.chamados.length === 1 ? "chamado seu em aberto" : "chamados seus em aberto"}.`}
          </p>
          <ul className="cpd-list">
            {p.aprovacoes.map((it) => (
              <li key={it.url}>
                <a className="cpd-item" href={it.url}>
                  <span className="ico">🎨</span>
                  <span className="tx"><b>{it.title}</b>{it.sub && <small>{it.sub}</small>}</span>
                  <span className="go">Aprovar →</span>
                </a>
              </li>
            ))}
            {p.chamados.map((it) => (
              <li key={it.url}>
                <a className="cpd-item" href={it.url}>
                  <span className="ico">💬</span>
                  <span className="tx"><b>{it.title}</b>{it.sub && <small>{it.sub}</small>}</span>
                  <span className="go">Ver →</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="cpd-box">
        {pronto ? (
          <>
            <p className="cpd-h">✅ Pedido enviado</p>
            <p className="cpd-ok">
              A equipe da {p.agencia.name} vai criar seu acesso e avisar por aqui ou no WhatsApp.
              Enquanto isso, você continua acompanhando por este link.
            </p>
          </>
        ) : p.temAcesso ? (
          <>
            <p className="cpd-h">Veja tudo num lugar só</p>
            <p className="cpd-sub">
              No portal da {p.agencia.name} ficam suas peças pra aprovar, seus chamados, arquivos e relatórios.
            </p>
            <div className="cpd-row">
              <a className="cpd-btn" href={LOGIN}>Entrar no portal</a>
              {!aberto && (
                <button type="button" className="cpd-btn ghost" onClick={() => setAberto(true)}>
                  Não tenho acesso
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="cpd-h">Quer acompanhar tudo num lugar só?</p>
            <p className="cpd-sub">
              Sua empresa ainda não tem login no portal da {p.agencia.name} — onde ficam as peças pra aprovar,
              os chamados, arquivos e relatórios. Peça no nosso grupo do WhatsApp informando o e-mail que você
              vai usar pro cadastro — ou peça por aqui.
              {waLink && <> <a className="cpd-wa" href={waLink} target="_blank" rel="noopener noreferrer">Abrir o WhatsApp →</a></>}
            </p>
            {!aberto && (
              <div className="cpd-row">
                <button type="button" className="cpd-btn" onClick={() => setAberto(true)}>Pedir acesso</button>
              </div>
            )}
          </>
        )}

        {aberto && !pronto && (
          <form className="cpd-form" onSubmit={pedir}>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" maxLength={80} required />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail que você vai usar pro login"
              type="email" maxLength={160} required />
            <input value={fone} onChange={(e) => setFone(e.target.value)} placeholder="WhatsApp (opcional)" maxLength={40} />
            {erro && <p className="cpd-erro">{erro}</p>}
            <div className="cpd-row" style={{ marginTop: 0 }}>
              <button type="submit" className="cpd-btn" disabled={enviando}>
                {enviando ? "Enviando…" : "Pedir acesso"}
              </button>
              <button type="button" className="cpd-btn ghost" onClick={() => setAberto(false)} disabled={enviando}>
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
