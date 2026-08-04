"use client";

import { useState } from "react";
import Link from "next/link";

type Update = { text: string; at: string; client: boolean };
type Task = { id: string; title: string; description: string | null; done: boolean; startDate: string | null; dueDate: string | null; awaitingClient: boolean; updates: Update[] };
type Service = { id: string; name: string; tasks: Task[] };
type Project = { id: string; name: string; color: string; status: string; services: Service[] };

const SC: Record<string, string> = { done: "#4FD1A0", exec: "#7AA0FF", wait: "#F5B564", late: "#F87171", todo: "#5A6473" };
const SL: Record<string, string> = { done: "Concluído", exec: "Em execução", wait: "Aguardando você", late: "Atrasado", todo: "A fazer" };
// Selo de status do projeto (mesma nomenclatura do rail de pôsteres na home).
const PST: Record<string, { label: string; cls: string }> = {
  PLANEJAMENTO:       { label: "Planejamento",    cls: "info" },
  EM_ANDAMENTO:       { label: "Em andamento",    cls: "info" },
  AGUARDANDO_CLIENTE: { label: "Aguardando você", cls: "warn" },
  PAUSADO:            { label: "Pausado",         cls: "muted" },
  ENTREGUE:           { label: "Concluído",       cls: "ok" },
};
const fmtDM = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const stripImg = (s: string) => s.replace(/\[\[img:[^\]]+\]\]/g, "").trim();

