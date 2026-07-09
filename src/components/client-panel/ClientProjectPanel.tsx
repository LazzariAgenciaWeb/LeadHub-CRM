import type { ChecklistItem } from "@/lib/checklist";

/**
 * Painel premium do cliente para UM projeto/serviço. Reusado em dois lugares:
 *   - página pública por link secreto  /c/[token]      (embedded=false, ocupa a tela)
 *   - área do cliente logado           /meu-espaco/[id] (embedded=true, dentro da casca)
 * Recebe os dados já buscados/moldados; não faz query.
 */

export type PanelTask = {
  id: string; title: string; description: string | null; stage: string | null;
  checklist: ChecklistItem[]; done: boolean; dueDate: Date | null;
};
export type PanelMat = {
  id: string; kind: string; taskId: string | null; title: string;
  docHtml: string | null; url: string | null; ata: string | null; stage: string | null;
};

const catOf = (kind: string) => (kind === "DOCUMENTO" ? "doc" : kind === "LINK" || kind === "ANEXO" ? "link" : "video");
const fmtDM = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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
.tkdesc{font-size:13.5px;color:var(--ink2);margin-top:6px;line-height:1.6}
.tkck{list-style:none;margin:11px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}
.tkck li{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ink2)}
.tkck .ck{width:17px;height:17px;border-radius:50%;flex:none;display:grid;place-items:center;border:1.5px solid var(--line2);color:#08090C}
.tkck li.on .ck{background:var(--ok);border-color:var(--ok)}
.tkck li.on .ckt{color:var(--ink3);text-decoration:line-through}
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

const IconDoc   = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>;
const IconPlayS = <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8L7 4Z"/></svg>;
const IconPlay  = <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8L7 4Z"/></svg>;
const IconLink  = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 15 15 9M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5"/></svg>;
const IconLinkL = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 15 15 9M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5"/></svg>;
const IconDocL  = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>;
const IconExt   = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>;
const IconChk   = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><path d="M20 6 9 17l-5-5"/></svg>;
const IconChkS  = <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5"/></svg>;
const IconChv   = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>;

export default function ClientProjectPanel({
  name, description, clientName, tasks, materials, embedded = false,
}: {
  name: string;
  description: string | null;
  clientName: string | null;
  tasks: PanelTask[];
  materials: PanelMat[];
  embedded?: boolean;
}) {
  const now = new Date();
  const doneCount = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  const matsByTask = new Map<string, PanelMat[]>();
  const looseMats: PanelMat[] = [];
  for (const m of materials) {
    if (m.taskId) {
      const arr = matsByTask.get(m.taskId) ?? [];
      arr.push(m);
      matsByTask.set(m.taskId, arr);
    } else looseMats.push(m);
  }

  const groups = new Map<string, PanelTask[]>();
  for (const t of tasks) {
    const key = t.stage?.trim() || "";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const etapas = Array.from(groups.entries()).map(([key, ts]) => {
    const total = ts.length;
    const done = ts.filter((t) => t.done).length;
    const overdue = ts.filter((t) => !t.done && t.dueDate && new Date(t.dueDate) < now).length;
    const allDone = total > 0 && done === total;
    const status = allDone ? "done" : overdue > 0 ? "late" : done > 0 ? "prog" : "todo";
    const p = total ? Math.round((done / total) * 100) : 0;
    return { key, label: key || "Atividades", tasks: ts, total, done, overdue, allDone, status, pct: p };
  });

  function TaskMat({ m }: { m: PanelMat }) {
    const cat = catOf(m.kind);
    return (
      <div className={`tkmat ${cat}`}>
        <span className="ic">{cat === "video" ? IconPlayS : cat === "doc" ? IconDoc : IconLink}</span>
        <div className="mt">
          <div className="mtt">{m.title}</div>
          <div className="mtk">{KIND_LABEL[m.kind] ?? m.kind}</div>
          {m.docHtml && (
            <details className="tkexp">
              <summary className="go">Ver documento</summary>
              <div className="doc" dangerouslySetInnerHTML={{ __html: m.docHtml }} />
            </details>
          )}
          {m.ata && (
            <details className="tkexp">
              <summary className="go">Ata da reunião</summary>
              <p className="ata">{m.ata}</p>
            </details>
          )}
        </div>
        {m.url && <a className="go" href={m.url} target="_blank" rel="noreferrer">{cat === "video" ? "Assistir" : "Abrir"} {IconExt}</a>}
      </div>
    );
  }

  function TaskRow({ t }: { t: PanelTask }) {
    const overdue = !t.done && !!t.dueDate && new Date(t.dueDate) < now;
    const dot = t.done ? "done" : overdue ? "late" : "todo";
    const mats = matsByTask.get(t.id) ?? [];
    return (
      <div className={`tk ${t.done ? "done" : ""}`}>
        <div className="tkh">
          <span className={`tkdot ${dot}`}>{t.done ? IconChk : overdue ? "!" : ""}</span>
          <div className="tkmain">
            <div className="tktop">
              <span className="tkt">{t.title}</span>
              {t.done
                ? <span className="tkmeta ok">Concluído</span>
                : t.dueDate
                  ? <span className={"tkmeta " + (overdue ? "late" : "")}>{overdue ? "Atrasado · " : "Prazo "}{fmtDM(new Date(t.dueDate))}</span>
                  : <span className="tkmeta">Em andamento</span>}
            </div>
            {t.description && <p className="tkdesc">{t.description}</p>}
            {t.checklist.length > 0 && (
              <ul className="tkck">
                {t.checklist.map((c, i) => (
                  <li key={i} className={c.done ? "on" : ""}>
                    <span className="ck">{c.done ? IconChkS : ""}</span>
                    <span className="ckt">{c.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {mats.length > 0 && <div className="tkmats">{mats.map((m) => <TaskMat key={m.id} m={m} />)}</div>}
          </div>
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

        {etapas.length > 0 && (
          <section className="sec">
            <div className="sh">
              <h2>O que estamos construindo</h2>
              <span className="sc">{doneCount} de {tasks.length} entregas</span>
            </div>
            <div className="journey">
              {etapas.map((e, i) => (
                <details key={e.key || "__none__"} className={`ch ${e.status}`} open={!e.allDone}>
                  <summary className="chh">
                    <span className="chnum">{String(i + 1).padStart(2, "0")}</span>
                    <span className="chmeta">
                      <span className="chname">{e.label}</span>
                      <span className="chbar"><i style={{ width: `${e.pct}%` }} /></span>
                    </span>
                    <span className={`chpill ${e.status}`}>
                      {e.allDone ? "Concluída" : e.overdue > 0 ? `${e.overdue} em atraso` : `${e.done}/${e.total}`}
                    </span>
                    <span className="chchv">{IconChv}</span>
                  </summary>
                  <div className="chbody">
                    {e.tasks.map((t) => <TaskRow key={t.id} t={t} />)}
                  </div>
                </details>
              ))}
            </div>
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

        {tasks.length === 0 && looseMats.length === 0 && (
          <p className="empty" style={{ marginTop: 24 }}>Ainda não há nada por aqui. Volte em breve.</p>
        )}

        {!embedded && <footer className="foot">Atendido por <b>Azz</b> · Diego Lazzari</footer>}
      </div>
      <script dangerouslySetInnerHTML={{ __html: FILTER_JS }} />
    </div>
  );
}
