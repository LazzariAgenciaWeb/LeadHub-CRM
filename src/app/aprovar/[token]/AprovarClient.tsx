"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import ClientePendencias, { PortalAcesso, type ItemPendente } from "@/components/ClientePendencias";
import type { AdjustmentView } from "@/lib/approval-adjustments";

/**
 * Tela do CLIENTE pra aprovar uma peça pelo link do WhatsApp (sem login).
 * Pensada pro celular: carrossel com swipe, botões fixos no rodapé, nome
 * lembrado no aparelho pra não digitar toda vez.
 *
 * Ajuste é uma LISTA: cada pessoa anota quantos quiser (em um arquivo ou na
 * peça toda), todo mundo vê o que já foi pedido, e só "Enviar ajustes pra
 * equipe" fecha a rodada. Depois do envio, "Esqueci uma coisa" ainda entra.
 */

export type ApprovalFile = {
  id: string; fileName: string; mimeType: string; status: string | null; note: string | null;
  /** Conteúdo de .md/.txt (matéria de blog), lido no servidor pra ler no link. */
  text?: string;
  textKind?: "md" | "txt";
  /** Vídeo enviado: endereço final e fixo do arquivo (sem redirect a cada trecho). */
  src?: string;
  /** Vídeo/arquivo por link (Drive, YouTube): URL do player e o link original. */
  embed?: string;
  href?: string;
};

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
  /** Versões anteriores que voltaram pra ajuste, com o pedido (rodada 2+). */
  previous: ApprovalFile[];
  links: { url: string; title: string }[];
  brand: { name: string; logoUrl: string | null; color: string | null };
  history: {
    text: string; who: string | null; kind: "sent" | "approve" | "adjust" | "note" | "team"; at: string; round: number | null;
    files: { id: string; fileName: string; mimeType: string }[];
  }[];
  highlights: { text: string; at: string }[];
  /** Outras peças/chamados esperando o cliente + porta do portal. */
  pendencias: {
    aprovacoes: ItemPendente[];
    chamados:   ItemPendente[];
    temAcesso:  boolean;
    agencia:    { name: string; phone: string | null };
  };
  /** URL dos prints do descritivo, com `__ID__` no lugar do id do material. */
  mediaBase: string;
  /** Ajustes desta rodada (anotados e já enviados). */
  adjustments: AdjustmentView[];
  /** Ajustes enviados na versão anterior — o cliente confere o que foi feito. */
  previousAdjustments: AdjustmentView[];
};

const NAME_KEY = "lh-aprovador-nome";
// Aparelho que anotou (sem login): só ele corrige ou tira o próprio ajuste.
const DEVICE_KEY = "lh-aprovador-aparelho";
const MINE_KEY = "lh-ajustes-meus";

