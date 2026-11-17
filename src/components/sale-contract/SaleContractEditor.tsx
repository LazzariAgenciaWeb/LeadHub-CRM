"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/**
 * Contrato de uma venda: envio, aceite, confirmação do faturamento e
 * serviços vendidos. Mesmo componente na Central do Cliente e na esteira —
 * as regras moram em src/lib/sale-contract.ts (via PATCH da venda).
 */

interface SoldService {
  serviceId?: string | null;
  name: string;
  level?: string | null;
  recurring: boolean;
  startAt?: string | null;
  durationMonths?: number | null;
  amountCents?: number | null;
}

interface SaleData {
  id: string;
  title: string;
  valueCents: number;
  clientCompanyId: string | null;
  contractStatus: string;
  billingStatus: string;
  productionStatus: string;
  contractDocType: string | null;
  contractDocumentId: string | null;
  contractSentAt: string | null;
  acceptanceType: string | null;
  acceptanceUrl: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  acceptedByEmail: string | null;
  acceptanceRecordedBy: string | null;
  billingConfirmed: boolean;
  billingConfirmedBy: string | null;
  billingConfirmedAt: string | null;
  billingConfirmationUrl: string | null;
  billingInstructions: string | null;
  soldServices: SoldService[] | null;
  project: { id: string; name: string; status: string } | null;
}

interface Payload {
  sale: SaleData;
  documents: { id: string; type: string; title: string; url: string | null; storageObjectId: string | null }[];
  catalog: { id: string; name: string }[];
  productionBlocker: string | null;
}

const ACCEPTANCE = [
  ["EMAIL", "E-mail de \"de acordo\""], ["WHATSAPP", "WhatsApp"], ["AUTENTIQUE", "Autentique"], ["GOHUB", "GoHub"], ["OUTRO", "Outro"],
] as const;
const ACCEPTANCE_LABEL: Record<string, string> = Object.fromEntries(ACCEPTANCE);
const CONTRACT_LABEL: Record<string, string> = {
  PENDENTE: "Rascunho", ENVIADO: "Enviado", ASSINADO: "Aceito", ENCERRADO: "Encerrado", DISPENSADO: "Não se aplica",
};

