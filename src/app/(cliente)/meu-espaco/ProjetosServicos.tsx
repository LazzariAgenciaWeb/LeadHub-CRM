"use client";

import { useState } from "react";
import Link from "next/link";

type Task = { id: string; title: string; done: boolean; startDate: string | null; dueDate: string | null; awaitingClient: boolean };
type Service = { id: string; name: string; tasks: Task[] };
type Project = { id: string; name: string; color: string; services: Service[] };

const SC: Record<string, string> = { done: "#4FD1A0", exec: "#7AA0FF", wait: "#F5B564", late: "#F87171", todo: "#5A6473" };
const SL: Record<string, string> = { done: "Concluído", exec: "Em execução", wait: "Aguardando você", late: "Atrasado", todo: "A fazer" };

// Seus projetos (filtro) + Serviços em execução com as tarefas visíveis — a
// "transparência" do mockup na home do cliente. Clicar num serviço leva ao painel
// completo do projeto (com Lista/Cronograma e o detalhe "o que foi feito").
export default function ProjetosServicos({ projects }: { projects: Project[] }) {
  const [filter, setFilter] = useState<string | null>(null);
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

      {projects.length > 1 && (
        <section className="row">
          <div className="rowhead"><h2>Seus projetos</h2><span className="sub">clique pra ver só um projeto</span></div>
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
      )}

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
                      <div key={t.id} className="ps-row">
                        <span className="ps-dot" style={{ background: SC[st], borderColor: SC[st] }}>{st === "done" ? "✓" : ""}</span>
                        <span className="ps-tn">{t.title}</span>
                        <span className="ps-badge" style={{ color: SC[st] }}>{SL[st]}</span>
                      </div>
                    );
                  })}
                </div>
                <Link href={`/meu-espaco/${p.id}`} className="ps-more">Ver detalhes e cronograma →</Link>
              </div>
            );
          }))}
        </div>
      </section>
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
.ps-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px dashed var(--line)}
.ps-row:first-child{border-top:0}
.ps-dot{width:17px;height:17px;border-radius:50%;flex:none;display:grid;place-items:center;color:#0A0C14;font-size:9px;font-weight:900;border:2px solid}
.ps-tn{flex:1;min-width:0;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps-badge{font-size:11px;font-weight:700;flex:none}
.ps-more{display:inline-block;margin-top:12px;font-size:12.5px;font-weight:700;color:var(--info);text-decoration:none}
.ps-more:hover{text-decoration:underline}
`;
