import type { ChecklistItem } from "@/lib/checklist";
import ServiceGantt from "./ServiceGantt";

/**
 * Painel premium do cliente para UM projeto/serviço. Reusado em dois lugares:
 *   - página pública por link secreto  /c/[token]      (embedded=false, ocupa a tela)
 *   - área do cliente logado           /meu-espaco/[id] (embedded=true, dentro da casca)
 * Recebe os dados já buscados/moldados; não faz query.
 */

export type PanelTask = {
  id: string; title: string; description: string | null; stage: string | null;
  projectServiceId: string | null;
  checklist: ChecklistItem[]; comments: { text: string; at: string; by?: "client" }[];
  done: boolean; startDate: Date | null; dueDate: Date | null; updatedAt: Date | null;
  awaitingClient: boolean;
};
export type PanelStep = { id: string; name: string; order: number };
export type PanelMat = {
  id: string; kind: string; taskId: string | null; title: string;
  docHtml: string | null; url: string | null; ata: string | null; stage: string | null;
  featured?: boolean;
};

const catOf = (kind: string) => (kind === "DOCUMENTO" ? "doc" : kind === "LINK" || kind === "ANEXO" ? "link" : "video");
const KIND_LABEL: Record<string, string> = { DOCUMENTO: "Documento", REUNIAO: "Reunião", APOIO: "Apoio", LINK: "Link", ANEXO: "Anexo" };
const CIRC = 2 * Math.PI * 32;

