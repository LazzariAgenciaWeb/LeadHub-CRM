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
  brand: { name: string; logoUrl: string | null; color: string | null };
  history: { text: string; at: string; byClient: boolean }[];
  /** URL dos prints do descritivo, com `__ID__` no lugar do id do material. */
  mediaBase: string;
};

const NAME_KEY = "lh-aprovador-nome";

const STYLE = `
.ap{--accent:var(--brand,#6E86FF);--ok:#4FD1A0;--warn:#F5B564;--ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;
  --line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--card:rgba(255,255,255,.04);
  min-height:100vh;color:var(--ink);background:radial-gradient(110% 70% at 85% -10%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 60%),#06070C;
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
.slide{flex:0 0 100%;scroll-snap-align:center;border-radius:18px;overflow:hidden;background:#000;border:1px solid var(--line);position:relative;
  height:min(60vh,620px);display:flex;align-items:center;justify-content:center}
.slide img,.slide video{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
.slide .doc{background:#0B0D15;width:100%;height:100%;justify-content:center;padding:28px 18px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.slide .tags{position:absolute;top:10px;left:10px;display:flex;gap:6px;z-index:2}
.slide .tag{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(6,7,12,.75);border:1px solid var(--line2)}
.slide .tag.story{color:#F7C5FF;border-color:rgba(214,120,255,.45)}
.slide .tag.feed{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
.slide .wm{position:absolute;left:0;right:0;bottom:0;padding:22px 12px 10px;z-index:2;pointer-events:none;
  background:linear-gradient(180deg,transparent,rgba(0,0,0,.72));color:rgba(255,255,255,.88);font-size:12px;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.6)}
.carw{position:relative}
.dl{position:absolute;top:10px;right:10px;z-index:2;display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;
  background:rgba(6,7,12,.75);border:1px solid var(--line2);color:var(--ink);text-decoration:none}
.dlall{display:flex;justify-content:center;margin-top:8px}
.dlall button{background:none;border:0;color:var(--accent);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;padding:4px 8px}
.arr{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:40px;height:40px;border-radius:999px;border:1px solid var(--line2);
  background:rgba(6,7,12,.72);color:var(--ink);font-size:20px;line-height:1;display:grid;place-items:center;cursor:pointer;backdrop-filter:blur(6px)}
.arr:disabled{opacity:.25;cursor:default}
.arr.l{left:6px}.arr.r{right:6px}
.dots{display:flex;justify-content:center;gap:6px;margin-top:10px}
.dot{width:7px;height:7px;border-radius:999px;background:var(--line2);border:0;padding:0}
.dot.on{background:var(--accent);width:18px}
.count{text-align:center;color:var(--ink3);font-size:12px;margin-top:6px}
.card{margin-top:16px;padding:14px 16px;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.card h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3)}
.pre{white-space:pre-wrap;word-break:break-word;font-size:14px;color:var(--ink2)}
.pre img{display:block;max-width:100%;margin:10px 0;border-radius:10px;border:1px solid var(--line)}
.card.texto{padding:20px 20px 22px;border-color:var(--line2)}
.card.texto .pre{font-size:15.5px;line-height:1.65;color:var(--ink)}
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
.btn.ok{background:var(--accent);color:var(--on-accent,#04150F)}
.brandbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--line)}
.brandbar img{height:30px;width:auto;max-width:150px;object-fit:contain;display:block}
.brandbar b{font-size:15px;letter-spacing:-.01em}
.brandbar span{font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em}
.made{margin-top:28px;text-align:center;font-size:11px;color:var(--ink3)}
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

// Cor da agência vira o acento da tela; o texto em cima dela (botão aprovar)
// fica escuro ou claro conforme a luminância — amarelo pede texto preto.
function brandVars(color: string | null): React.CSSProperties | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { ["--brand" as string]: color, ["--on-accent" as string]: lum > 0.55 ? "#0A0A0A" : "#FFFFFF" } as React.CSSProperties;
}

// Descritivo como o cliente vê: texto puro + prints colados ([[img:id]]).
// Nada de HTML vindo do banco — a página é pública.
function TextoPeca({ text, mediaBase }: { text: string; mediaBase: string }) {
  const clean = text.replace(/<[^>]+>/g, "");
  const parts = clean.split(/\[\[img:([a-zA-Z0-9_-]+)\]\]/);
  return (
    <div className="pre">
      {parts.map((part, i) =>
        i % 2 === 1
          // eslint-disable-next-line @next/next/no-img-element
          ? <img key={i} src={mediaBase.replace("__ID__", part)} alt="" loading="lazy" />
          : part ? <span key={i}>{part}</span> : null,
      )}
    </div>
  );
}

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
  // Formato detectado pela proporção da imagem: vertical 9:16 = Stories, o resto = Feed.
  const [fmtOf, setFmtOf] = useState<Record<string, "story" | "feed">>({});
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
      fetch(`/api/aprovar/${p.token}/visto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open: true, seen: p.files.length ? 1 : 0, total: p.files.length }),
      }).catch(() => {});
    }
  }, [p.status, p.token, p.files.length]);

  // Imagem que já carregou antes da hidratação não dispara onLoad: mede aqui.
  useEffect(() => {
    const imgs = carRef.current?.querySelectorAll("img") ?? [];
    const found: Record<string, "story" | "feed"> = {};
    imgs.forEach((im, i) => {
      const f = p.files.filter((x) => x.mimeType.startsWith("image/"))[i];
      if (f && im.complete && im.naturalWidth) found[f.id] = im.naturalHeight / im.naturalWidth >= 1.6 ? "story" : "feed";
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Object.keys(found).length) setFmtOf((m) => ({ ...found, ...m }));
  }, [p.files]);

  // Baixa um por um (sem zip): o navegador pode pedir permissão pra vários downloads.
  const [downloading, setDownloading] = useState(false);
  async function downloadAll() {
    setDownloading(true);
    for (const f of p.files) {
      const a = document.createElement("a");
      a.href = `${fileUrl(f.id)}?download=1`;
      a.download = f.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 700));
    }
    setDownloading(false);
  }

  // Até onde o cliente passou no carrossel (a equipe vê "viu 5 de 7"). Manda
  // só quando passa do máximo já visto — no máximo um aviso por slide.
  const maxSeen = useRef(1);
  useEffect(() => {
    if (p.status !== "AGUARDANDO_CLIENTE" || idx + 1 <= maxSeen.current) return;
    maxSeen.current = idx + 1;
    fetch(`/api/aprovar/${p.token}/visto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seen: maxSeen.current, total: p.files.length }),
      keepalive: true,
    }).catch(() => {});
  }, [idx, p.status, p.token, p.files.length]);

  // Índice pelo slide mais perto do centro (com gap/padding, scrollLeft/largura erra).
  function onScroll() {
    const el = carRef.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0, bestD = Infinity;
    Array.from(el.children).forEach((c, i) => {
      const s = c as HTMLElement;
      const d = Math.abs(s.offsetLeft - el.offsetLeft + s.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    setIdx(best);
  }
  function goTo(i: number) {
    const el = carRef.current;
    const slide = el?.children[i] as HTMLElement | undefined;
    if (!el || !slide) return;
    setIdx(i);
    el.scrollTo({ left: slide.offsetLeft - el.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2, behavior: "smooth" });
  }
  // Setas do teclado no computador.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") goTo(Math.min(idx + 1, p.files.length - 1));
      if (e.key === "ArrowLeft") goTo(Math.max(idx - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });



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
    <div className="ap" style={brandVars(p.brand.color)}>
      <style>{STYLE}</style>
      <div className="apw">
        <div className="brandbar">
          {p.brand.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.brand.logoUrl} alt={p.brand.name} />
            : <b>{p.brand.name}</b>}
          <span>Aprovação de peças</span>
        </div>
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
            <div className="carw">
            <div className="car" ref={carRef} onScroll={onScroll}>
              {p.files.map((f, i) => (
                <div className="slide" key={f.id}>
                  <div className="tags">
                    {p.files.length > 1 && <span className="tag">{i + 1}/{p.files.length}</span>}
                    {fmtOf[f.id] && <span className={`tag ${fmtOf[f.id]}`}>{fmtOf[f.id] === "story" ? "Stories" : "Feed"}</span>}
                  </div>
                  <a className="dl" href={`${fileUrl(f.id)}?download=1`} download={f.fileName} aria-label={`Baixar ${f.fileName}`}>⬇ Baixar</a>
                  <div className="wm">{f.fileName.replace(/\.[a-z0-9]{2,5}$/i, "")}</div>
                  {f.mimeType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(f.id)}
                      alt={`${p.title}: ${f.fileName}`}
                      loading={i < 2 ? "eager" : "lazy"}
                      onLoad={(e) => {
                        const im = e.currentTarget;
                        if (!im.naturalWidth) return;
                        const kind = im.naturalHeight / im.naturalWidth >= 1.6 ? "story" : "feed";
                        setFmtOf((m) => (m[f.id] === kind ? m : { ...m, [f.id]: kind }));
                      }}
                    />
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
                <button type="button" className="arr l" onClick={() => goTo(idx - 1)} disabled={idx === 0} aria-label="Anterior">‹</button>
                <button type="button" className="arr r" onClick={() => goTo(idx + 1)} disabled={idx >= p.files.length - 1} aria-label="Próximo">›</button>
              </>
            )}
            </div>
            {p.files.length > 1 && (
              <>
                <div className="dots">
                  {p.files.map((f, i) => (
                    <button key={f.id} className={`dot ${i === idx ? "on" : ""}`} onClick={() => goTo(i)} aria-label={`Ir para o arquivo ${i + 1}`} />
                  ))}
                </div>
                <div className="dlall">
                  <button type="button" onClick={downloadAll} disabled={downloading}>
                    {downloading ? "Baixando…" : `⬇ Baixar todos (${p.files.length})`}
                  </button>
                </div>
                <div className="count">{idx + 1} de {p.files.length} · {p.files[idx]?.fileName.replace(/\.[a-z0-9]{2,5}$/i, "")}</div>
              </>
            )}
          </>
        ) : p.description?.trim() ? (
          <div className="card texto">
            <h3>Conteúdo para aprovação</h3>
            <TextoPeca text={p.description} mediaBase={p.mediaBase} />
          </div>
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
        {p.files.length > 0 && p.description?.trim() && (
          <div className="card">
            <h3>Sobre a peça</h3>
            <TextoPeca text={p.description} mediaBase={p.mediaBase} />
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
        <div className="made">{p.brand.name}</div>
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
                    placeholder={`Ajuste no arquivo ${idx + 1}? Escreva aqui — arquivo sem recado conta como aprovado`}
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
