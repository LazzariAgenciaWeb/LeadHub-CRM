"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SaleContractEditor from "@/components/sale-contract/SaleContractEditor";
import { uploadFile } from "@/components/attachments/upload";

/**
 * Central do Cliente: tudo o que aconteceu com o cliente, da negociação à
 * entrega — linha do tempo, contratos (aceite/faturamento), documentos e
 * e-mails. Dados em /api/companies/[id]/central/*.
 */

export type CentralView = "timeline" | "contratos" | "documentos" | "emails";

interface Contract {
  id: string; title: string; valueCents: number; kind: string; closedAt: string; sellerName: string | null;
  contractStatus: string; contractStatusLabel: string; billingConfirmed: boolean;
  acceptedAt: string | null; productionStatus: string; productionBlocker: string | null;
  soldServices: { name: string; level?: string | null; recurring: boolean; startAt?: string | null; durationMonths?: number | null }[];
  lead: null | {
    id: string; name: string | null; phone: string; email: string | null; pipeline: string | null;
    pipelineStage: string | null; value: number | null; createdAt: string; wonAt: string | null;
    history: { id: string; at: string; kind: string; text: string; by: string | null }[];
  };
  proposals: { id: string; title: string; url: string | null; at: string }[];
}
interface Doc {
  id: string; type: string; title: string; url: string | null; fileUrl: string | null; fileName: string | null;
  notes: string | null; sale: { id: string; title: string } | null; documentDate: string | null;
  createdByName: string | null; createdAt: string;
}
interface CentralData {
  canEditContracts: boolean;
  links: { driveFolderUrl: string | null; clickupListUrl: string | null };
  contracts: Contract[];
  documents: Doc[];
}
interface TimelineEvent { at: string; type: string; title: string; summary?: string | null; link?: string | null; by?: string | null }
interface EmailRow {
  id: string; direction: "IN" | "OUT"; fromEmail: string; fromName: string | null; toEmail: string; subject: string;
  snippet: string; aiSummary: string | null; sentAt: string; clientCompanyId: string | null; clientLinkSource: string | null;
  clientMark: string | null; suspicious: boolean; attachments: number; clientCompany: { id: string; name: string } | null;
}

const TYPE_META: Record<string, { label: string; icon: string; cls: string }> = {
  LEAD: { label: "Lead", icon: "🎯", cls: "text-blue-300" },
  PROPOSTA: { label: "Proposta", icon: "📝", cls: "text-violet-300" },
  VENDA: { label: "Venda", icon: "🏆", cls: "text-green-400" },
  CONTRATO: { label: "Contrato", icon: "✍️", cls: "text-emerald-300" },
  FATURAMENTO: { label: "Faturamento", icon: "💳", cls: "text-amber-300" },
  COBRANCA: { label: "Cobrança", icon: "🧾", cls: "text-amber-200" },
  PROJETO: { label: "Projeto", icon: "🧩", cls: "text-indigo-300" },
  CHAMADO: { label: "Chamado", icon: "🎫", cls: "text-orange-300" },
  WHATSAPP: { label: "WhatsApp", icon: "💬", cls: "text-green-300" },
  EMAIL: { label: "E-mail", icon: "✉️", cls: "text-sky-300" },
  DOCUMENTO: { label: "Documento", icon: "📎", cls: "text-slate-300" },
  NOTA: { label: "Anotação", icon: "🗒", cls: "text-slate-300" },
};
const DOC_TYPES = ["PROPOSTA", "CONTRATO", "TERMO", "ADITIVO", "BRIEFING", "ENTREGA", "OUTRO"];
const DOC_LABEL: Record<string, string> = {
  PROPOSTA: "Proposta", CONTRATO: "Contrato", TERMO: "Termo", ADITIVO: "Aditivo", BRIEFING: "Briefing", ENTREGA: "Entrega", OUTRO: "Outro",
};

const input = "bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500";
const btnGhost = "px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#1e2d45] text-slate-400 hover:text-white disabled:opacity-40";
const btnPrimary = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Href({ href, children, className = "text-indigo-400 hover:underline" }: { href: string; children: React.ReactNode; className?: string }) {
  return /^https?:\/\//i.test(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
    : <Link href={href} className={className}>{children}</Link>;
}

