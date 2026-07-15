"use client";

import { useState } from "react";
import Link from "next/link";

type Update = { text: string; at: string; client: boolean };
type Task = { id: string; title: string; description: string | null; done: boolean; startDate: string | null; dueDate: string | null; awaitingClient: boolean; updates: Update[] };
type Service = { id: string; name: string; tasks: Task[] };
type Project = { id: string; name: string; color: string; services: Service[] };

const SC: Record<string, string> = { done: "#4FD1A0", exec: "#7AA0FF", wait: "#F5B564", late: "#F87171", todo: "#5A6473" };
const SL: Record<string, string> = { done: "Concluído", exec: "Em execução", wait: "Aguardando você", late: "Atrasado", todo: "A fazer" };
const fmtDM = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const stripImg = (s: string) => s.replace(/\[\[img:[^\]]+\]\]/g, "").trim();

// Seus projetos (filtro) + Serviços em execução com as tarefas visíveis. Clicar
// numa tarefa abre um painel com o descritivo e as atualizações ("o que já foi
// feito"). Para o cronograma completo, o card leva ao painel do projeto.
export default function ProjetosServicos({ projects }: { projects: Project[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<{ t: Task; p: Project } | null>(null);
  const now = Date.now();
  const stOf = (t: Task): string =>
    t.done ? "done"
    : t.awaitingClient ? "wait"
    : (t.dueDate && new Date(t.dueDate).getTime() < now) ? "late"
    : (t.startDate && new Date(t.startDate).getTime() <= now) ? "exec"
    : "todo";

  const shown = filter ? projects.filter((p) => p.id === filter) : projects;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />

      <section className="row">
        <div className="rowhead"><h2>Seus projetos</h2><span className="sub">{projects.length > 1 ? "clique pra ver só um projeto" : "seu projeto ativo"}</span></div>
        <div className="ps-projs">
          {projects.map((p) => {
            const nt = p.services.reduce((a, s) => a + s.tasks.length, 0);
            const on = filter === p.id;
            return (
              <button key={p.id} className={`ps-proj ${on ? "on" : ""}`} style={{ "--pc": p.color } as React.CSSProperties} onClick={() => setFilter(on ? null : p.id)}>
                <span className="ps-nm">{p.name}</span>
                <span className="ps-mt">{p.services.length} serviço{p.services.length > 1 ? "s" : ""} · {nt} tarefa{nt !== 1 ? "s" : ""}</span>
              </button>
            );
          })}
          {filter && <button className="ps-clear" onClick={() => setFilter(null)}>ver todos</button>}
        </div>
      </section>

      <section className="row">
        <div className="rowhead"><h2>Serviços em execução</h2><span className="sub">tudo que estamos fazendo com você</span></div>
        <div className="ps-grid">
          {shown.flatMap((p) => p.services.map((s) => {
            const total = s.tasks.length;
            const done = s.tasks.filter((t) => t.done).length;
            const pct = total ? Math.round((done / total) * 100) : 0;
            const allDone = total > 0 && done === total;
            return (
              <div key={`${p.id}-${s.id}`} className="ps-card">
                <div className="ps-tags">
                  <span className="ps-tag" style={{ "--pc": p.color } as React.CSSProperties}>📁 {p.name}</span>
                  <span className={`ps-pill ${allDone ? "done" : "doing"}`}>{allDone ? "Concluído" : "Em andamento"}</span>
                </div>
                <div className="ps-title">{s.name}</div>
                <div className="ps-prog">
                  <span className="ps-frac">{done} de {total} etapa{total !== 1 ? "s" : ""}</span>
                  <span className="ps-bar"><i style={{ width: `${pct}%` }} /></span>
                </div>
                <div className="ps-tasks">
                  {s.tasks.map((t) => {
                    const st = stOf(t);
                    return (
                      <button key={t.id} type="button" className="ps-row" onClick={() => setOpen({ t, p })}>
                        <span className="ps-dot" style={{ background: SC[st], borderColor: SC[st] }}>{st === "done" ? "✓" : ""}</span>
                        <span className="ps-tn">{t.title}</span>
                        <span className="ps-badge" style={{ color: SC[st] }}>{SL[st]}</span>
                        <span className="ps-chev">›</span>
                      </button>
                    );
                  })}
                </div>
                <Link href={`/meu-espaco/${p.id}`} className="ps-more">Ver detalhes e cronograma →</Link>
              </div>
            );
          }))}
        </div>
      </section>

      {open && (() => {
        const { t, p } = open;
        const st = stOf(t);
        const desc = t.description ? stripImg(t.description) : "";
        return (
          <div className="ps-drawer" onClick={() => setOpen(null)}>
            <div className="ps-panel" onClick={(e) => e.stopPropagation()}>
              <button className="ps-x" onClick={() => setOpen(null)} aria-label="Fechar">✕</button>
              <div className="ps-dtags">
                <span className="ps-badge" style={{ color: SC[st] }}>{SL[st]}</span>
                <span className="ps-dproj" style={{ color: p.color }}>📁 {p.name}</span>
              </div>
              <h3 className="ps-dtitle">{t.title}</h3>
              {(t.startDate || t.dueDate) && (
                <div className="ps-ddate">📅 {t.startDate ? fmtDM(t.startDate) : "?"}{t.dueDate ? ` – ${fmtDM(t.dueDate)}` : ""}</div>
              )}
              {desc && (<><div className="ps-dh">O que será feito</div><div className="ps-ddesc">{desc}</div></>)}
              <div className="ps-dh">O que já foi feito</div>
              {t.updates.length === 0
                ? <div className="ps-dempty">Ainda não há atualizações nesta etapa.</div>
                : (
                  <div className="ps-updates">
                    {t.updates.map((u, i) => (
                      <div key={i} className="ps-up">
                        <div className="ps-uh"><span className="ps-uby">{u.client ? "Você" : "Equipe"}</span><span className="ps-uat">{fmtDM(u.at)}</span></div>
                        <div className="ps-utx">{u.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              {t.awaitingClient && (
                <Link href={`/meu-espaco/${p.id}`} className="ps-daction">Responder no painel do projeto →</Link>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}

const PS_CSS = `
.ps-projs{display:flex;gap:10px;flex-wrap:wrap}
.ps-proj{position:relative;text-align:left;border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:14px;padding:12px 16px 12px 18px;color:var(--ink);cursor:pointer;min-width:200px;transition:border-color .15s,transform .15s}
.ps-proj:hover{transform:translateY(-2px)}
.ps-proj::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:4px;border-radius:3px;background:var(--pc)}
.ps-proj.on{border-color:var(--pc)}
.ps-proj .ps-nm{display:block;font-weight:700;font-size:14px;letter-spacing:-.01em}
.ps-proj .ps-mt{display:block;color:var(--ink3);font-size:12px;margin-top:2px;font-variant-numeric:tabular-nums}
.ps-clear{align-self:center;border:0;background:transparent;color:var(--info);font-weight:700;font-size:13px;cursor:pointer;padding:0 8px}
.ps-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.ps-card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008));border-radius:16px;padding:16px;box-shadow:0 24px 46px -34px rgba(0,0,0,.9)}
.ps-tags{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.ps-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;color:var(--pc);border:1px solid color-mix(in srgb,var(--pc) 45%,transparent)}
.ps-pill{font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px}
.ps-pill.doing{color:var(--warn);background:rgba(245,181,100,.14)}
.ps-pill.done{color:var(--ok);background:rgba(79,209,160,.14)}
.ps-title{font-weight:700;font-size:15px;letter-spacing:-.01em}
.ps-prog{display:flex;align-items:center;gap:10px;margin-top:12px}
.ps-frac{font-size:12px;font-weight:700;color:var(--ink2);white-space:nowrap}
.ps-bar{flex:1;height:7px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden}
.ps-bar>i{display:block;height:100%;border-radius:5px;background:var(--ok)}
.ps-tasks{margin-top:12px;display:flex;flex-direction:column}
.ps-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px dashed var(--line);width:100%;text-align:left;background:transparent;border-left:0;border-right:0;border-bottom:0;color:inherit;cursor:pointer;font:inherit}
.ps-row:first-child{border-top:0}
.ps-row:hover .ps-tn{color:#fff}
.ps-dot{width:17px;height:17px;border-radius:50%;flex:none;display:grid;place-items:center;color:#0A0C14;font-size:9px;font-weight:900;border:2px solid}
.ps-tn{flex:1;min-width:0;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps-badge{font-size:11px;font-weight:700;flex:none}
.ps-chev{color:var(--ink3);font-size:16px;font-weight:700;flex:none}
.ps-more{display:inline-block;margin-top:12px;font-size:12.5px;font-weight:700;color:var(--info);text-decoration:none}
.ps-more:hover{text-decoration:underline}
.ps-drawer{position:fixed;inset:0;background:rgba(6,7,12,.6);backdrop-filter:blur(3px);z-index:80;display:flex;justify-content:flex-end}
.ps-panel{position:relative;width:min(440px,100%);height:100%;overflow:auto;background:#0C0E16;border-left:1px solid var(--line2);padding:24px 22px;box-shadow:-24px 0 60px -24px rgba(0,0,0,.7)}
.ps-x{position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--ink3);cursor:pointer;font-size:14px}
.ps-dtags{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.ps-dproj{font-size:12px;font-weight:700}
.ps-dtitle{margin:0 0 6px;font-size:19px;font-weight:800;letter-spacing:-.01em;color:var(--ink);padding-right:36px}
.ps-ddate{color:var(--ink3);font-size:12.5px;font-variant-numeric:tabular-nums}
.ps-dh{margin:20px 0 8px;font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--ink3)}
.ps-ddesc{font-size:14px;color:var(--ink2);line-height:1.55;white-space:pre-wrap}
.ps-dempty{color:var(--ink3);font-size:13px}
.ps-updates{display:flex;flex-direction:column;gap:12px}
.ps-up{border-left:2px solid var(--line2);padding:0 0 2px 13px;position:relative}
.ps-up::before{content:"";position:absolute;left:-5px;top:4px;width:8px;height:8px;border-radius:50%;background:#6E86FF}
.ps-uh{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700}
.ps-uby{color:var(--ink)}
.ps-uat{color:var(--ink3);font-weight:500;font-variant-numeric:tabular-nums;margin-left:auto}
.ps-utx{font-size:13.5px;color:var(--ink2);margin-top:3px;line-height:1.5;white-space:pre-wrap}
.ps-daction{display:inline-block;margin-top:18px;background:#6E86FF;color:#fff;font-weight:700;font-size:13px;padding:10px 16px;border-radius:10px;text-decoration:none}
`;