const STYLE = `
.cp{
  --accent:#6E86FF;--violet:#9B7BFF;--ok:#4FD1A0;--warn:#F5B564;
  --ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;
  --line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);
  --card:rgba(255,255,255,.035);
  min-height:100vh;color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5;
  background:
    radial-gradient(115% 80% at 82% -12%,rgba(110,134,255,.18),transparent 58%),
    radial-gradient(95% 70% at 2% 4%,rgba(155,123,255,.14),transparent 55%),
    radial-gradient(120% 90% at 50% 120%,rgba(79,209,160,.07),transparent 60%),
    #06070C;
}
.cp.emb{min-height:0;background:none}
.cp *{box-sizing:border-box}
.cpw{max-width:820px;margin:0 auto;padding:38px 22px 84px}
.cp.emb .cpw{padding:8px 4px 40px}
::selection{background:rgba(110,134,255,.35)}
.hero{position:relative;overflow:hidden;border-radius:26px;padding:38px 34px;
  background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.015)),
    radial-gradient(120% 150% at 88% -30%,rgba(110,134,255,.40),transparent 52%),
    radial-gradient(90% 130% at 4% 130%,rgba(155,123,255,.30),transparent 55%),#0A0C14;
  border:1px solid var(--line2);
  box-shadow:0 40px 90px -46px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08);
  display:flex;align-items:center;gap:26px;flex-wrap:wrap}
.hero::before{content:"";position:absolute;width:340px;height:340px;right:-70px;top:-140px;border-radius:50%;
  background:radial-gradient(circle,rgba(139,131,255,.55),transparent 62%);filter:blur(18px);pointer-events:none}
.hmain{position:relative;z-index:1;flex:1;min-width:230px}
.hbadge{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:#CBD3EA;background:rgba(255,255,255,.06);border:1px solid var(--line2);padding:6px 12px;border-radius:99px}
.hbadge .dt{width:7px;height:7px;border-radius:50%;background:linear-gradient(135deg,#6E86FF,#9B7BFF);box-shadow:0 0 10px 1px rgba(110,134,255,.8)}
.hero h1{position:relative;z-index:1;margin:14px 0 8px;font-size:30px;font-weight:800;letter-spacing:-.025em;line-height:1.12;text-wrap:balance;
  background:linear-gradient(180deg,#FFFFFF,#C7CEE0);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{position:relative;z-index:1;margin:0;font-size:14.5px;color:var(--ink2);max-width:44ch}
.hring{position:relative;z-index:1;width:104px;height:104px;flex:none;display:grid;place-items:center}
.hring svg{position:absolute;inset:0;filter:drop-shadow(0 6px 16px rgba(110,134,255,.35))}
.hrc{display:grid;place-items:center;text-align:center}
.hrc b{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1}
.hrc span{font-size:10.5px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);margin-top:3px}
.sec{margin-top:40px}
.sec .sh{display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 18px}
.sec h2{margin:0;font-size:12.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.sec .sc{font-size:12px;color:var(--ink3)}
/* Switcher de serviços do projeto (área logada) */
.svcsw{display:flex;gap:9px;flex-wrap:wrap}
.svcchip{display:inline-flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink2);
  padding:9px 14px;border-radius:13px;border:1px solid var(--line);background:var(--card);
  transition:border-color .15s,background .15s,color .15s;min-width:0}
.svcchip:hover{border-color:var(--line2);color:var(--ink)}
.svcchip.on{border-color:var(--accent);background:rgba(110,134,255,.14);color:var(--ink)}
.svcchip .nm{font-size:13.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px}
.svcchip .pr{font-size:11px;color:var(--ink3);font-variant-numeric:tabular-nums}
.svcchip.on .pr{color:#B6C4FF}
.svcchip.all{justify-content:center;font-size:13.5px;font-weight:700;color:var(--ink2)}
.svcchip.all.on{color:var(--ink)}
.journey{position:relative}
.ch{position:relative;margin-bottom:14px;border-radius:20px;overflow:hidden;
  background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012));
  border:1px solid var(--line);box-shadow:0 24px 46px -34px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.05);
  transition:border-color .2s,box-shadow .2s}
.ch[open]{border-color:rgba(110,134,255,.30);box-shadow:0 30px 60px -30px rgba(46,58,140,.55),inset 0 1px 0 rgba(255,255,255,.07)}
.chh{list-style:none;cursor:pointer;display:flex;align-items:center;gap:16px;padding:18px 20px;user-select:none}
.chh::-webkit-details-marker{display:none}
.chnum{flex:none;width:40px;font-size:22px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;
  background:linear-gradient(135deg,#8CA0FF,#B79BFF);-webkit-background-clip:text;background-clip:text;color:transparent}
.ch.done .chnum{background:linear-gradient(135deg,#4FD1A0,#6E86FF);-webkit-background-clip:text;background-clip:text;color:transparent}
.ch.late .chnum{background:linear-gradient(135deg,#F5B564,#F59E5B);-webkit-background-clip:text;background-clip:text;color:transparent}
.chmeta{flex:1;min-width:0}
.chname{font-size:16.5px;font-weight:740;letter-spacing:-.015em}
.chbar{margin-top:9px;height:5px;width:min(230px,46vw);border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden}
.chbar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--violet));box-shadow:0 0 12px rgba(110,134,255,.5)}
.ch.done .chbar i{background:linear-gradient(90deg,#4FD1A0,#6E86FF)}
.ch.late .chbar i{background:linear-gradient(90deg,#F5B564,#F59E5B)}
.chpill{flex:none;font-size:11.5px;font-weight:650;padding:6px 12px;border-radius:99px;white-space:nowrap;border:1px solid transparent}
.chpill.done{color:var(--ok);background:rgba(79,209,160,.10);border-color:rgba(79,209,160,.24)}
.chpill.prog{color:#B6C4FF;background:rgba(110,134,255,.12);border-color:rgba(110,134,255,.28)}
.chpill.late{color:var(--warn);background:rgba(245,181,100,.12);border-color:rgba(245,181,100,.30)}
.chpill.todo{color:var(--ink3);background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.10)}
.chchv{flex:none;color:var(--ink3);transition:transform .22s}
.ch[open] .chchv{transform:rotate(90deg)}
.chbody{padding:2px 22px 10px;border-top:1px solid var(--line)}
.tk{padding:17px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.tk:last-child{border-bottom:none}
.tkh{display:flex;align-items:flex-start;gap:12px}
.tkdot{width:22px;height:22px;border-radius:50%;flex:none;margin-top:1px;display:grid;place-items:center;color:#08090C;font-weight:800;font-size:12px}
.tkdot.done{background:var(--ok);box-shadow:0 0 0 4px rgba(79,209,160,.12)}
.tkdot.late{background:var(--warn);box-shadow:0 0 0 4px rgba(245,181,100,.12)}
.tkdot.todo{background:transparent;border:2px solid var(--line2)}
.tkmain{flex:1;min-width:0}
.tktop{display:flex;align-items:baseline;justify-content:space-between;gap:14px}
.tkt{font-size:15px;font-weight:660;letter-spacing:-.01em}
.tk.done .tkt{color:var(--ink2)}
.tkmeta{font-size:12px;font-weight:650;color:var(--ink3);white-space:nowrap;flex:none}
.tkmeta.ok{color:var(--ok)}.tkmeta.late{color:var(--warn)}
.tkmeta.await{color:#0B0E14;background:var(--warn);padding:3px 10px;border-radius:99px;font-weight:700}
.tkdot.await{background:var(--warn);box-shadow:0 0 0 4px rgba(245,181,100,.14)}
.tkupd li.byclient{background:rgba(110,134,255,.05);margin:0 -6px;padding:2px 6px;border-radius:6px}
.tkupd .uby{color:var(--accent);font-weight:700}
.tkresp{margin-top:12px;padding:13px;border:1px solid rgba(245,181,100,.32);background:rgba(245,181,100,.06);border-radius:13px}
.tkresp textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--line2);border-radius:10px;color:var(--ink);font-size:13.5px;padding:9px 11px;outline:none;font-family:inherit;resize:vertical}
.tkresp textarea:focus{border-color:var(--warn)}
.tkresp button{margin-top:8px;background:linear-gradient(135deg,#6E86FF,#9B7BFF);color:#fff;border:none;border-radius:9px;font-weight:660;font-size:13px;padding:8px 16px;cursor:pointer}
.tkresp button:disabled{opacity:.5;cursor:default}
.tkresperr{color:#FCA5A5;font-size:12px;margin:6px 0 0}
.tkdates{display:inline-flex;align-items:center;gap:5px;margin-top:7px;font-size:11.5px;font-weight:640;color:var(--ink3);background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:99px;padding:3px 10px}
.tkdesc{font-size:13.5px;color:var(--ink2);margin-top:6px;line-height:1.6}
.tkck{list-style:none;margin:11px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}
.tkck li{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ink2)}
.tkck .ck{width:17px;height:17px;border-radius:50%;flex:none;display:grid;place-items:center;border:1.5px solid var(--line2);color:#08090C}
.tkck li.on .ck{background:var(--ok);border-color:var(--ok)}
.tkck li.on .ckt{color:var(--ink3);text-decoration:line-through}
.tkck .ckt{flex:1;min-width:0}
.tkck .ckd{flex:none;font-size:11px;font-weight:650;color:var(--ok);white-space:nowrap}
.tkupat{margin-top:10px;font-size:11px;color:var(--ink3);font-style:italic}
.tkupd{list-style:none;margin:11px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.tkupd li{display:flex;gap:11px;position:relative}
.tkupd .fdot{width:9px;height:9px;border-radius:50%;background:var(--accent);flex:none;margin-top:12px;box-shadow:0 0 0 4px rgba(110,134,255,.12)}
.tkupd li.byclient .fdot{background:var(--warn);box-shadow:0 0 0 4px rgba(245,181,100,.14)}
.tkupd .fbubble{flex:1;min-width:0;background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:12px;padding:10px 13px}
.tkupd li.byclient .fbubble{background:rgba(245,181,100,.06);border-color:rgba(245,181,100,.22)}
.tkupd .fhead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:5px}
.tkupd .fauthor{font-size:12px;font-weight:700;color:var(--ink)}
.tkupd li.byclient .fauthor{color:var(--warn)}
.tkupd .fdate{font-size:11px;color:var(--ink3);font-variant-numeric:tabular-nums;flex:none}
.tkupd .ftext{font-size:13.5px;color:var(--ink2);line-height:1.55;white-space:pre-wrap}
.tkmats{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.tkmat{display:flex;align-items:center;gap:11px;padding:9px 12px;border:1px solid var(--line);border-radius:12px;
  background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));transition:border-color .15s,transform .15s}
.tkmat:hover{border-color:var(--line2);transform:translateY(-1px)}
.tkmat .ic{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:#fff;flex:none;box-shadow:0 6px 14px -6px rgba(0,0,0,.6)}
.tkmat.doc .ic{background:linear-gradient(135deg,#6366F1,#9B7BFF)}
.tkmat.video .ic{background:linear-gradient(135deg,#0EA37F,#0b1220)}
.tkmat.link .ic{background:linear-gradient(135deg,#0EA5E9,#3B82F6)}
.tkmat .mt{flex:1;min-width:0}
.tkmat .mtt{font-size:13.5px;font-weight:640;letter-spacing:-.01em}
.tkmat .mtk{font-size:11px;color:var(--ink3);letter-spacing:.02em}
.tkmat .go{font-size:12.5px;font-weight:660;color:#AFC0FF;text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.tkexp{margin-top:9px}
.chips{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px}
.chip{font-size:12.5px;font-weight:650;padding:8px 15px;border-radius:99px;border:1px solid var(--line2);
  background:rgba(255,255,255,.04);color:var(--ink2);cursor:pointer;transition:.15s}
.chip:hover{color:var(--ink);border-color:rgba(255,255,255,.24)}
.chip.on{background:linear-gradient(135deg,#6E86FF,#9B7BFF);color:#fff;border-color:transparent;box-shadow:0 8px 22px -10px rgba(110,134,255,.7)}
.rail{display:flex;gap:15px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x mandatory}
.rail::-webkit-scrollbar{height:7px}
.rail::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px}
.poster{flex:0 0 210px;scroll-snap-align:start;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;
  background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid var(--line);
  box-shadow:0 22px 44px -30px rgba(0,0,0,.9);transition:transform .18s,box-shadow .18s,border-color .18s}
.poster:hover{transform:translateY(-5px);box-shadow:0 34px 60px -28px rgba(30,40,110,.7);border-color:var(--line2)}
.poster.hide{display:none}
.pcov{height:112px;position:relative;display:grid;place-items:center;color:#fff}
.poster.doc .pcov{background:linear-gradient(140deg,#5B57F0,#9B7BFF)}
.poster.video .pcov{background:linear-gradient(140deg,#0E4C46,#0a0f1c)}
.poster.link .pcov{background:linear-gradient(140deg,#0EA5E9,#3B57F6)}
.pcov::after{content:"";position:absolute;inset:0;background:radial-gradient(70% 70% at 50% 30%,rgba(255,255,255,.18),transparent 70%)}
.pcov .kt{position:absolute;top:10px;left:10px;z-index:1;font-size:10px;font-weight:700;letter-spacing:.04em;color:#fff;background:rgba(0,0,0,.4);padding:3px 9px;border-radius:7px;backdrop-filter:blur(6px)}
.pcov .pl{position:relative;z-index:1;width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.95);color:#12141A;display:grid;place-items:center;box-shadow:0 10px 24px -6px rgba(0,0,0,.6)}
.pbody{padding:13px 15px;display:flex;flex-direction:column;gap:8px;flex:1}
.pbody h3{margin:0;font-size:14px;font-weight:660;letter-spacing:-.01em}
.pacts{margin-top:auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.pacts a,.pacts .lk{font-size:12.5px;font-weight:660;color:#AFC0FF;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.doc{margin-top:10px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.28);padding:15px;font-size:14px;color:var(--ink2);line-height:1.65}
.doc :where(h1,h2,h3){color:var(--ink);margin:0 0 8px;font-size:15px}
.doc p{margin:0 0 8px}.doc a{color:#AFC0FF}
details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}
.ata{margin-top:10px;font-size:13.5px;color:var(--ink2);white-space:pre-line}
.foot{margin-top:56px;padding-top:24px;border-top:1px solid var(--line);text-align:center;font-size:12px;color:var(--ink3)}
.foot b{color:var(--ink2);font-weight:650}
.empty{color:var(--ink3);font-size:14px}
svg{display:block}

/* ===== DESTAQUES (materiais principais) ===== */
.featgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.featcard{position:relative;overflow:hidden;border-radius:18px;padding:20px 22px;
  background:linear-gradient(180deg,rgba(245,181,100,.10),rgba(255,255,255,.02)),#0A0C14;
  border:1px solid rgba(245,181,100,.34);
  box-shadow:0 26px 54px -34px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.06)}
.featcard::before{content:"";position:absolute;right:-60px;top:-90px;width:220px;height:220px;border-radius:50%;
  background:radial-gradient(circle,rgba(245,181,100,.30),transparent 62%);filter:blur(14px);pointer-events:none}
.feathead{position:relative;z-index:1;display:flex;align-items:flex-start;gap:15px}
.featic{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;color:#0B0E14;flex:none;
  background:linear-gradient(135deg,#F7C97E,#E09A3E);box-shadow:0 10px 22px -8px rgba(245,181,100,.6)}
.featmeta{flex:1;min-width:0}
.featpill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  color:#F5B564;background:rgba(245,181,100,.12);border:1px solid rgba(245,181,100,.30);padding:3px 9px;border-radius:99px}
.feattitle{font-size:18px;font-weight:740;letter-spacing:-.02em;margin:9px 0 2px;line-height:1.2}
.featsub{font-size:12.5px;color:var(--ink3)}
.featacts{position:relative;z-index:1;margin-top:15px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.featacts a,.featacts .lk{font-size:13.5px;font-weight:660;color:#0B0E14;background:linear-gradient(135deg,#F7C97E,#E9A24E);
  padding:9px 16px;border-radius:10px;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;gap:7px;border:none}
.featacts details{width:100%}
.featacts details .doc,.featacts details .ata{margin-top:12px}

/* ===== GANTT ===== */
.glegend{display:flex;gap:15px;flex-wrap:wrap;margin:0 2px 14px;font-size:12px;color:var(--ink2);align-items:center}
.glegend span{display:inline-flex;align-items:center;gap:6px}
.glegend i{width:12px;height:12px;border-radius:3px;flex:none}
.gwrap{border:1px solid var(--line);border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008));overflow-x:auto;box-shadow:0 24px 46px -34px rgba(0,0,0,.9)}
.ginner{min-width:820px;position:relative}
.ghead{display:flex;height:34px;border-bottom:1px solid var(--line)}
.gcolh{width:280px;flex:none;display:flex;align-items:center;padding:0 16px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.gtime{flex:1;position:relative}
.gmonth{position:absolute;top:0;height:34px;font-size:11px;font-weight:700;color:var(--ink3);padding:9px 0 0 8px;border-left:1px solid var(--line)}
.ggrp{display:flex;align-items:center;gap:10px;padding:9px 16px;font-size:13px;font-weight:800;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:rgba(255,255,255,.03)}
.ggrp .pb{width:26px;height:21px;border-radius:6px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:11px;flex:none}
.ggrp .gt{flex:1;min-width:0;letter-spacing:-.01em}
.ggrp .tagm{font-size:10px;font-weight:700;padding:2px 9px;border-radius:99px;color:var(--ink3);background:rgba(255,255,255,.05);border:1px solid var(--line)}
.grow{display:flex;align-items:center;min-height:48px;border-bottom:1px solid var(--line);cursor:pointer;transition:background .12s}
.grow:hover{background:rgba(255,255,255,.04)}
.grow:last-child{border-bottom:0}
.vtoggle{display:inline-flex;gap:3px;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:11px;padding:3px;margin-bottom:14px}
.vtoggle button{border:0;background:transparent;color:var(--ink3);font-weight:700;font-size:12.5px;padding:7px 15px;border-radius:8px;cursor:pointer;font-family:inherit}
.vtoggle button.on{background:rgba(255,255,255,.1);color:var(--ink)}
.glist{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008))}
.glist .ggrp:first-child{border-top:0}
.gl-empty{padding:11px 16px;font-size:12.5px;font-style:italic;color:var(--ink3);border-bottom:1px solid var(--line)}
.gl-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);cursor:pointer;transition:background .12s}
.gl-row:hover{background:rgba(255,255,255,.04)}
.gl-row:last-child{border-bottom:0}
.gl-dot{width:20px;height:20px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;border:2px solid}
.gl-tn{flex:1;min-width:0;font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gl-badge{font-size:11px;font-weight:800;flex:none}
.gl-when{font-size:11.5px;color:var(--ink3);flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}
.gl-go{color:var(--ink3);font-size:18px;font-weight:700;flex:none}
.gnm{width:280px;flex:none;padding:8px 16px;overflow:hidden}
.gnm .tn{font-size:13px;font-weight:600;line-height:1.28;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gnm .td{font-size:11px;color:var(--ink3);margin-top:2px}
.gtk{flex:1;position:relative;height:100%}
.gbar{position:absolute;top:50%;transform:translateY(-50%);height:22px;border-radius:7px;box-shadow:0 4px 10px -4px rgba(0,0,0,.6);overflow:hidden}
.gbar.done{background:#10B981}
.gbar.todo{background:#4B5563}
.gbar.late{background:#F87171}
.gbar.exec{background:rgba(110,134,255,.35)}
.gbar.exec i{position:absolute;left:0;top:0;bottom:0;width:55%;background:#6E86FF}
.gbar.wait{background:#F5B564;animation:gpulse 2.2s ease-in-out infinite}
@keyframes gpulse{0%,100%{box-shadow:0 0 0 3px rgba(245,181,100,.22)}50%{box-shadow:0 0 0 7px rgba(245,181,100,.02)}}
.gnodate{position:absolute;top:50%;left:12px;transform:translateY(-50%);font-size:11px;color:var(--ink3);font-style:italic}
.gtoday{position:absolute;top:34px;bottom:0;width:0;border-left:2px dashed var(--warn);z-index:4;pointer-events:none}
.gtoday span{position:absolute;top:2px;left:0;transform:translateX(-50%);font-size:9px;font-weight:800;letter-spacing:.06em;color:#0B0E14;background:var(--warn);padding:1px 7px;border-radius:5px}

/* ===== MODAL TAREFA ===== */
.gov{position:fixed;inset:0;background:rgba(6,7,12,.72);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;z-index:80;padding:18px}
.gmodal{background:#0C0F17;border:1px solid var(--line2);border-radius:20px;width:100%;max-width:500px;max-height:92vh;overflow:auto;box-shadow:0 40px 90px -30px rgba(0,0,0,.9);position:relative}
.gmodal .gx{position:absolute;top:13px;right:13px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid var(--line2);color:var(--ink);display:grid;place-items:center;cursor:pointer;z-index:2}
.gmh{padding:20px 20px 0}
.gmchips{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.gmph{font-size:10.5px;font-weight:700;color:#fff;padding:3px 10px;border-radius:6px}
.gmpill{font-size:11px;font-weight:700;padding:4px 11px;border-radius:99px;border:1px solid transparent}
.gmpill.done{color:var(--ok);background:rgba(79,209,160,.10);border-color:rgba(79,209,160,.24)}
.gmpill.exec{color:#B6C4FF;background:rgba(110,134,255,.12);border-color:rgba(110,134,255,.28)}
.gmpill.wait,.gmpill.late{color:var(--warn);background:rgba(245,181,100,.12);border-color:rgba(245,181,100,.30)}
.gmpill.todo{color:var(--ink3);background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.10)}
.gmt{margin:0;font-size:20px;font-weight:760;letter-spacing:-.02em}
.gmdt{display:flex;margin:16px 20px 0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.gmdt div{flex:1;padding:11px 15px}
.gmdt div+div{border-left:1px solid var(--line)}
.gmdt .k{font-size:11px;color:var(--ink3)}
.gmdt .v{font-size:14px;font-weight:680;margin-top:2px}
.gms{padding:16px 20px 0}
.gms h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin:0 0 7px;font-weight:700}
.gms p.desc{margin:0;font-size:13.5px;color:var(--ink2);line-height:1.55}
.gms .tkck,.gms .tkupd,.gms .tkmats{margin-top:0}
.gmfoot{padding:10px 20px 20px}

/* ===== ANEXOS ABAIXO DO GANTT (pôsteres) ===== */
.gattach{margin-top:26px}
.gattach-h{font-size:12.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:0 2px 16px}
.arail{display:flex;gap:18px;overflow-x:auto;padding:2px 2px 14px;scroll-snap-type:x mandatory}
.arail::-webkit-scrollbar{height:7px}
.arail::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px}
.aposter{flex:0 0 232px;scroll-snap-align:start;text-decoration:none;color:inherit;cursor:pointer;display:block}
.acov{position:relative;height:130px;border-radius:14px;overflow:hidden;display:grid;place-items:center;
  background:radial-gradient(80% 80% at 50% 34%,#26325a,#0b1020 72%);border:1px solid var(--line);
  box-shadow:0 20px 40px -26px rgba(0,0,0,.9);transition:transform .18s,box-shadow .18s,border-color .18s}
.aposter.doc .acov{background:radial-gradient(80% 80% at 50% 34%,#3a2c66,#120c26 72%)}
.aposter.link .acov{background:radial-gradient(80% 80% at 50% 34%,#183a5a,#08121f 72%)}
.aposter:hover .acov{transform:translateY(-4px);box-shadow:0 30px 54px -24px rgba(30,40,110,.7);border-color:var(--line2)}
.akt{position:absolute;top:11px;left:11px;z-index:1;font-size:11px;font-weight:700;color:#fff;background:rgba(0,0,0,.42);padding:3px 10px;border-radius:7px;backdrop-filter:blur(6px)}
.adur{position:absolute;bottom:11px;right:11px;z-index:1;font-size:11px;font-weight:700;color:#fff;background:rgba(0,0,0,.55);padding:2px 9px;border-radius:6px}
.aplay{width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.96);color:#12141A;display:grid;place-items:center;box-shadow:0 12px 26px -8px rgba(0,0,0,.6)}
.aic{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18)}
.abody{padding:12px 4px 0}
.atitle{font-size:15px;font-weight:680;letter-spacing:-.01em;color:var(--ink);line-height:1.3}
.asub{font-size:12.5px;color:var(--ink3);margin-top:3px}
`;

