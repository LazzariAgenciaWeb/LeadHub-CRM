"use client";

import { useEffect, useState } from "react";
import type { PanelTask, PanelMat } from "./ClientProjectPanel";
import TaskRespond from "./TaskRespond";

/**
 * Andamento em Gantt (client): tarefas agrupadas por etapa viram barras no tempo,
 * posicionadas pelas datas de início/fim, com linha "HOJE". Clicar numa tarefa
 * abre um modal com descrição, checklist, comentários, anexos e caixa de resposta.
 * Tarefas sem data aparecem na linha com "a combinar" (não somem).
 */

const DAY = 86_400_000;
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const GROUP_COLORS = ["#0EA5E9", "#8B5CF6", "#F97316", "#10B981", "#EC4899", "#6E86FF"];
const KIND_LABEL: Record<string, string> = { DOCUMENTO: "Documento", REUNIAO: "Reunião", APOIO: "Apoio", LINK: "Link", ANEXO: "Anexo" };
const catOf = (kind: string) => (kind === "DOCUMENTO" ? "doc" : kind === "LINK" || kind === "ANEXO" ? "link" : "video");
const fmtDM = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);

const STATUS_LABEL: Record<string, string> = { done: "Concluído", wait: "Aguardando você", late: "Atrasado", exec: "Em execução", todo: "A fazer" };

const IconDoc = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
const IconPlayS = <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8L7 4Z" /></svg>;
const IconLink = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 15 15 9M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5" /></svg>;
const IconExt = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>;
const IconX = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>;
const IconChkS = <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>;

type Span = { s: number; e: number } | null;
const spanOf = (t: PanelTask): Span => {
  const s = ms(t.startDate), e = ms(t.dueDate);
  if (s != null && e != null) return { s: Math.min(s, e), e: Math.max(s, e) };
  if (e != null) return { s: e, e };
  if (s != null) return { s, e: s };
  return null;
};

function statusOf(t: PanelTask, now: number): keyof typeof STATUS_LABEL {
  if (t.done) return "done";
  if (t.awaitingClient) return "wait";
  const e = ms(t.dueDate);
  if (e != null && e < now) return "late";
  const s = ms(t.startDate);
  if (s != null && s <= now) return "exec";
  return "todo";
}