export default function ClientCentral({ companyId, view }: { companyId: string; view: CentralView }) {
  const [data, setData] = useState<CentralData | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/companies/${companyId}/central`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? "Não foi possível carregar."); return; }
    setData(j);
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="p-5 text-slate-500 text-sm">{err || "Carregando…"}</div>;

  return (
    <div className="p-5 flex flex-col gap-4">
      <FixedLinks companyId={companyId} links={data.links} onSaved={load} />
      {view === "timeline" && <Timeline companyId={companyId} />}
      {view === "contratos" && <Contracts data={data} onChanged={load} />}
      {view === "documentos" && <Documents companyId={companyId} data={data} onChanged={load} />}
      {view === "emails" && <Emails companyId={companyId} contracts={data.contracts} canMark={data.canEditContracts} onChanged={load} />}
    </div>
  );
}

// ─── Drive / ClickUp ─────────────────────────────────────────────────────────
function FixedLinks({ companyId, links, onSaved }: { companyId: string; links: CentralData["links"]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [drive, setDrive] = useState(links.driveFolderUrl ?? "");
  const [clickup, setClickup] = useState(links.clickupListUrl ?? "");
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    const res = await fetch(`/api/companies/${companyId}/central`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driveFolderUrl: drive, clickupListUrl: clickup }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? "Não foi possível salvar."); return; }
    setEditing(false);
    onSaved();
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-end gap-2 border border-[#1e2d45] rounded-lg p-3">
        <label className="flex flex-col gap-1 text-[10px] text-slate-500 flex-1 min-w-[220px]">Pasta do Google Drive
          <input className={input} placeholder="https://drive.google.com/…" value={drive} onChange={(e) => setDrive(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-slate-500 flex-1 min-w-[220px]">Lista do ClickUp
          <input className={input} placeholder="https://app.clickup.com/…" value={clickup} onChange={(e) => setClickup(e.target.value)} />
        </label>
        <button className={btnPrimary} onClick={save}>Salvar</button>
        <button className={btnGhost} onClick={() => setEditing(false)}>Cancelar</button>
        {err && <div className="w-full text-[11px] text-red-300">{err}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {links.driveFolderUrl
        ? <Href href={links.driveFolderUrl} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[#1e2d45] text-slate-200 hover:border-indigo-500/50">📁 Pasta no Drive ↗</Href>
        : <span className="px-3 py-1.5 rounded-lg border border-dashed border-[#1e2d45] text-slate-600">📁 Sem pasta no Drive</span>}
      {links.clickupListUrl
        ? <Href href={links.clickupListUrl} className="px-3 py-1.5 rounded-lg bg-white/5 border border-[#1e2d45] text-slate-200 hover:border-indigo-500/50">✅ Lista no ClickUp ↗</Href>
        : <span className="px-3 py-1.5 rounded-lg border border-dashed border-[#1e2d45] text-slate-600">✅ Sem lista no ClickUp</span>}
      <button className="text-slate-500 hover:text-white text-[11px]" onClick={() => setEditing(true)}>editar links</button>
    </div>
  );
}

// ─── Linha do tempo ──────────────────────────────────────────────────────────
function Timeline({ companyId }: { companyId: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [filter, setFilter] = useState<string[]>([]);

  useEffect(() => {
    setEvents(null);
    const qs = filter.length ? `?types=${filter.join(",")}` : "";
    fetch(`/api/companies/${companyId}/central/timeline${qs}`)
      .then((r) => r.json()).then((j) => setEvents(j.events ?? [])).catch(() => setEvents([]));
  }, [companyId, filter]);

  const toggle = (t: string) => setFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button onClick={() => setFilter([])} className={`px-2.5 py-1 rounded-full text-[11px] border ${filter.length === 0 ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200" : "border-[#1e2d45] text-slate-500"}`}>Tudo</button>
        {Object.entries(TYPE_META).map(([k, m]) => (
          <button key={k} onClick={() => toggle(k)} className={`px-2.5 py-1 rounded-full text-[11px] border ${filter.includes(k) ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200" : "border-[#1e2d45] text-slate-500 hover:text-slate-300"}`}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>
      {events === null ? <div className="text-slate-500 text-sm">Carregando…</div> : events.length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm">Nada registrado{filter.length ? " com esse filtro" : ""} ainda.</div>
      ) : (
        <ol className="relative border-l border-[#1e2d45] ml-2">
          {events.map((e, i) => {
            const m = TYPE_META[e.type] ?? { label: e.type, icon: "•", cls: "text-slate-300" };
            return (
              <li key={i} className="ml-4 pb-4">
                <span className="absolute -left-[9px] w-[18px] h-[18px] rounded-full bg-[#0f1623] border border-[#1e2d45] flex items-center justify-center text-[10px]">{m.icon}</span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-slate-500 text-[10px] tabular-nums">{fmtDateTime(e.at)}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${m.cls}`}>{m.label}</span>
                  {e.by && <span className="text-slate-600 text-[10px]">· {e.by}</span>}
                </div>
                <div className="text-slate-200 text-[13px]">
                  {e.link ? <Href href={e.link} className="hover:text-indigo-300">{e.title}</Href> : e.title}
                </div>
                {e.summary && <div className="text-slate-500 text-[11px] mt-0.5 whitespace-pre-line line-clamp-3">{e.summary}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ─── Contratos + Negociação ──────────────────────────────────────────────────
function Contracts({ data, onChanged }: { data: CentralData; onChanged: () => void }) {
  if (data.contracts.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="text-3xl mb-2">✍️</div>
        <div className="text-slate-500 text-sm">Nenhuma venda vinculada a este cliente</div>
        <div className="text-slate-600 text-xs mt-1">
          Ganhe a oportunidade no CRM e vincule a venda ao cliente na <Link href="/financeiro/esteira" className="text-indigo-400 hover:underline">esteira</Link>.
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {data.contracts.map((c) => (
        <div key={c.id} className="border border-[#1e2d45] rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-white/[0.02] border-b border-[#1e2d45] flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-white font-semibold text-sm">{c.title}</div>
              <div className="text-slate-500 text-[11px]">
                {brl(c.valueCents)} · {c.kind === "RECORRENTE" ? "recorrente" : "pontual"} · fechada em {fmtDate(c.closedAt)}{c.sellerName ? ` · ${c.sellerName}` : ""}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
            <Negotiation c={c} />
            <div>
              <h4 className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide mb-2">Contrato & faturamento</h4>
              {data.canEditContracts
                ? <SaleContractEditor saleId={c.id} onChanged={onChanged} compact />
                : <SaleContractEditor saleId={c.id} canEdit={false} compact />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Negotiation({ c }: { c: Contract }) {
  const [showAll, setShowAll] = useState(false);
  const history = c.lead?.history ?? [];
  return (
    <div>
      <h4 className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide mb-2">Negociação</h4>
      {c.lead ? (
        <div className="text-[12px] text-slate-300 flex flex-col gap-0.5 mb-3">
          <span>Origem: <Link href={`/crm/oportunidades?lead=${c.lead.id}`} className="text-indigo-400 hover:underline">{c.lead.name ?? c.lead.phone}</Link>
            <span className="text-slate-600"> · lead desde {fmtDate(c.lead.createdAt)}</span></span>
          <span className="text-slate-400">Fechada em {fmtDate(c.lead.wonAt ?? c.closedAt)} por {brl(c.valueCents)}</span>
        </div>
      ) : <p className="text-[11px] text-slate-500 mb-3">Venda lançada à mão (sem lead de origem).</p>}

      <div className="mb-3">
        <div className="text-[11px] text-slate-500 mb-1">Proposta</div>
        {c.proposals.length === 0
          ? <p className="text-[11px] text-slate-600">Nenhuma proposta anexada — anexe em Documentos, ligada a esta venda.</p>
          : c.proposals.map((p) => (
              <div key={p.id} className="text-[12px]">
                📝 {p.url ? <Href href={p.url}>{p.title}</Href> : p.title} <span className="text-slate-600">· {fmtDate(p.at)}</span>
              </div>
            ))}
      </div>

      <div className="mb-3">
        <div className="text-[11px] text-slate-500 mb-1">Serviços vendidos</div>
        {c.soldServices.length === 0
          ? <p className="text-[11px] text-slate-600">Liste ao lado, em “Serviços vendidos”.</p>
          : <ul className="text-[12px] text-slate-300 list-disc ml-4">
              {c.soldServices.map((s, i) => (
                <li key={i}>{s.name}{s.level ? ` (${s.level})` : ""} · {s.recurring ? "recorrente" : "pontual"}{s.startAt ? ` · início ${s.startAt.split("-").reverse().join("/")}` : ""}{s.durationMonths ? ` · ${s.durationMonths} meses` : ""}</li>
              ))}
            </ul>}
      </div>

      {c.lead && (
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Histórico do lead</div>
          {history.length === 0 ? <p className="text-[11px] text-slate-600">Sem histórico registrado.</p> : (
            <ul className="flex flex-col gap-1">
              {(showAll ? history : history.slice(0, 6)).map((h) => (
                <li key={h.id} className="text-[11px]">
                  <span className="text-slate-600 tabular-nums">{fmtDate(h.at)}</span>{" "}
                  <span className="text-slate-300 whitespace-pre-line">{h.text}</span>
                  {h.by && <span className="text-slate-600"> — {h.by}</span>}
                </li>
              ))}
            </ul>
          )}
          {history.length > 6 && (
            <button className="text-[11px] text-indigo-400 mt-1" onClick={() => setShowAll(!showAll)}>{showAll ? "mostrar menos" : `ver tudo (${history.length})`}</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Documentos ──────────────────────────────────────────────────────────────
function Documents({ companyId, data, onChanged }: { companyId: string; data: CentralData; onChanged: () => void }) {
  const [form, setForm] = useState({ type: "PROPOSTA", title: "", url: "", saleId: "", date: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  async function add() {
    setBusy(true); setErr("");
    try {
      let storageObjectId: string | null = null;
      if (file) {
        const saved = await uploadFile(file, { libraryCompanyId: companyId });
        storageObjectId = saved.id;
      }
      const res = await fetch(`/api/companies/${companyId}/central/documentos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type, title: form.title || file?.name, url: form.url || null, storageObjectId,
          saleId: form.saleId || null, documentDate: form.date ? new Date(`${form.date}T12:00:00`).toISOString() : null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? "Não foi possível anexar."); return; }
      setForm({ type: "PROPOSTA", title: "", url: "", saleId: "", date: "" });
      setFile(null);
      setOpen(false);
      onChanged();
    } catch (e) {
      setErr((e as Error).message || "Falha no envio do arquivo.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: Doc) {
    if (!confirm(`Remover "${d.title}" dos documentos do cliente?`)) return;
    const res = await fetch(`/api/companies/${companyId}/central/documentos?docId=${d.id}`, { method: "DELETE" });
    if (res.ok) onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-white font-bold text-sm">📎 Documentos ({data.documents.length})</h3>
        {!open && <button className={btnPrimary} onClick={() => setOpen(true)}>+ Anexar documento</button>}
      </div>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 border border-[#1e2d45] rounded-lg p-3 mb-4">
          <label className="flex flex-col gap-1 text-[10px] text-slate-500">Tipo
            <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-slate-500">Título
            <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ex.: Proposta site institucional" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-slate-500">Data do documento
            <input type="date" className={input} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-slate-500 lg:col-span-2">Link (Drive, Autentique…)
            <input className={input} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-slate-500">ou arquivo
            <input type="file" className="text-[11px] text-slate-400" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-slate-500 lg:col-span-2">Venda / contrato (opcional)
            <select className={input} value={form.saleId} onChange={(e) => setForm({ ...form, saleId: e.target.value })}>
              <option value="">—</option>
              {data.contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button disabled={busy || (!form.url && !file)} className={btnPrimary} onClick={add}>{busy ? "Enviando…" : "Anexar"}</button>
            <button className={btnGhost} onClick={() => setOpen(false)}>Cancelar</button>
          </div>
          {err && <div className="text-[11px] text-red-300 sm:col-span-2 lg:col-span-3">{err}</div>}
        </div>
      )}
      {data.documents.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">Nenhum documento anexado.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e2d45]">
                {["Documento", "Tipo", "Data", "Venda", "Anexado por", ""].map((h) => (
                  <th key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left pb-2 px-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.documents.map((d) => {
                const href = d.url ?? d.fileUrl;
                return (
                  <tr key={d.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                    <td className="py-2 px-2 text-[13px]">
                      {href ? <Href href={href} className="text-white hover:text-indigo-300 font-semibold">{d.title}</Href> : <span className="text-white">{d.title}</span>}
                      {d.fileName && <div className="text-slate-600 text-[10px]">{d.fileName}</div>}
                    </td>
                    <td className="py-2 px-2 text-xs text-slate-400">{DOC_LABEL[d.type] ?? d.type}</td>
                    <td className="py-2 px-2 text-xs text-slate-400">{fmtDate(d.documentDate ?? d.createdAt)}</td>
                    <td className="py-2 px-2 text-xs text-slate-400">{d.sale?.title ?? "—"}</td>
                    <td className="py-2 px-2 text-xs text-slate-500">{d.createdByName ?? "—"}</td>
                    <td className="py-2 px-2 text-right"><button className="text-slate-600 hover:text-red-300 text-xs" onClick={() => remove(d)}>remover</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── E-mails ─────────────────────────────────────────────────────────────────
function Emails({ companyId, contracts, canMark, onChanged }: { companyId: string; contracts: Contract[]; canMark: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<EmailRow[] | null>(null);
  const [dir, setDir] = useState<"" | "IN" | "OUT">("");
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [found, setFound] = useState<EmailRow[] | null>(null);
  const [msg, setMsg] = useState("");
  const [marking, setMarking] = useState<{ id: string; mark: "ACEITE" | "FATURAMENTO"; saleId: string; who: string } | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (dir) p.set("dir", dir);
    if (q.trim()) p.set("q", q.trim());
    const j = await fetch(`/api/companies/${companyId}/central/emails?${p}`).then((r) => r.json()).catch(() => ({}));
    setRows(j.emails ?? []);
  }, [companyId, dir, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function post(body: Record<string, unknown>, done?: string) {
    setMsg("");
    const res = await fetch(`/api/companies/${companyId}/central/emails`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(j.error ?? "Não foi possível."); return null; }
    if (done) setMsg(done);
    await load();
    return j;
  }

  async function search() {
    if (!searchQ.trim()) return;
    const j = await fetch(`/api/companies/${companyId}/central/emails?mode=search&q=${encodeURIComponent(searchQ.trim())}`).then((r) => r.json());
    setFound(j.emails ?? []);
  }

  const markLabel = (m: string | null) => m === "ACEITE" ? "✍️ aceite" : m === "FATURAMENTO" ? "💳 faturamento" : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="text-white font-bold text-sm mr-2">✉️ E-mails {rows ? `(${rows.length >= 150 ? "150+" : rows.length})` : ""}</h3>
        {(["", "IN", "OUT"] as const).map((d) => (
          <button key={d || "all"} onClick={() => setDir(d)} className={`px-2.5 py-1 rounded-full text-[11px] border ${dir === d ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200" : "border-[#1e2d45] text-slate-500"}`}>
            {d === "" ? "Todos" : d === "IN" ? "Recebidos" : "Enviados"}
          </button>
        ))}
        <input className={`${input} w-48`} placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={btnGhost} onClick={async () => {
          const j = await post({ action: "backfill" });
          if (j) setMsg(j.linked ? `${j.linked} e-mail(s) antigo(s) ligado(s) a este cliente.` : "Nenhum e-mail antigo novo pra ligar.");
        }}>Buscar e-mails antigos</button>
      </div>
      <p className="text-slate-500 text-[11px] mb-3">
        Ligados automaticamente pelo e-mail/domínio dos contatos do cliente, pela conversa, pelo chamado ou pelo lead da venda. Dá pra ligar à mão abaixo.
      </p>
      {msg && <div className="text-[11px] text-amber-200 mb-2">{msg}</div>}

      {marking && (
        <div className="border border-indigo-500/30 bg-indigo-500/5 rounded-lg p-3 mb-3 flex flex-wrap items-end gap-2">
          <span className="text-xs text-slate-300 w-full">Marcar como {marking.mark === "ACEITE" ? "aceite do contrato" : "confirmação de faturamento"}:</span>
          <select className={input} value={marking.saleId} onChange={(e) => setMarking({ ...marking, saleId: e.target.value })}>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <input className={input} placeholder={marking.mark === "ACEITE" ? "Quem aceitou (se for e-mail enviado)" : "Quem confirmou (opcional)"} value={marking.who} onChange={(e) => setMarking({ ...marking, who: e.target.value })} />
          <button className={btnPrimary} onClick={async () => {
            const ok = await post({
              action: "mark", emailId: marking.id, mark: marking.mark, saleId: marking.saleId,
              ...(marking.mark === "ACEITE" ? { acceptedByName: marking.who || null } : { confirmedBy: marking.who || null }),
            }, marking.mark === "ACEITE" ? "Aceite registrado a partir do e-mail." : "Faturamento confirmado a partir do e-mail.");
            if (ok) { setMarking(null); onChanged(); }
          }}>Confirmar</button>
          <button className={btnGhost} onClick={() => setMarking(null)}>Cancelar</button>
        </div>
      )}

      {rows === null ? <div className="text-slate-500 text-sm">Carregando…</div> : rows.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">Nenhum e-mail ligado a este cliente.</div>
      ) : (
        <ul className="flex flex-col divide-y divide-[#1e2d45]/60">
          {rows.map((e) => (
            <li key={e.id} className="py-2 flex flex-wrap items-start gap-x-3 gap-y-1">
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <span>{fmtDateTime(e.sentAt)}</span>
                  <span>{e.direction === "OUT" ? `→ ${e.toEmail.slice(0, 60)}` : `${e.fromName ?? e.fromEmail}`}</span>
                  {e.attachments > 0 && <span>📎 {e.attachments}</span>}
                  {markLabel(e.clientMark) && <span className="px-1.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold">{markLabel(e.clientMark)}</span>}
                  {e.clientLinkSource === "MANUAL" && <span className="text-slate-600">ligado à mão</span>}
                </div>
                <Link href={`/emails?email=${e.id}`} className="text-slate-200 text-[13px] hover:text-indigo-300">{e.subject || "(sem assunto)"}</Link>
                <div className="text-slate-500 text-[11px] line-clamp-1">{e.aiSummary || e.snippet}</div>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                {canMark && contracts.length > 0 && !e.clientMark && (
                  <>
                    <button className="text-slate-400 hover:text-emerald-300" onClick={() => setMarking({ id: e.id, mark: "ACEITE", saleId: contracts[0].id, who: "" })}>marcar aceite</button>
                    <button className="text-slate-400 hover:text-emerald-300" onClick={() => setMarking({ id: e.id, mark: "FATURAMENTO", saleId: contracts[0].id, who: "" })}>marcar faturamento</button>
                  </>
                )}
                {e.clientMark && <button className="text-slate-500 hover:text-white" onClick={() => post({ action: "unmark", emailId: e.id })}>tirar marca</button>}
                <button className="text-slate-600 hover:text-red-300" onClick={() => post({ action: "unlink", emailId: e.id }, "E-mail desligado deste cliente.")}>desligar</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-[#1e2d45] pt-4">
        <div className="text-[11px] text-slate-400 font-semibold mb-2">Ligar outro e-mail a este cliente</div>
        <div className="flex gap-2">
          <input className={`${input} flex-1`} placeholder="Procure por assunto, remetente ou destinatário" value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className={btnGhost} onClick={search}>Procurar</button>
        </div>
        {found && (
          <ul className="mt-2 flex flex-col gap-1">
            {found.length === 0 && <li className="text-[11px] text-slate-500">Nada encontrado.</li>}
            {found.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-[12px]">
                <span className="text-slate-600 text-[10px] tabular-nums">{fmtDate(e.sentAt)}</span>
                <span className="text-slate-300 flex-1 truncate">{e.subject || "(sem assunto)"} <span className="text-slate-600">— {e.direction === "IN" ? e.fromEmail : e.toEmail.slice(0, 40)}</span></span>
                {e.clientCompanyId === companyId
                  ? <span className="text-emerald-400 text-[11px]">já ligado</span>
                  : <button className="text-indigo-400 hover:underline text-[11px]" onClick={async () => {
                      await post({ action: "link", emailId: e.id }, "E-mail ligado ao cliente.");
                      setFound((f) => f?.map((x) => (x.id === e.id ? { ...x, clientCompanyId: companyId } : x)) ?? null);
                    }}>{e.clientCompany ? `mover de ${e.clientCompany.name}` : "ligar"}</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