const FILTER_JS = `
document.querySelectorAll('.cp .chip').forEach(function(c){
  c.addEventListener('click',function(){
    var root=c.closest('.cp');
    root.querySelectorAll('.chip').forEach(function(x){x.classList.remove('on')});
    c.classList.add('on');
    var f=c.getAttribute('data-f');
    root.querySelectorAll('.poster').forEach(function(m){
      m.classList.toggle('hide', f!=='all' && m.getAttribute('data-cat')!==f);
    });
  });
});`;

const IconPlay  = <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8L7 4Z"/></svg>;
const IconLinkL = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 15 15 9M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5"/></svg>;
const IconDocL  = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>;
const IconExt   = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>;
const IconStar  = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.6 1.4 6.8L12 17.8 5.9 20.5l1.4-6.8L2.2 9.1l6.9-.8Z"/></svg>;

export default function ClientProjectPanel({
  name, description, clientName, tasks, materials, serviceSteps = [], embedded = false,
  projectId = "", token = "", selectedServiceId,
}: {
  name: string;
  description: string | null;
  clientName: string | null;
  tasks: PanelTask[];
  materials: PanelMat[];
  serviceSteps?: PanelStep[];
  embedded?: boolean;
  projectId?: string;
  token?: string;
  selectedServiceId?: string;
}) {
  // Serviço selecionado (via ?servico= na área logada): mostra só as etapas dele.
  // Só filtra quando o id casa com um serviceStep real; senão, visão completa.
  const sel = selectedServiceId && serviceSteps.some((s) => s.id === selectedServiceId) ? selectedServiceId : null;
  const selName = sel ? (serviceSteps.find((s) => s.id === sel)?.name ?? "Serviço") : null;
  const viewTasks = sel ? tasks.filter((t) => t.projectServiceId === sel) : tasks;
  const viewSteps = sel ? serviceSteps.filter((s) => s.id === sel) : serviceSteps;
  // Switcher só na área logada (tem projectId) e quando há mais de um serviço.
  const showSwitcher = !!projectId && serviceSteps.length > 1;

  const doneCount = viewTasks.filter((t) => t.done).length;
  const pct = viewTasks.length ? Math.round((doneCount / viewTasks.length) * 100) : 0;
  const featured = materials.filter((m) => m.featured);
  const looseMats = materials.filter((m) => !m.taskId && !m.featured);
  const ganttMats = materials.filter((m) => !m.featured); // destaques saem do rail/modal (ficam no topo)

  function Feature({ m }: { m: PanelMat }) {
    const cat = catOf(m.kind);
    return (
      <div className="featcard">
        <div className="feathead">
          <span className="featic">{cat === "video" ? IconPlay : cat === "doc" ? IconDocL : IconLinkL}</span>
          <div className="featmeta">
            <span className="featpill">{IconStar} Destaque</span>
            <div className="feattitle">{m.title}</div>
            <div className="featsub">{KIND_LABEL[m.kind] ?? m.kind}{m.stage ? ` · ${m.stage}` : ""}</div>
          </div>
        </div>
        <div className="featacts">
          {m.url && <a href={m.url} target="_blank" rel="noreferrer">{cat === "video" ? "Assistir" : "Abrir"} {IconExt}</a>}
          {m.docHtml && (
            <details>
              <summary className="lk">Abrir documento</summary>
              <div className="doc" dangerouslySetInnerHTML={{ __html: m.docHtml }} />
            </details>
          )}
          {m.ata && (
            <details>
              <summary className="lk">Ata da reunião</summary>
              <p className="ata">{m.ata}</p>
            </details>
          )}
        </div>
      </div>
    );
  }

  function Poster({ m }: { m: PanelMat }) {
    const cat = catOf(m.kind);
    return (
      <div className={`poster ${cat}`} data-cat={cat}>
        <div className="pcov">
          <span className="kt">{KIND_LABEL[m.kind] ?? m.kind}</span>
          {cat === "video" ? <span className="pl">{IconPlay}</span> : cat === "doc" ? IconDocL : IconLinkL}
        </div>
        <div className="pbody">
          <h3>{m.title}</h3>
          <div className="pacts">
            {m.url && <a href={m.url} target="_blank" rel="noreferrer">{cat === "video" ? "Assistir" : "Abrir"} {IconExt}</a>}
            {m.docHtml && (
              <details>
                <summary className="lk">Ver documento</summary>
                <div className="doc" dangerouslySetInnerHTML={{ __html: m.docHtml }} />
              </details>
            )}
            {m.ata && (
              <details>
                <summary className="lk">Ata</summary>
                <p className="ata">{m.ata}</p>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`cp${embedded ? " emb" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="cpw">
        <header className="hero">
          <div className="hmain">
            <div className="hbadge"><span className="dt" />{clientName ?? "Cliente"}</div>
            <h1>{name}</h1>
            {description && <p>{description}</p>}
          </div>
          {tasks.length > 0 && (
            <div className="hring">
              <svg width="104" height="104" viewBox="0 0 76 76">
                <circle cx="38" cy="38" r="32" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="6" />
                <circle cx="38" cy="38" r="32" fill="none" stroke="url(#hg)" strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct / 100)} transform="rotate(-90 38 38)" />
                <defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6E86FF" /><stop offset="1" stopColor="#9B7BFF" /></linearGradient></defs>
              </svg>
              <div className="hrc"><b>{pct}%</b><span>concluído</span></div>
            </div>
          )}
        </header>

        {featured.length > 0 && (
          <section className="sec">
            <div className="sh"><h2>Destaques</h2></div>
            <div className="featgrid">
              {featured.map((m) => <Feature key={m.id} m={m} />)}
            </div>
          </section>
        )}

        {showSwitcher && (
          <section className="sec">
            <div className="sh"><h2>Serviços deste projeto</h2><span className="sc">toque pra trocar</span></div>
            <div className="svcsw">
              <a href={`/meu-espaco/${projectId}`} className={`svcchip all${!sel ? " on" : ""}`}>Ver todos</a>
              {serviceSteps.map((s) => {
                const st = tasks.filter((t) => t.projectServiceId === s.id);
                const dn = st.filter((t) => t.done).length;
                return (
                  <a key={s.id} href={`/meu-espaco/${projectId}?servico=${s.id}`} className={`svcchip${sel === s.id ? " on" : ""}`}>
                    <span className="nm">{s.name}</span>
                    <span className="pr">{st.length ? `${dn}/${st.length} etapas` : "sem etapas"}</span>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {viewTasks.length > 0 && (
          <section className="sec">
            <div className="sh">
              <h2>{selName ?? "Andamento"}</h2>
              <span className="sc">{doneCount} de {viewTasks.length} entregas</span>
            </div>
            <ServiceGantt tasks={viewTasks} materials={ganttMats} serviceSteps={viewSteps} projectId={projectId} token={token} />
          </section>
        )}

        {looseMats.length > 0 && (
          <section className="sec">
            <div className="sh"><h2>Sua biblioteca</h2></div>
            <div className="chips">
              <button className="chip on" data-f="all">Tudo</button>
              <button className="chip" data-f="doc">Documentos</button>
              <button className="chip" data-f="video">Vídeos</button>
              <button className="chip" data-f="link">Links</button>
            </div>
            <div className="rail">
              {looseMats.map((m) => <Poster key={m.id} m={m} />)}
            </div>
          </section>
        )}

        {tasks.length === 0 && looseMats.length === 0 && featured.length === 0 && (
          <p className="empty" style={{ marginTop: 24 }}>Ainda não há nada por aqui. Volte em breve.</p>
        )}

        {!embedded && <footer className="foot">Atendido por <b>Azz</b> · Diego Lazzari</footer>}
      </div>
      <script dangerouslySetInnerHTML={{ __html: FILTER_JS }} />
    </div>
  );
}