export default function ServiceGantt({ tasks, materials }: { tasks: PanelTask[]; materials: PanelMat[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const now = Date.now();

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  // materiais por tarefa
  const matsByTask = new Map<string, PanelMat[]>();
  for (const m of materials) {
    if (!m.taskId) continue;
    const a = matsByTask.get(m.taskId) ?? [];
    a.push(m); matsByTask.set(m.taskId, a);
  }

  // grupos por etapa, na ordem de aparição
  const order: string[] = [];
  const groups = new Map<string, PanelTask[]>();
  for (const t of tasks) {
    const key = t.stage?.trim() || "";
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(t);
  }

  // eixo de tempo
  const spans = tasks.map(spanOf).filter((x): x is { s: number; e: number } => !!x);
  const hasDates = spans.length > 0;
  let minT = 0, maxT = 0, range = 1;
  if (hasDates) {
    minT = Math.min(...spans.map((x) => x.s), now);
    maxT = Math.max(...spans.map((x) => x.e), now);
    if (maxT - minT < 7 * DAY) { const mid = (minT + maxT) / 2; minT = mid - 7 * DAY; maxT = mid + 7 * DAY; }
    const pad = (maxT - minT) * 0.03;
    minT -= pad; maxT += pad;
    range = maxT - minT;
  }
  const frac = (t: number) => (t - minT) / range;

  const months: { label: string; leftPct: number; widthPct: number }[] = [];
  if (hasDates) {
    const start = new Date(minT); start.setDate(1); start.setHours(0, 0, 0, 0);
    let cur = start.getTime();
    while (cur < maxT) {
      const nx = new Date(cur); nx.setMonth(nx.getMonth() + 1);
      const segS = Math.max(cur, minT), segE = Math.min(nx.getTime(), maxT);
      months.push({ label: MONTHS[new Date(cur).getMonth()], leftPct: frac(segS) * 100, widthPct: ((segE - segS) / range) * 100 });
      cur = nx.getTime();
    }
  }

  const openTask = openId ? tasks.find((t) => t.id === openId) ?? null : null;

  function Bar({ t }: { t: PanelTask }) {
    const sp = spanOf(t);
    if (!sp) return <span className="gnodate">a combinar</span>;
    const st = statusOf(t, now);
    const left = frac(sp.s) * 100;
    const width = Math.max(((sp.e - sp.s) / range) * 100, 1.4);
    return <div className={`gbar ${st}`} style={{ left: `${left}%`, width: `${width}%` }}>{st === "exec" && <i />}</div>;
  }

  function MatRow({ m }: { m: PanelMat }) {
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

  return (
    <>
      <div className="glegend">
        <span><i style={{ background: "#10B981" }} /> Concluído</span>
        <span><i style={{ background: "#6E86FF" }} /> Em execução</span>
        <span><i style={{ background: "#F5B564" }} /> Aguardando você</span>
        <span><i style={{ background: "#F87171" }} /> Atrasado</span>
        <span><i style={{ background: "#4B5563" }} /> A fazer</span>
      </div>

      <div className="gwrap">
        <div className="ginner">
          {hasDates && (
            <div className="gtoday" style={{ left: `calc(230px + (100% - 230px) * ${frac(now)})` }}><span>HOJE</span></div>
          )}
          <div className="ghead">
            <div className="gcolh">Etapa / tarefa</div>
            <div className="gtime">
              {months.map((m, i) => (
                <div key={i} className="gmonth" style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}>{m.label}</div>
              ))}
            </div>
          </div>

          {order.map((key, gi) => {
            const ts = groups.get(key)!;
            const total = ts.length;
            const done = ts.filter((t) => t.done).length;
            const overdue = ts.filter((t) => !t.done && t.dueDate && new Date(t.dueDate).getTime() < now).length;
            const tag = done === total ? "concluída" : overdue > 0 ? `${overdue} em atraso` : `${done}/${total}`;
            const color = GROUP_COLORS[gi % GROUP_COLORS.length];
            return (
              <div key={key || "__none__"}>
                <div className="ggrp">
                  <span className="pb" style={{ background: color }}>{String(gi + 1).padStart(2, "0")}</span>
                  <span className="gt">{key || "Atividades"}</span>
                  <span className="tagm">{tag}</span>
                </div>
                {ts.map((t) => {
                  const mats = matsByTask.get(t.id) ?? [];
                  const hasVid = mats.some((m) => catOf(m.kind) === "video");
                  const hasDoc = mats.some((m) => catOf(m.kind) === "doc");
                  const sp = spanOf(t);
                  const dstr = sp
                    ? (t.startDate && t.dueDate ? `${fmtDM(new Date(t.startDate))}–${fmtDM(new Date(t.dueDate))}` : fmtDM(new Date((t.dueDate ?? t.startDate)!)))
                    : "sem data";
                  return (
                    <div key={t.id} className="grow" onClick={() => setOpenId(t.id)}>
                      <div className="gnm">
                        <div className="tn">{hasVid ? "🎥 " : hasDoc ? "📄 " : ""}{t.title}</div>
                        <div className="td">{statusOf(t, now) === "late" ? `${dstr} · atrasado` : statusOf(t, now) === "wait" ? "aguardando você" : dstr}</div>
                      </div>
                      <div className="gtk"><Bar t={t} /></div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {openTask && (() => {
        const st = statusOf(openTask, now);
        const gi = order.indexOf(openTask.stage?.trim() || "");
        const color = GROUP_COLORS[(gi < 0 ? 0 : gi) % GROUP_COLORS.length];
        const label = openTask.stage?.trim() || "Atividade";
        const mats = matsByTask.get(openTask.id) ?? [];
        return (
          <div className="gov" onClick={() => setOpenId(null)}>
            <div className="gmodal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <button className="gx" aria-label="Fechar" onClick={() => setOpenId(null)}>{IconX}</button>
              <div className="gmh">
                <div className="gmchips">
                  <span className="gmph" style={{ background: color }}>{String((gi < 0 ? 0 : gi) + 1).padStart(2, "0")} · {label}</span>
                  <span className={`gmpill ${st}`}>{STATUS_LABEL[st]}</span>
                </div>
                <h3 className="gmt">{openTask.title}</h3>
              </div>
              <div className="gmdt">
                <div><div className="k">Início</div><div className="v">{openTask.startDate ? fmtDM(new Date(openTask.startDate)) : "—"}</div></div>
                <div><div className="k">Fim</div><div className="v">{openTask.dueDate ? fmtDM(new Date(openTask.dueDate)) : "—"}</div></div>
              </div>
              {openTask.description && (
                <div className="gms"><h4>Descrição</h4><p className="desc">{openTask.description}</p></div>
              )}
              {openTask.checklist.length > 0 && (
                <div className="gms">
                  <h4>Checklist</h4>
                  <ul className="tkck">
                    {openTask.checklist.map((c, i) => (
                      <li key={i} className={c.done ? "on" : ""}>
                        <span className="ck">{c.done ? IconChkS : ""}</span>
                        <span className="ckt">{c.text}</span>
                        {c.done && c.doneAt && <span className="ckd">{new Date(c.doneAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {openTask.comments.length > 0 && (
                <div className="gms">
                  <h4>Atualizações</h4>
                  <ul className="tkupd">
                    {openTask.comments.map((c, i) => (
                      <li key={i} className={c.by === "client" ? "byclient" : ""}>
                        <span className="ud">{new Date(c.at).toLocaleDateString("pt-BR")}</span>
                        <span className="ut">{c.by === "client" && <b className="uby">Você:</b>} {c.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {mats.length > 0 && (
                <div className="gms"><h4>Anexos</h4><div className="tkmats">{mats.map((m) => <MatRow key={m.id} m={m} />)}</div></div>
              )}
              {openTask.awaitingClient && (
                <div className="gms"><h4>Aguardando você</h4><TaskRespond taskId={openTask.id} /></div>
              )}
              <div className="gmfoot">
                {openTask.updatedAt && <div className="tkupat">Atualizado em {new Date(openTask.updatedAt).toLocaleDateString("pt-BR")}</div>}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