const STYLE = `
.ap{--accent:var(--brand,#6E86FF);--ok:#4FD1A0;--warn:#F5B564;--ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;
  --line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--card:rgba(255,255,255,.04);
  min-height:100vh;color:var(--ink);background:radial-gradient(110% 70% at 85% -10%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 60%),#06070C;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5}
.ap *{box-sizing:border-box}
.apw{max-width:1240px;margin:0 auto;padding:22px 16px 180px}
.lay{display:grid;grid-template-columns:minmax(0,1fr);gap:4px}
.cmed,.cinfo{min-width:0}
@media (min-width:980px){
  .apw{padding:28px 32px 150px}
  .lay{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:32px;align-items:start}
  .cmed{position:sticky;top:16px}
  .slide{height:min(76vh,780px)}
  .cmed .car{margin-left:0;margin-right:0;padding:0}
  .cinfo .card:first-child{margin-top:18px}
}
@media (min-width:640px) and (max-width:979px){.apw{max-width:760px;padding:24px 24px 170px}}
.eyebrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--ink3)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid var(--line2);font-size:11px;font-weight:600;color:var(--ink2)}
.chip.warn{color:var(--warn);border-color:rgba(245,181,100,.35);background:rgba(245,181,100,.08)}
.chip.ok{color:var(--ok);border-color:rgba(79,209,160,.35);background:rgba(79,209,160,.08)}
h1{font-size:clamp(22px,2.4vw,30px);line-height:1.25;margin:10px 0 4px;letter-spacing:-.01em}
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
.card.prev{border-color:rgba(251,146,60,.3);background:rgba(251,146,60,.05)}
.prevrow{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line)}
.prevrow:first-of-type{border-top:0;padding-top:4px}
.prevrow .th{position:relative;flex:none;width:64px;height:64px;border-radius:10px;overflow:hidden;border:1px solid var(--line2);background:#0B0D15;display:grid;place-items:center;font-size:22px}
.prevrow .th img{width:100%;height:100%;object-fit:cover;opacity:.55;filter:grayscale(.6)}
.prevrow .th b{position:absolute;left:0;right:0;bottom:0;text-align:center;font-size:9px;font-weight:800;letter-spacing:.04em;color:#fff;background:#EA580C;padding:2px 0}
.prevrow .th b.rep{background:#DC2626}
.prevrow .pd{min-width:0;flex:1}
.prevrow .pd small{display:block;font-size:11px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prevrow .pd div{font-size:14px;color:var(--ink);white-space:pre-wrap;word-break:break-word;margin-top:2px}
.card.texto .pre{font-size:15.5px;line-height:1.65;color:var(--ink)}
.hist{display:flex;flex-direction:column;gap:8px}
.msg{padding:9px 12px;border-radius:12px;font-size:13px;white-space:pre-wrap;word-break:break-word;max-width:92%}
.msg.me{align-self:flex-end;background:rgba(110,134,255,.14);border:1px solid rgba(110,134,255,.3)}
.msg.adjust{align-self:stretch;max-width:100%;background:rgba(245,181,100,.10);border:1px solid rgba(245,181,100,.45)}
.msg.approve{align-self:stretch;max-width:100%;background:rgba(79,209,160,.10);border:1px solid rgba(79,209,160,.45)}
.msg.note{align-self:stretch;max-width:100%;background:rgba(110,134,255,.10);border:1px solid rgba(110,134,255,.3)}
.msg.team{align-self:stretch;max-width:100%;background:var(--card);border:1px solid var(--line)}
.msg.team .mh{color:var(--ink2)}
.msg.sent{align-self:stretch;max-width:100%;background:color-mix(in srgb,var(--accent) 8%,transparent);border:1px dashed color-mix(in srgb,var(--accent) 45%,transparent)}
.msg.sent .mh{color:var(--accent)}
.thumbs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.thumbs a{display:block;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--line2);background:#000;position:relative}
.thumbs img{width:100%;height:100%;object-fit:cover;display:block}
.thumbs span{position:absolute;inset:0;display:grid;place-items:center;font-size:10px;color:var(--ink2);text-transform:uppercase}
.hlbox{border-color:color-mix(in srgb,var(--accent) 50%,transparent);background:color-mix(in srgb,var(--accent) 7%,transparent)}
.hlbox h3{color:var(--accent)}
.hlbox .hlitem+.hlitem{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.msg .mh{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;font-size:12px;font-weight:700}
.msg.adjust .mh{color:var(--warn)}
.msg.approve .mh{color:var(--ok)}
.msg .ver{font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;border:1px solid var(--line2);color:var(--ink2)}
.msg.them{align-self:flex-start;background:var(--card);border:1px solid var(--line)}
.msg small{display:block;color:var(--ink3);font-size:11px;margin-top:2px}
.bar{position:fixed;left:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(6,7,12,0),rgba(6,7,12,.92) 22%,#06070C);padding:22px 16px calc(14px + env(safe-area-inset-bottom))}
.barw{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:8px}
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
.brandbar>span,.brandbar .bbr>span{font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em}
.brandbar .bbr{display:flex;align-items:center;gap:12px;min-width:0}
@media (max-width:560px){.brandbar .bbr>span{display:none}}
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
.slide.read{background:#F6F5F1;align-items:stretch;justify-content:stretch}
.paper{width:100%;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:44px 22px 70px;color:#1C1C1E;
  font-size:16px;line-height:1.7;text-align:left}
.paper.txt{white-space:pre-wrap;word-break:break-word}
.paper h1,.paper h2,.paper h3,.paper h4{line-height:1.3;margin:1.2em 0 .45em;color:#0E0E10;letter-spacing:-.01em}
.paper h1{font-size:26px;margin-top:.2em}.paper h2{font-size:21px}.paper h3{font-size:18px}.paper h4{font-size:16px}
.paper p{margin:0 0 1em}.paper ul,.paper ol{margin:0 0 1em;padding-left:1.4em}.paper li{margin:.25em 0}
.paper a{color:#2952CC;text-decoration:underline}
.paper blockquote{margin:0 0 1em;padding:.4em 1em;border-left:3px solid #C9C6BC;color:#45454A;background:rgba(0,0,0,.03)}
.paper code{font-family:ui-monospace,Menlo,monospace;font-size:.88em;background:rgba(0,0,0,.06);padding:.1em .35em;border-radius:4px}
.paper pre{background:#ECEAE3;padding:12px 14px;border-radius:8px;overflow-x:auto;margin:0 0 1em}.paper pre code{background:none;padding:0}
.paper hr{border:0;border-top:1px solid #D8D5CC;margin:1.6em 0}
.paper img{max-width:100%;height:auto;border-radius:8px;margin:.4em 0}
.paper .in{max-width:720px;margin:0 auto}
.slide .full{position:absolute;right:10px;bottom:10px;z-index:3;font-size:12px;font-weight:700;padding:7px 12px;border-radius:999px;
  background:#1C1C1E;color:#fff;border:0;cursor:pointer}
.reader{position:fixed;inset:0;z-index:60;background:#F6F5F1;display:flex;flex-direction:column}
.reader .rbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #DEDBD2;background:#EFEDE7;color:#1C1C1E}
.reader .rbar b{flex:1;min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.reader .rbar button{font-size:13px;font-weight:700;padding:7px 14px;border-radius:999px;border:0;background:#1C1C1E;color:#fff;cursor:pointer}
.reader .paper{flex:1;height:auto;padding-bottom:40px}
.slide .emb{display:block;width:100%;height:100%;border:0;background:#000}
.slide .tag.adjn{color:var(--warn);border-color:rgba(245,181,100,.5)}
.card.adjc{border-color:rgba(245,181,100,.35)}
.card.adjc h3{color:var(--warn)}
.adjl{display:flex;flex-direction:column;gap:8px}
.adj{padding:10px 12px;border-radius:12px;background:rgba(245,181,100,.07);border:1px solid rgba(245,181,100,.3);font-size:14px;white-space:pre-wrap;word-break:break-word}
.adj.sent{background:var(--card);border-color:var(--line)}
.adj.done{background:rgba(79,209,160,.07);border-color:rgba(79,209,160,.35)}
.adj .ah{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--ink3);margin-bottom:3px;white-space:normal}
.adj .ah b{color:var(--ink2);font-weight:700}
.adj .fl{padding:1px 7px;border-radius:999px;border:1px solid var(--line2);color:var(--ink2);font-weight:700;background:none;font-family:inherit;font-size:11px;cursor:pointer}
.adj .st{margin-left:auto;font-weight:700}
.adj.done .st{color:var(--ok)}
.adj .acts{display:flex;gap:14px;margin-top:6px}
.adj .acts button{background:none;border:0;padding:0;color:var(--ink3);font-size:12px;cursor:pointer;font-family:inherit;text-decoration:underline}
.hint{font-size:12px;color:var(--ink3)}
.tgt{display:flex;gap:6px;flex-wrap:wrap}
.tgt button{border:1px solid var(--line2);background:transparent;color:var(--ink2);border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit}
.tgt button.on{border-color:var(--warn);color:var(--warn);background:rgba(245,181,100,.1)}
.confirm{padding:12px;border-radius:12px;background:rgba(245,181,100,.08);border:1px solid rgba(245,181,100,.4);font-size:14px}
.btn.warn{background:var(--warn);color:#1A1205}
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
const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const ajustes = (n: number) => `${n} ajuste${n === 1 ? "" : "s"}`;

export default function AprovarClient(p: Props) {
  const [status, setStatus] = useState(p.status);
  // idle · note (anotando um ajuste, ou corrigindo `editing`) · confirm (aprovar com ajuste anotado)
  const [mode, setMode] = useState<"idle" | "note" | "confirm">("idle");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"file" | "all">("file");
  const [editing, setEditing] = useState<string | null>(null);
  const [adjs, setAdjs] = useState<AdjustmentView[]>(p.adjustments);
  const [mine, setMine] = useState<string[]>([]);
  const deviceKey = useRef("");
  const [confirmInfo, setConfirmInfo] = useState<{ count: number; authors: string } | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [done, setDone] = useState<null | "approve" | "adjust">(null);
  const [idx, setIdx] = useState(0);
  // Formato detectado pela proporção da imagem: vertical 9:16 = Stories, o resto = Feed.
  const [fmtOf, setFmtOf] = useState<Record<string, "story" | "feed">>({});
  // Matéria de blog aberta em tela cheia (id do arquivo).
  const [readId, setReadId] = useState<string | null>(null);
  const reading = readId ? p.files.find((x) => x.id === readId) ?? null : null;
  const carRef = useRef<HTMLDivElement>(null);

  const pending = status === "AGUARDANDO_CLIENTE" && !done;
  // Ajustes já foram pra equipe e a versão nova ainda não saiu: "Esqueci uma coisa".
  const afterSend = !pending && status !== "APROVADO" && status !== "AGUARDANDO_CLIENTE" && p.round > 0;
  const open = adjs.filter((a) => !a.sentAt);
  const countFor = (fid: string) => adjs.filter((a) => a.fileId === fid).length;
  const fileUrl = (id: string) => `/api/aprovar/${p.token}/arquivo/${id}`;

  useEffect(() => {
    // Nome lembrado no aparelho: só existe no navegador, então entra depois da
    // hidratação (ler no useState quebraria o HTML do servidor).
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(localStorage.getItem(NAME_KEY) ?? "");
      let k = localStorage.getItem(DEVICE_KEY);
      if (!k) { k = newKey(); localStorage.setItem(DEVICE_KEY, k); }
      deviceKey.current = k;
      setMine(JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]"));
    } catch { deviceKey.current ||= newKey(); }
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
    for (const f of p.files.filter((x) => !x.embed)) {
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



  function hasName(): boolean {
    if (name.trim().length >= 2) return true;
    setErr("Escreva seu nome pra registrar quem pediu.");
    return false;
  }
  function rememberName() {
    try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* sem storage */ }
  }

  // Abre a caixa pra anotar um ajuste novo (ou corrigir um já anotado).
  function startNote(id?: string) {
    const a = id ? adjs.find((x) => x.id === id) : null;
    setErr(null); setOkMsg(null);
    setEditing(a?.id ?? null);
    setText(a?.text ?? "");
    setTarget(p.files.length > 1 ? "file" : "all");
    setMode("note");
  }

  async function saveNote() {
    setErr(null);
    if (!hasName()) return;
    if (!text.trim()) { setErr("Escreva o que precisa mudar."); return; }
    setBusy(true);
    rememberName();
    const res = await fetch(editing ? `/api/aprovar/${p.token}/ajustes/${editing}` : `/api/aprovar/${p.token}/ajustes`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(), text: text.trim(), deviceKey: deviceKey.current,
        fileId: target === "file" ? p.files[idx]?.id ?? null : null,
      }),
    }).catch(() => null);
    setBusy(false);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) { setErr(data?.error ?? "Não deu certo. Tente de novo."); return; }
    const a: AdjustmentView = data.adjustment;
    setAdjs((list) => (editing ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]));
    if (!editing) {
      const next = [...mine, a.id].slice(-200);
      setMine(next);
      try { localStorage.setItem(MINE_KEY, JSON.stringify(next)); } catch { /* sem storage */ }
    }
    setText(""); setEditing(null); setMode("idle");
    setOkMsg(a.late ? "Recebido! Foi pra equipe junto com os outros ajustes." : "Anotado. Pode anotar mais ou enviar pra equipe.");
  }

  async function removeNote(id: string) {
    if (!window.confirm("Tirar este ajuste da lista?")) return;
    setErr(null);
    const res = await fetch(`/api/aprovar/${p.token}/ajustes/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceKey: deviceKey.current }),
    }).catch(() => null);
    if (!res?.ok) {
      const d = await res?.json().catch(() => null);
      setErr(d?.error ?? "Não deu certo. Tente de novo.");
      return;
    }
    setAdjs((list) => list.filter((x) => x.id !== id));
  }

  // approve: aprova (com ajuste anotado o servidor pede confirmação → force).
  // send: manda pra equipe todos os ajustes anotados.
  async function act(action: "approve" | "send", force = false) {
    setErr(null); setOkMsg(null);
    if (!hasName()) return;
    setBusy(true);
    rememberName();
    const res = await fetch(`/api/aprovar/${p.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, name: name.trim(), force }),
    }).catch(() => null);
    setBusy(false);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) {
      if (data?.code === "HAS_ADJUSTMENTS") {
        setConfirmInfo({ count: data.count, authors: data.authors });
        setMode("confirm");
        return;
      }
      setErr(data?.error ?? "Não deu certo. Tente de novo.");
      return;
    }
    const now = new Date().toISOString();
    setAdjs((list) => list.map((a) => (a.sentAt ? a : { ...a, sentAt: now })));
    setStatus(data.status);
    setSentCount(data.count ?? 0);
    setDone(action === "approve" ? "approve" : "adjust");
    setMode("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Um ajuste da lista. `jump`: o rótulo do arquivo leva o carrossel até ele.
  function adjItem(a: AdjustmentView, jump: boolean) {
    const canEdit = pending && !a.sentAt && mine.includes(a.id);
    const fi = jump && a.fileId ? p.files.findIndex((f) => f.id === a.fileId) : -1;
    return (
      <div key={a.id} className={`adj ${a.doneAt ? "done" : a.sentAt ? "sent" : ""}`}>
        <div className="ah">
          <b>{a.authorName}</b>
          {a.fileLabel
            ? (fi >= 0 ? <button type="button" className="fl" onClick={() => goTo(fi)}>{a.fileLabel}</button> : <span className="fl">{a.fileLabel}</span>)
            : <span>peça toda</span>}
          <span>{fmt(a.createdAt)}{a.late ? " · chegou depois" : ""}</span>
          <span className="st">{a.doneAt ? "✓ feito" : a.sentAt ? "com a equipe" : "anotado"}</span>
        </div>
        {a.text}
        {canEdit && (
          <div className="acts">
            <button type="button" onClick={() => startNote(a.id)}>corrigir</button>
            <button type="button" onClick={() => void removeNote(a.id)}>tirar</button>
          </div>
        )}
      </div>
    );
  }

  const statusChip =
    status === "APROVADO" ? <span className="chip ok">✓ Aprovada</span>
    : status === "AGUARDANDO_CLIENTE" ? <span className="chip warn">● Esperando sua aprovação</span>
    : <span className="chip">Em ajuste pela equipe</span>;

  return (
    <div className="ap" style={brandVars(p.brand.color)}>
      <style>{STYLE}</style>
      {reading?.text !== undefined && reading && (
        <div className="reader" role="dialog" aria-label={reading.fileName}>
          <div className="rbar">
            <b>{reading.fileName.replace(/\.[a-z0-9]{2,8}$/i, "")}</b>
            <button type="button" onClick={() => setReadId(null)}>Fechar</button>
          </div>
          {reading.textKind === "md"
            ? <div className="paper"><MarkdownDoc text={reading.text} className="in" /></div>
            : <div className="paper txt"><div className="in">{reading.text}</div></div>}
        </div>
      )}
      <div className="apw">
        <div className="brandbar">
          {p.brand.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.brand.logoUrl} alt={p.brand.name} />
            : <b>{p.brand.name}</b>}
          <div className="bbr">
            <span>Aprovação de peças</span>
            {/* Portal no topo: embaixo ele se confundia com aprovar/ajustar. */}
            <PortalAcesso
              aprovacoes={p.pendencias.aprovacoes}
              temAcesso={p.pendencias.temAcesso}
              agencia={p.pendencias.agencia}
              origem={{ kind: "aprovacao", token: p.token }}
            />
          </div>
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
          <div className="banner info">
            ✏️ {sentCount ? `${ajustes(sentCount)} enviado${sentCount === 1 ? "" : "s"}` : "Ajustes enviados"} pra equipe. A nova versão chega pelo grupo do WhatsApp.
            Lembrou de mais alguma coisa? Toque em “Esqueci uma coisa”, aqui embaixo.
          </div>
        )}
        {!done && status === "APROVADO" && (
          <div className="banner ok">
            ✓ Aprovada{p.approvedByName ? ` por ${p.approvedByName}` : ""}{p.approvedAt ? ` em ${fmt(p.approvedAt)}` : ""}.
          </div>
        )}
        {!done && status !== "APROVADO" && status !== "AGUARDANDO_CLIENTE" && (
          <div className="banner info">A equipe está trabalhando nos ajustes. A nova versão chega pelo grupo do WhatsApp. Lembrou de mais alguma coisa? Toque em “Esqueci uma coisa”.</div>
        )}

        {/* Desktop: arte grande à esquerda (fixa ao rolar), texto e conversa à
            direita. Celular: uma coluna, arte primeiro. */}
        <div className="lay">
          <div className="cmed">
        {p.files.length > 0 ? (
          <>
            <div className="carw">
            <div className="car" ref={carRef} onScroll={onScroll}>
              {p.files.map((f, i) => (
                <div className={`slide${f.text !== undefined ? " read" : ""}`} key={f.id}>
                  <div className="tags">
                    {p.files.length > 1 && <span className="tag">{i + 1}/{p.files.length}</span>}
                    {fmtOf[f.id] && <span className={`tag ${fmtOf[f.id]}`}>{fmtOf[f.id] === "story" ? "Stories" : "Feed"}</span>}
                    {countFor(f.id) > 0 && <span className="tag adjn">✎ {countFor(f.id)}</span>}
                  </div>
                  {f.embed
                    ? <a className="dl" href={f.href} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
                    : <a className="dl" href={`${fileUrl(f.id)}?download=1`} download={f.fileName} aria-label={`Baixar ${f.fileName}`}>⬇ Baixar</a>}
                  {/* Nome sobreposto no rodapé: bom na imagem, mas no vídeo cobre
                      o play e a barra de tempo — ali o nome fica só embaixo do carrossel. */}
                  {f.text === undefined && !f.embed && !f.mimeType.startsWith("video/") && <div className="wm">{f.fileName.replace(/\.[a-z0-9]{2,5}$/i, "")}</div>}
                  {f.embed ? (
                    // Player do próprio Google/YouTube: o vídeo não passa pelo
                    // nosso servidor. Drive exige "qualquer pessoa com o link".
                    <iframe
                      className="emb"
                      src={f.embed}
                      title={f.fileName}
                      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                      allowFullScreen
                      loading={i < 2 ? "eager" : "lazy"}
                    />
                  ) : f.text !== undefined ? (
                    <>
                      {f.textKind === "md"
                        ? <div className="paper"><MarkdownDoc text={f.text} className="in" /></div>
                        : <div className="paper txt"><div className="in">{f.text}</div></div>}
                      <button type="button" className="full" onClick={() => setReadId(f.id)}>⤢ Ler em tela cheia</button>
                    </>
                  ) : f.mimeType.startsWith("image/") ? (
                    // Versão leve (até 1600 px) pra ver e aprovar; "Baixar" entrega o original.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${fileUrl(f.id)}?v=view`}
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
                    <video src={f.src ?? fileUrl(f.id)} controls playsInline preload="metadata" />
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
                {p.files.filter((x) => !x.embed).length > 1 && (
                  <div className="dlall">
                    <button type="button" onClick={downloadAll} disabled={downloading}>
                      {downloading ? "Baixando…" : `⬇ Baixar todos (${p.files.filter((x) => !x.embed).length})`}
                    </button>
                  </div>
                )}
                <div className="count">{idx + 1} de {p.files.length} · {p.files[idx]?.fileName.replace(/\.[a-z0-9]{2,5}$/i, "")}</div>
              </>
            )}
          </>
        ) : p.highlights.length > 0 ? (
          // Rodada só de texto (ex.: legenda depois das fotos aprovadas): o
          // texto destacado É a peça.
          <div className="card texto">
            <h3>📌 Texto para aprovação</h3>
            {p.highlights.map((h, i) => (
              <div key={i} className="hlitem pre" style={{ color: "var(--ink)" }}>{h.text}</div>
            ))}
          </div>
        ) : p.description?.trim() ? (
          <div className="card texto">
            <h3>Conteúdo para aprovação</h3>
            <TextoPeca text={p.description} mediaBase={p.mediaBase} />
          </div>
        ) : (
          <div className="card"><div className="pre">A peça ainda não foi anexada. Fale com a agência pelo grupo.</div></div>
        )}

          </div>
          <div className="cinfo">
        {p.highlights.length > 0 && p.files.length > 0 && (
          <div className="card hlbox">
            <h3>📌 Para aprovar</h3>
            {p.highlights.map((h, i) => (
              <div key={i} className="hlitem pre" style={{ color: "var(--ink)" }}>{h.text}</div>
            ))}
          </div>
        )}
        {adjs.length > 0 && (
          <div className="card adjc">
            <h3>{open.length === adjs.length ? `Ajustes anotados · ${adjs.length}` : `Ajustes desta versão · ${adjs.length}`}</h3>
            {pending && open.length > 0 && (
              <p className="hint" style={{ margin: "0 0 10px" }}>
                Ainda não foram pra equipe. Quando terminarem de anotar, toquem em “Enviar ajustes pra equipe”.
              </p>
            )}
            <div className="adjl">{adjs.map((a) => adjItem(a, true))}</div>
          </div>
        )}
        {p.previousAdjustments.length > 0 && (
          <div className="card">
            <h3>O que vocês pediram na versão anterior</h3>
            <p className="hint" style={{ margin: "0 0 10px" }}>Confira se ficou como pediram antes de aprovar.</p>
            <div className="adjl">{p.previousAdjustments.map((a) => adjItem(a, false))}</div>
          </div>
        )}
        {p.previous.length > 0 && (
          <div className="card prev">
            <h3>Artes que voltaram pra ajuste</h3>
            {p.previous.map((f) => (
              <div key={f.id} className="prevrow">
                <a className="th" href={`/api/aprovar/${p.token}/arquivo/${f.id}`} target="_blank" rel="noopener noreferrer" title={f.fileName}>
                  {/^image\//i.test(f.mimeType)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/api/aprovar/${p.token}/arquivo/${f.id}`} alt="" loading="lazy" />
                    : "📄"}
                  <b className={f.status === "reprovada" ? "rep" : ""}>{f.status === "reprovada" ? "REPROVADA" : "ALTERAR"}</b>
                </a>
                <div className="pd">
                  <small>{f.fileName.replace(/\.[a-z0-9]{2,5}$/i, "")}</small>
                  <div>{f.note?.trim() || "Pedido de ajuste (veja a conversa abaixo)."}</div>
                </div>
              </div>
            ))}
          </div>
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

        {p.files.length > 0 && p.description?.trim() && (
          <div className="card">
            <h3>Sobre a peça</h3>
            <TextoPeca text={p.description} mediaBase={p.mediaBase} />
          </div>
        )}

        {p.history.length > 0 && (
          <div className="card">
            <h3>Linha do tempo da peça</h3>
            <div className="hist">
              {p.history.map((h, i) => (
                <div key={i} className={`msg ${h.kind}`}>
                  <div className="mh">
                    {h.round && <span className="ver">Versão {h.round}</span>}
                    <span>
                      {h.kind === "sent" ? "📣 Enviada pra aprovação"
                        : h.kind === "approve" ? "✓ Você aprovou"
                        : h.kind === "adjust" ? "✎ Você pediu ajuste"
                        : h.kind === "team" ? p.brand.name
                        : "Você comentou"}
                    </span>
                  </div>
                  {h.text && <div>{h.text}</div>}
                  {h.files.length > 0 && (
                    <div className="thumbs">
                      {h.files.map((f) => (
                        <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer" title={f.fileName}>
                          {/^image\//i.test(f.mimeType)
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={`${fileUrl(f.id)}?v=thumb`} alt={f.fileName} loading="lazy" />
                            : <span>{f.fileName.split(".").pop()}</span>}
                        </a>
                      ))}
                    </div>
                  )}
                  <small>{h.kind === "sent" ? `${h.files.length} arquivo${h.files.length === 1 ? "" : "s"}` : h.kind === "team" ? "Equipe" : (h.who ?? "Você")} · {fmt(h.at)}</small>
                </div>
              ))}
            </div>
          </div>
        )}

          </div>
        </div>

        <ClientePendencias
          aprovacoes={p.pendencias.aprovacoes}
          chamados={p.pendencias.chamados}
          temAcesso={p.pendencias.temAcesso}
          agencia={p.pendencias.agencia}
          origem={{ kind: "aprovacao", token: p.token }}
          semPortal
        />

        <div className="links">
          {p.panelToken && <Link href={`/c/${p.panelToken}`}>Ver todas as entregas de {p.projectName} →</Link>}
        </div>
        <div className="made">{p.brand.name}</div>
      </div>

      {(pending || afterSend) && (
        <div className="bar">
          <div className="barw">
            {mode === "note" && (
              <>
                <textarea
                  className="f"
                  placeholder={afterSend ? "O que mais precisa mudar?" : "O que precisa mudar? (texto, cor, foto, data…)"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                />
                {!editing && p.files.length > 1 && (
                  <>
                    <div className="tgt">
                      <button type="button" className={target === "file" ? "on" : ""} onClick={() => setTarget("file")}>Só no arquivo {idx + 1}</button>
                      <button type="button" className={target === "all" ? "on" : ""} onClick={() => setTarget("all")}>Na peça toda</button>
                    </div>
                    {target === "file" && <div className="hint">Passe o carrossel pra escolher outro arquivo.</div>}
                  </>
                )}
              </>
            )}
            {mode === "confirm" && confirmInfo && (
              <div className="confirm">
                Tem {ajustes(confirmInfo.count)} anotado{confirmInfo.count === 1 ? "" : "s"} por {confirmInfo.authors} que ainda não {confirmInfo.count === 1 ? "foi" : "foram"} pra equipe.
                Aprovar mesmo assim? {confirmInfo.count === 1 ? "Ele vai" : "Eles vão"} junto como observação.
              </div>
            )}
            {(!afterSend || mode === "note") && (
              <input
                className="f"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            )}
            {err && <div className="err">{err}</div>}
            {okMsg && mode === "idle" && <div className="hint">{okMsg}</div>}
            {mode === "note" ? (
              <div className="row">
                <button className="btn ghost" onClick={() => { setMode("idle"); setEditing(null); setText(""); setErr(null); }} disabled={busy}>Voltar</button>
                <button className="btn warn" onClick={() => void saveNote()} disabled={busy}>
                  {busy ? "Salvando…" : editing ? "Salvar" : afterSend ? "Mandar pra equipe" : "Anotar ajuste"}
                </button>
              </div>
            ) : mode === "confirm" ? (
              <div className="row">
                <button className="btn ghost" onClick={() => setMode("idle")} disabled={busy}>Voltar</button>
                <button className="btn ok" onClick={() => void act("approve", true)} disabled={busy}>{busy ? "Enviando…" : "Aprovar mesmo assim"}</button>
              </div>
            ) : afterSend ? (
              <div className="row">
                <button className="btn ghost" onClick={() => startNote()}>＋ Esqueci uma coisa</button>
              </div>
            ) : (
              <>
                <div className="row">
                  <button className="btn ghost" onClick={() => startNote()} disabled={busy}>＋ Anotar ajuste</button>
                  <button className="btn ok" onClick={() => void act("approve")} disabled={busy}>{busy ? "Enviando…" : "✓ Aprovar"}</button>
                </div>
                {open.length > 0 && (
                  <button className="btn warn" onClick={() => void act("send")} disabled={busy}>
                    Enviar {ajustes(open.length)} pra equipe
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