// Seus projetos (filtro) + Serviços em execução com as tarefas visíveis. Clicar
// numa tarefa abre um painel com o descritivo e as atualizações ("o que já foi
// feito"). Para o cronograma completo, o card leva ao painel do projeto.
export default function ProjetosServicos({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState<{ t: Task; p: Project } | null>(null);
  const now = Date.now();
  const stOf = (t: Task): string =>
    t.done ? "done"
    : t.awaitingClient ? "wait"
    : (t.dueDate && new Date(t.dueDate).getTime() < now) ? "late"
    : (t.startDate && new Date(t.startDate).getTime() <= now) ? "exec"
    : "todo";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />

      <section className="row">
        <div className="rowhead"><h2>Seus projetos</h2><span className="sub">{projects.length > 1 ? "toque num projeto pra abrir" : "toque pra abrir e ver os materiais"}</span></div>
        <div className="ps-projs">
          {projects.map((p) => {
            const nt = p.services.reduce((a, s) => a + s.tasks.length, 0);
            const badge = PST[p.status] ?? { label: p.status, cls: "muted" };
            const cta = p.status === "ENTREGUE" ? "Ver materiais →" : "Abrir projeto →";
            const meta = p.services.length || nt
              ? `${p.services.length} serviço${p.services.length !== 1 ? "s" : ""} · ${nt} tarefa${nt !== 1 ? "s" : ""}`
              : "materiais e entregas";
            return (
              <Link key={p.id} href={`/meu-espaco/${p.id}`} className="ps-proj" style={{ "--pc": p.color } as React.CSSProperties}>
                <span className="ps-nm">{p.name}</span>
                <div className="ps-meta">
                  <span className={`ps-st ${badge.cls}`}>{badge.label}</span>
                  <span className="ps-mt">{meta}</span>
                </div>
                <span className="ps-open">{cta}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="row">
        <div className="rowhead"><h2>Serviços em execução</h2><span className="sub">tudo que estamos fazendo com você</span></div>
        {projects.every((p) => p.services.length === 0) ? (
          <div className="ps-empty">Nada em execução visível por aqui ainda. Assim que liberarmos algo pra você acompanhar, aparece aqui.</div>
        ) : (
        <div className="ps-grid">
          {projects.flatMap((p) => p.services.map((s) => {
            const total = s.tasks.length;
            const done = s.tasks.filter((t) => t.done).length;
            const pct = total ? Math.round((done / total) * 100) : 0;
            const allDone = total > 0 && done === total;
            // Mostra no máximo 5: não concluídas primeiro (prazo mais próximo),
            // depois as atualizadas mais recentemente. O card leva ao painel completo.
            const lastAt = (t: Task) => (t.updates.length ? Math.max(...t.updates.map((u) => new Date(u.at).getTime())) : 0);
            const sorted = [...s.tasks].sort((a, b) => {
              if (a.done !== b.done) return a.done ? 1 : -1;
              const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
              const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
              if (ad !== bd) return ad - bd;
              return lastAt(b) - lastAt(a);
            });
            const visibleTasks = sorted.slice(0, 5);
            const moreCount = total - visibleTasks.length;
            // Abre o painel do projeto já filtrado neste serviço (grupos "Outras
            // tarefas" não têm serviceStep real, então abrem a visão completa).
            const svcHref = s.id.startsWith("loose:") ? `/meu-espaco/${p.id}` : `/meu-espaco/${p.id}?servico=${s.id}`;
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
                <div className="ps-hint">👆 toque numa etapa pra ver o descritivo e os anexos</div>
                <div className="ps-tasks">
                  {visibleTasks.map((t) => {
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
                {moreCount > 0 && (
                  <Link href={svcHref} className="ps-mtasks">+{moreCount} etapa{moreCount > 1 ? "s" : ""} — ver todas</Link>
                )}
                <Link href={svcHref} className="ps-more">Ver detalhes e cronograma →</Link>
              </div>
            );
          }))}
        </div>
        )}
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
.ps-proj{position:relative;display:flex;flex-direction:column;gap:8px;text-align:left;text-decoration:none;border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:14px;padding:13px 16px 13px 18px;color:var(--ink);cursor:pointer;min-width:230px;transition:border-color .15s,transform .15s,box-shadow .15s}
.ps-proj:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--pc) 55%,transparent);box-shadow:0 24px 44px -32px rgba(0,0,0,.9)}
.ps-proj::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:4px;border-radius:3px;background:var(--pc)}
.ps-proj .ps-nm{display:block;font-weight:700;font-size:14px;letter-spacing:-.01em}
.ps-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ps-st{font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:99px;white-space:nowrap}
.ps-st.ok{color:var(--ok);background:rgba(79,209,160,.12)}
.ps-st.info{color:#B6C4FF;background:rgba(110,134,255,.14)}
.ps-st.warn{color:var(--warn);background:rgba(245,181,100,.14)}
.ps-st.muted{color:var(--ink3);background:rgba(255,255,255,.06)}
.ps-proj .ps-mt{color:var(--ink3);font-size:12px;font-variant-numeric:tabular-nums}
.ps-open{font-size:12.5px;font-weight:700;color:#AFC0FF}
.ps-proj:hover .ps-open{color:#C9D4FF}
.ps-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:14px}
.ps-empty{border:1px dashed var(--line2);border-radius:14px;padding:22px;color:var(--ink3);font-size:13.5px;text-align:center}
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
.ps-hint{margin-top:11px;font-size:11px;color:var(--ink3);display:flex;align-items:center;gap:5px}
.ps-tasks{margin-top:6px;display:flex;flex-direction:column;gap:2px}
.ps-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;width:100%;text-align:left;background:rgba(255,255,255,.02);border:1px solid transparent;color:inherit;cursor:pointer;font:inherit;transition:background .13s,border-color .13s}
.ps-row:hover{background:rgba(110,134,255,.1);border-color:rgba(110,134,255,.28)}
.ps-row:hover .ps-tn{color:#fff}
.ps-dot{width:17px;height:17px;border-radius:50%;flex:none;display:grid;place-items:center;color:#0A0C14;font-size:9px;font-weight:900;border:2px solid}
.ps-tn{flex:1;min-width:0;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps-badge{font-size:11px;font-weight:700;flex:none}
.ps-chev{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:var(--ink3);font-size:15px;font-weight:800;flex:none;background:rgba(255,255,255,.06);transition:background .13s,color .13s}
.ps-row:hover .ps-chev{background:rgba(110,134,255,.28);color:#C9D4FF}
.ps-mtasks{display:block;margin-top:8px;font-size:12px;font-weight:600;color:var(--ink3);text-decoration:none;text-align:center;padding:6px;border-radius:9px;border:1px dashed var(--line2);transition:color .15s,border-color .15s}
.ps-mtasks:hover{color:#C9D4FF;border-color:rgba(110,134,255,.4)}
.ps-more{display:inline-flex;align-items:center;gap:7px;margin-top:14px;font-size:13px;font-weight:700;color:#C9D4FF;background:rgba(110,134,255,.14);border:1px solid rgba(110,134,255,.34);padding:9px 15px;border-radius:11px;text-decoration:none;transition:background .15s,border-color .15s}
.ps-more:hover{background:rgba(110,134,255,.24);border-color:rgba(110,134,255,.6)}
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
/* --- Responsivo mobile (só a home) --- */
@media (max-width:640px){
  .ps-projs{gap:8px}
  .ps-proj{min-width:0;flex:1 1 100%;padding:11px 14px 11px 16px}
  .ps-card{padding:14px}
  .ps-badge{font-size:10.5px}
  .ps-panel{padding:20px 16px}
  .ps-dtitle{font-size:18px}
}
`;
