"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, CheckCircle2, RotateCcw, Wallet, FileText, ExternalLink } from "lucide-react";

type Inv = {
  id: string; clientServiceId: string | null; serviceLabel: string | null;
  description: string; referenceMonth: string | null; amountCents: number;
  dueDate: string; status: string; paidAt: string | null;
  boletoUrl: string | null; invoiceUrl: string | null; externalId: string | null; notes: string | null;
};
type Svc = { id: string; label: string };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (s: string) => new Date(s).toLocaleDateString("pt-BR");
const input = "w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

export default function CompanyFinanceiro({
  companyId, initial, services,
}: {
  companyId: string; initial: Inv[]; services: Svc[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Inv[]>(initial);
  const [editing, setEditing] = useState<Inv | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [fDesc, setFDesc] = useState("");
  const [fSvc, setFSvc] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fDue, setFDue] = useState("");
  const [fStatus, setFStatus] = useState("ABERTO");
  const [fPaidAt, setFPaidAt] = useState("");
  const [fBoleto, setFBoleto] = useState("");
  const [fNota, setFNota] = useState("");
  const [fExt, setFExt] = useState("");
  const [fNotes, setFNotes] = useState("");

  function openNew() {
    setEditing("new"); setErr("");
    setFDesc(""); setFSvc(""); setFMonth(""); setFAmount(""); setFDue(""); setFStatus("ABERTO");
    setFPaidAt(""); setFBoleto(""); setFNota(""); setFExt(""); setFNotes("");
  }
  function openEdit(it: Inv) {
    setEditing(it); setErr("");
    setFDesc(it.description); setFSvc(it.clientServiceId ?? ""); setFMonth(it.referenceMonth ?? "");
    setFAmount((it.amountCents / 100).toFixed(2).replace(".", ",")); setFDue(it.dueDate.slice(0, 10));
    setFStatus(it.status); setFPaidAt(it.paidAt ? it.paidAt.slice(0, 10) : "");
    setFBoleto(it.boletoUrl ?? ""); setFNota(it.invoiceUrl ?? ""); setFExt(it.externalId ?? ""); setFNotes(it.notes ?? "");
  }
  function close() { setEditing(null); setErr(""); }

  function toCents(v: string) {
    const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }

  async function save() {
    if (!fDesc.trim()) { setErr("Descreva a cobrança."); return; }
    const amountCents = toCents(fAmount);
    if (!Number.isFinite(amountCents) || amountCents < 0) { setErr("Valor inválido."); return; }
    if (!fDue) { setErr("Informe o vencimento."); return; }
    setSaving(true); setErr("");
    const payload: any = {
      clientServiceId: fSvc || null, description: fDesc.trim(), referenceMonth: fMonth || null,
      amountCents, dueDate: new Date(fDue).toISOString(),
      boletoUrl: fBoleto.trim() || null, invoiceUrl: fNota.trim() || null,
      externalId: fExt.trim() || null, notes: fNotes.trim() || null,
      status: fStatus, paidAt: fStatus === "PAGO" ? (fPaidAt ? new Date(fPaidAt).toISOString() : new Date().toISOString()) : null,
    };
    const isNew = editing === "new";
    const url = isNew ? `/api/empresas/${companyId}/financeiro` : `/api/empresas/${companyId}/financeiro/${(editing as Inv).id}`;
    const res = await fetch(url, { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error ?? "Erro ao salvar"); return; }
    const d = await res.json();
    const norm = normalize(d);
    setItems((prev) => isNew ? [norm, ...prev] : prev.map((x) => x.id === norm.id ? norm : x));
    close(); router.refresh();
  }

  function normalize(d: any): Inv {
    return {
      id: d.id, clientServiceId: d.clientServiceId ?? null, serviceLabel: d.clientService?.label ?? null,
      description: d.description, referenceMonth: d.referenceMonth ?? null, amountCents: d.amountCents,
      dueDate: d.dueDate, status: d.status, paidAt: d.paidAt ?? null,
      boletoUrl: d.boletoUrl ?? null, invoiceUrl: d.invoiceUrl ?? null, externalId: d.externalId ?? null, notes: d.notes ?? null,
    };
  }

  async function quickPay(it: Inv, paid: boolean) {
    const res = await fetch(`/api/empresas/${companyId}/financeiro/${it.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: paid ? "PAGO" : "ABERTO" }),
    });
    if (res.ok) { const d = await res.json(); setItems((prev) => prev.map((x) => x.id === it.id ? normalize(d) : x)); router.refresh(); }
  }

  async function remove(it: Inv) {
    if (!confirm(`Excluir a cobrança "${it.description}"?`)) return;
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    await fetch(`/api/empresas/${companyId}/financeiro/${it.id}`, { method: "DELETE" });
    router.refresh();
  }

  const now = new Date();
  const openCents = items.filter((i) => i.status === "ABERTO").reduce((s, i) => s + i.amountCents, 0);

  function statusOf(it: Inv) {
    if (it.status === "PAGO") return { label: "Pago", cls: "bg-emerald-500/15 text-emerald-400" };
    if (it.status === "CANCELADO") return { label: "Cancelado", cls: "bg-slate-500/15 text-slate-400" };
    if (new Date(it.dueDate) < now) return { label: "Atrasado", cls: "bg-red-500/15 text-red-400" };
    return { label: "Em aberto", cls: "bg-amber-500/15 text-amber-400" };
  }

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-white font-semibold text-sm flex items-center gap-1.5"><Wallet className="w-4 h-4 text-indigo-400" strokeWidth={2.25} /> Financeiro</h3>
          <p className="text-slate-500 text-xs mt-0.5">Faturas / boletos / NF deste cliente. Em aberto: <span className="text-amber-400 font-semibold">{brl(openCents)}</span></p>
        </div>
        {editing === null && (
          <button onClick={openNew} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap">
            <Plus className="w-3.5 h-3.5" /> Nova cobrança
          </button>
        )}
      </div>

      {editing !== null && (
        <div className="bg-[#0a0f1a] border border-indigo-500/30 rounded-xl p-4 space-y-3 mb-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs">Descrição *</label>
              <input value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Ex.: Mensalidade Gestão de Mídias · Jul/26" className={input + " mt-1"} />
            </div>
            <div>
              <label className="text-slate-400 text-xs">Serviço (opcional)</label>
              <select value={fSvc} onChange={(e) => setFSvc(e.target.value)} className={input + " mt-1"}>
                <option value="">— geral —</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="text-slate-400 text-xs">Valor (R$) *</label>
              <input value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="1.500,00" inputMode="decimal" className={input + " mt-1"} />
            </div>
            <div>
              <label className="text-slate-400 text-xs">Vencimento *</label>
              <input type="date" value={fDue} onChange={(e) => setFDue(e.target.value)} className={input + " mt-1"} />
            </div>
            <div>
              <label className="text-slate-400 text-xs">Competência</label>
              <input type="month" value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={input + " mt-1"} />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="text-slate-400 text-xs">Status</label>
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={input + " mt-1"}>
                <option value="ABERTO">Em aberto</option>
                <option value="PAGO">Pago</option>
                <option value="CANCELADO">Cancelado</option>
              </select>
            </div>
            {fStatus === "PAGO" && (
              <div>
                <label className="text-slate-400 text-xs">Data de liquidação</label>
                <input type="date" value={fPaidAt} onChange={(e) => setFPaidAt(e.target.value)} className={input + " mt-1"} />
              </div>
            )}
            <div>
              <label className="text-slate-400 text-xs">Nosso número <span className="text-slate-600">(opcional)</span></label>
              <input value={fExt} onChange={(e) => setFExt(e.target.value)} placeholder="ID do boleto" className={input + " mt-1"} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs">Link do boleto</label>
              <input value={fBoleto} onChange={(e) => setFBoleto(e.target.value)} placeholder="https://… ou linha digitável" className={input + " mt-1"} />
            </div>
            <div>
              <label className="text-slate-400 text-xs">Link da NF</label>
              <input value={fNota} onChange={(e) => setFNota(e.target.value)} placeholder="https://…" className={input + " mt-1"} />
            </div>
          </div>
          <div>
            <label className="text-slate-400 text-xs">Observações</label>
            <textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={2} className={input + " mt-1 resize-y"} />
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium">
              {saving ? "Salvando…" : editing === "new" ? "Lançar" : "Salvar"}
            </button>
            <button onClick={close} className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-sm hover:bg-[#1e2d45]">Cancelar</button>
          </div>
        </div>
      )}

      {items.length === 0 && editing === null ? (
        <p className="text-slate-600 text-xs">Nenhuma cobrança lançada.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const st = statusOf(it);
            return (
              <div key={it.id} className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-3 flex items-start gap-3 group">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-semibold">{brl(it.amountCents)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                    {it.serviceLabel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">{it.serviceLabel}</span>}
                  </div>
                  <div className="text-slate-400 text-xs mt-0.5">{it.description}</div>
                  <div className="text-slate-500 text-[11px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                    <span>vence {dt(it.dueDate)}</span>
                    {it.paidAt && <span className="text-emerald-400">liquidado {dt(it.paidAt)}</span>}
                    {it.boletoUrl && <a href={it.boletoUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> boleto</a>}
                    {it.invoiceUrl && <a href={it.invoiceUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-1"><FileText className="w-3 h-3" /> NF</a>}
                  </div>
                </div>
                <div className="flex gap-1.5 items-center flex-none">
                  {it.status !== "PAGO" ? (
                    <button onClick={() => quickPay(it, true)} className="text-emerald-500 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Marcar pago (hoje)"><CheckCircle2 className="w-4 h-4" /></button>
                  ) : (
                    <button onClick={() => quickPay(it, false)} className="text-slate-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Reabrir"><RotateCcw className="w-4 h-4" /></button>
                  )}
                  <button onClick={() => openEdit(it)} className="text-slate-500 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => remove(it)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