const input = "bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-full";
const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40";
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-500 text-white`;
const btnGhost = `${btn} border border-[#1e2d45] text-slate-400 hover:text-white`;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Meio-dia local: a data não pula pro dia vizinho ao virar UTC. */
const noon = (ymd: string) => (ymd ? new Date(`${ymd}T12:00:00`).toISOString() : null);
const isExternal = (u: string) => /^https?:\/\//i.test(u);

function LinkOut({ href, children }: { href: string; children: React.ReactNode }) {
  return isExternal(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">{children}</a>
    : <Link href={href} className="text-indigo-400 hover:underline">{children}</Link>;
}

export default function SaleContractEditor({
  saleId, canEdit = true, onChanged, compact = false,
}: { saleId: string; canEdit?: boolean; onChanged?: () => void; compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const [acc, setAcc] = useState({ type: "EMAIL", url: "", date: today(), name: "", email: "", docType: "CONTRATO", docId: "" });
  const [bill, setBill] = useState({ by: "", url: "", date: today() });
  const [instr, setInstr] = useState("");
  const [services, setServices] = useState<SoldService[]>([]);
  const [open, setOpen] = useState<"aceite" | "faturamento" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/financeiro/vendas/${saleId}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? "Não foi possível carregar o contrato."); return; }
    setData(j);
    setInstr(j.sale.billingInstructions ?? "");
    setServices(Array.isArray(j.sale.soldServices) ? j.sale.soldServices : []);
    setAcc((a) => ({ ...a, docType: j.sale.contractDocType ?? "CONTRATO", docId: j.sale.contractDocumentId ?? "" }));
  }, [saleId]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true); setErr(""); setOk("");
    const res = await fetch(`/api/financeiro/vendas/${saleId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? "Não foi possível salvar."); return false; }
    if (j.warning) setErr(j.warning);
    setOk(done);
    setOpen(null);
    await load();
    onChanged?.();
    return true;
  }

  if (!data) return <div className="text-slate-500 text-xs p-3">{err || "Carregando contrato…"}</div>;
  const s = data.sale;
  const contractDocs = data.documents.filter((d) => d.type === "CONTRATO" || d.type === "TERMO");
  const accepted = s.contractStatus === "ASSINADO" && !!s.acceptedAt;

  return (
    <div className={`flex flex-col gap-3 ${compact ? "" : "text-sm"}`}>
      {/* Situação */}
      <div className="flex flex-wrap gap-2 items-center text-[11px]">
        <span className={`px-2 py-0.5 rounded-full font-semibold ${accepted ? "bg-emerald-500/15 text-emerald-300" : s.contractStatus === "ENVIADO" ? "bg-blue-500/15 text-blue-300" : "bg-amber-500/10 text-amber-300"}`}>
          Contrato: {CONTRACT_LABEL[s.contractStatus] ?? s.contractStatus}
        </span>
        <span className={`px-2 py-0.5 rounded-full font-semibold ${s.billingConfirmed ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>
          Faturamento {s.billingConfirmed ? "confirmado" : "não confirmado"}
        </span>
        <span className={`px-2 py-0.5 rounded-full font-semibold ${s.productionStatus === "PENDENTE" ? "bg-white/5 text-slate-400" : "bg-blue-500/15 text-blue-300"}`}>
          Produção: {({ PENDENTE: "a liberar", LIBERADO: "em produção", ENTREGUE: "entregue", DISPENSADO: "não se aplica" } as Record<string, string>)[s.productionStatus] ?? s.productionStatus}
        </span>
        {s.project && <Link href={`/projetos/${s.project.id}`} className="text-indigo-400 hover:underline">🧩 {s.project.name}</Link>}
      </div>
      {data.productionBlocker && s.productionStatus === "PENDENTE" && (
        <div className="text-[11px] text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
          🔒 {data.productionBlocker}
        </div>
      )}

      {/* Envio */}
      <section className="border border-[#1e2d45] rounded-lg p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-slate-300 text-xs font-semibold">1. Envio</h4>
          {s.contractSentAt
            ? <span className="text-[11px] text-slate-400">{s.contractDocType === "TERMO" ? "Termo" : "Contrato"} enviado em {fmt(s.contractSentAt)}</span>
            : <span className="text-[11px] text-slate-500">Ainda não enviado</span>}
        </div>
        {canEdit && !s.contractSentAt && (
          <div className="flex flex-wrap items-end gap-2 mt-2">
            <select className={`${input} w-auto`} value={acc.docType} onChange={(e) => setAcc({ ...acc, docType: e.target.value })}>
              <option value="CONTRATO">Contrato</option>
              <option value="TERMO">Termo</option>
            </select>
            <select className={`${input} w-auto max-w-[220px]`} value={acc.docId} onChange={(e) => setAcc({ ...acc, docId: e.target.value })}>
              <option value="">Documento (opcional)</option>
              {contractDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            <button disabled={busy} className={btnGhost} onClick={() => patch({ contractSent: { contractDocType: acc.docType, contractDocumentId: acc.docId || null } }, "Envio registrado.")}>
              Marcar como enviado
            </button>
          </div>
        )}
      </section>

      {/* Aceite */}
      <section className="border border-[#1e2d45] rounded-lg p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-slate-300 text-xs font-semibold">2. Aceite</h4>
          {accepted && canEdit && (
            <button disabled={busy} className="text-[11px] text-slate-500 hover:text-red-300" onClick={() => {
              if (confirm("Remover o aceite registrado? O contrato volta pra Enviado.")) patch({ clearAcceptance: true }, "Aceite removido.");
            }}>remover</button>
          )}
        </div>
        {accepted ? (
          <div className="text-[12px] text-slate-300 mt-1.5 flex flex-col gap-0.5">
            <span>✅ Aceito em <b>{fmt(s.acceptedAt)}</b> via {ACCEPTANCE_LABEL[s.acceptanceType ?? ""] ?? s.acceptanceType}</span>
            <span className="text-slate-400">por {[s.acceptedByName, s.acceptedByEmail].filter(Boolean).join(" · ") || "—"}</span>
            {s.acceptanceUrl && <span><LinkOut href={s.acceptanceUrl}>Abrir comprovante do aceite ↗</LinkOut></span>}
            {s.acceptanceRecordedBy && <span className="text-slate-600 text-[10px]">registrado por {s.acceptanceRecordedBy}</span>}
          </div>
        ) : canEdit ? (
          open === "aceite" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <label className="flex flex-col gap-1 text-[10px] text-slate-500">Tipo de aceite
                <select className={input} value={acc.type} onChange={(e) => setAcc({ ...acc, type: e.target.value })}>
                  {ACCEPTANCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-slate-500">Data do aceite
                <input type="date" className={input} max={today()} value={acc.date} onChange={(e) => setAcc({ ...acc, date: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-slate-500 sm:col-span-2">{acc.type === "WHATSAPP" ? "Link ou observação (opcional)" : "Link do aceite (Autentique, e-mail…)"}
                <input className={input} placeholder={acc.type === "WHATSAPP" ? "ex.: confirmou no grupo do cliente" : "https://…"} value={acc.url} onChange={(e) => setAcc({ ...acc, url: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-slate-500">Aceito por (nome)
                <input className={input} value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-slate-500">E-mail de quem aceitou
                <input className={input} value={acc.email} onChange={(e) => setAcc({ ...acc, email: e.target.value })} />
              </label>
              <div className="sm:col-span-2 flex gap-2">
                <button disabled={busy} className={btnPrimary} onClick={() => patch({
                  acceptance: {
                    acceptanceType: acc.type, acceptanceUrl: acc.url, acceptedAt: noon(acc.date),
                    acceptedByName: acc.name, acceptedByEmail: acc.email,
                    contractDocType: acc.docType, contractDocumentId: acc.docId || null,
                  },
                }, "Aceite registrado.")}>Registrar aceite</button>
                <button className={btnGhost} onClick={() => setOpen(null)}>Cancelar</button>
              </div>
              <p className="sm:col-span-2 text-[10px] text-slate-600">
                Aceite por e-mail também pode ser marcado direto na aba E-mails do cliente.
              </p>
            </div>
          ) : (
            s.contractStatus === "DISPENSADO" ? (
              <div className="text-[12px] text-slate-400 mt-1.5 flex items-center gap-2 flex-wrap">
                <span>Sem contrato nesta venda — aceite não se aplica.</span>
                <button disabled={busy} className="text-[11px] text-slate-500 hover:text-white underline" onClick={() => patch({ contractStatus: "PENDENTE" }, "Contrato voltou a rascunho.")}>desfazer</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mt-2">
                <button className={btnGhost} onClick={() => setOpen("aceite")}>Registrar aceite</button>
                <button disabled={busy} className={btnGhost} title="Venda sem contrato nem termo: libera a produção sem pedir aceite" onClick={() => patch({ contractStatus: "DISPENSADO" }, "Marcado: sem contrato (não se aplica).")}>
                  Não tem contrato (não se aplica)
                </button>
              </div>
            )
          )
        ) : <p className="text-[11px] text-slate-500 mt-1">Sem aceite registrado.</p>}
      </section>

      {/* Faturamento */}
      <section className="border border-[#1e2d45] rounded-lg p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-slate-300 text-xs font-semibold">3. Faturamento</h4>
          {s.billingConfirmed && canEdit && (
            <button disabled={busy} className="text-[11px] text-slate-500 hover:text-red-300" onClick={() => {
              if (confirm("Retirar a confirmação do faturamento?")) patch({ unconfirmBilling: true }, "Confirmação retirada.");
            }}>retirar</button>
          )}
        </div>
        {s.billingConfirmed ? (
          <div className="text-[12px] text-slate-300 mt-1.5 flex flex-col gap-0.5">
            <span>✅ Confirmado por <b>{s.billingConfirmedBy}</b> em {fmt(s.billingConfirmedAt)}</span>
            {s.billingConfirmationUrl && <span><LinkOut href={s.billingConfirmationUrl}>Abrir confirmação ↗</LinkOut></span>}
          </div>
        ) : canEdit && open === "faturamento" ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            <label className="flex flex-col gap-1 text-[10px] text-slate-500">Confirmado por
              <input className={input} placeholder="ex.: Kelly" value={bill.by} onChange={(e) => setBill({ ...bill, by: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-500">Data
              <input type="date" className={input} max={today()} value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-500">Link da confirmação
              <input className={input} placeholder="https://… (opcional)" value={bill.url} onChange={(e) => setBill({ ...bill, url: e.target.value })} />
            </label>
            <div className="sm:col-span-3 flex gap-2">
              <button disabled={busy} className={btnPrimary} onClick={() => patch({
                billingConfirm: { confirmedBy: bill.by, confirmationUrl: bill.url, confirmedAt: noon(bill.date), instructions: instr },
              }, "Faturamento confirmado.")}>Confirmar faturamento</button>
              <button className={btnGhost} onClick={() => setOpen(null)}>Cancelar</button>
            </div>
          </div>
        ) : canEdit ? (
          <button className={`${btnGhost} mt-2`} onClick={() => setOpen("faturamento")}>Confirmar faturamento</button>
        ) : <p className="text-[11px] text-slate-500 mt-1">Não confirmado.</p>}

        <label className="flex flex-col gap-1 text-[10px] text-slate-500 mt-3">
          Instruções de cobrança (valor, forma, vencimento, recorrência, entrada, observações)
          <textarea
            className={`${input} min-h-[64px]`} value={instr} disabled={!canEdit}
            onChange={(e) => setInstr(e.target.value)}
          />
        </label>
        {canEdit && instr !== (s.billingInstructions ?? "") && (
          <button disabled={busy} className={`${btnGhost} mt-1.5`} onClick={() => patch({ billingInstructions: instr }, "Instruções salvas.")}>Salvar instruções</button>
        )}
      </section>

      {/* Serviços vendidos */}
      <section className="border border-[#1e2d45] rounded-lg p-3">
        <h4 className="text-slate-300 text-xs font-semibold mb-2">Serviços vendidos</h4>
        {services.length === 0 && <p className="text-[11px] text-slate-500 mb-2">Nenhum serviço listado.</p>}
        <div className="flex flex-col gap-2">
          {services.map((sv, i) => {
            const set = (p: Partial<SoldService>) => setServices((prev) => prev.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-1.5 items-center">
                <input className={input} list={`catalog-${saleId}`} placeholder="Serviço" value={sv.name} disabled={!canEdit}
                  onChange={(e) => {
                    const hit = data.catalog.find((c) => c.name === e.target.value);
                    set({ name: e.target.value, serviceId: hit?.id ?? null });
                  }} />
                <input className={input} placeholder="Nível" value={sv.level ?? ""} disabled={!canEdit} onChange={(e) => set({ level: e.target.value })} />
                <select className={input} value={sv.recurring ? "R" : "P"} disabled={!canEdit} onChange={(e) => set({ recurring: e.target.value === "R" })}>
                  <option value="P">Pontual</option>
                  <option value="R">Recorrente</option>
                </select>
                <input type="date" className={input} value={sv.startAt ?? ""} disabled={!canEdit} onChange={(e) => set({ startAt: e.target.value || null })} />
                <input type="number" min={0} className={input} placeholder="Meses" value={sv.durationMonths ?? ""} disabled={!canEdit}
                  onChange={(e) => set({ durationMonths: e.target.value === "" ? null : Number(e.target.value) })} />
                {canEdit && <button className="text-slate-500 hover:text-red-300 text-xs px-1" onClick={() => setServices((p) => p.filter((_, j) => j !== i))}>✕</button>}
              </div>
            );
          })}
        </div>
        <datalist id={`catalog-${saleId}`}>{data.catalog.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        {canEdit && (
          <div className="flex gap-2 mt-2">
            <button className={btnGhost} onClick={() => setServices((p) => [...p, { name: "", recurring: false }])}>+ Serviço</button>
            {JSON.stringify(services) !== JSON.stringify(s.soldServices ?? []) && (
              <button disabled={busy} className={btnPrimary} onClick={() => patch({ soldServices: services }, "Serviços salvos.")}>Salvar serviços</button>
            )}
          </div>
        )}
      </section>

      {err && <div className="text-[11px] text-red-300">{err}</div>}
      {ok && !err && <div className="text-[11px] text-emerald-300">{ok}</div>}
    </div>
  );
}
