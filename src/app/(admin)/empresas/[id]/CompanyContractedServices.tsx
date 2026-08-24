"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, X, Boxes } from "lucide-react";

type Detail = { label: string; value: string };
type Item = {
  id: string; serviceId: string | null; serviceName: string | null;
  label: string; status: string; renewsAt: string | null;
  url: string | null; notes: string | null; details: Detail[] | null;
  amountCents: number | null; isRecurring: boolean;
  startedAt: string | null; endedAt: string | null;
  billingCycle: string | null; billingDay: number | null;
};
type Catalog = { id: string; name: string };

const CICLO_LABEL: Record<string, string> = {
  MENSAL: "mês", TRIMESTRAL: "trimestre", ANUAL: "ano",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  ATIVO:          { label: "Ativo",          cls: "bg-emerald-500/15 text-emerald-400" },
  EM_IMPLANTACAO: { label: "Em implantação",  cls: "bg-indigo-500/15 text-indigo-300" },
  PAUSADO:        { label: "Pausado",        cls: "bg-amber-500/15 text-amber-400" },
  ENCERRADO:      { label: "Encerrado",      cls: "bg-slate-500/15 text-slate-400" },
};
const input = "w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

export default function CompanyContractedServices({
  companyId, initial, catalog,
}: {
  companyId: string; initial: Item[]; catalog: Catalog[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initial);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [fServiceId, setFServiceId] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fStatus, setFStatus] = useState("ATIVO");
  const [fRenews, setFRenews] = useState("");
  const [fUrl, setFUrl] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fDetails, setFDetails] = useState<Detail[]>([]);
  // Cobrança: é isto que faz o contrato existir pro Financeiro. Sem valor e
  // sem recorrência ele não entra na previsão do mês nem na fila "a faturar".
  const [fRecorrente, setFRecorrente] = useState(false);
  const [fValor, setFValor] = useState("");
  const [fCiclo, setFCiclo] = useState("MENSAL");
  const [fDia, setFDia] = useState("");
  const [fInicio, setFInicio] = useState("");
  const [fFim, setFFim] = useState("");

  function openNew() {
    setEditing("new"); setErr("");
    setFServiceId(""); setFLabel(""); setFStatus("ATIVO"); setFRenews(""); setFUrl(""); setFNotes(""); setFDetails([]);
    setFRecorrente(false); setFValor(""); setFCiclo("MENSAL"); setFDia(""); setFInicio(""); setFFim("");
  }
  function openEdit(it: Item) {
    setEditing(it); setErr("");
    setFServiceId(it.serviceId ?? ""); setFLabel(it.label); setFStatus(it.status);
    setFRenews(it.renewsAt ? it.renewsAt.slice(0, 10) : ""); setFUrl(it.url ?? ""); setFNotes(it.notes ?? "");
    setFDetails(it.details ?? []);
    setFRecorrente(it.isRecurring);
    setFValor(it.amountCents != null ? (it.amountCents / 100).toFixed(2).replace(".", ",") : "");
    setFCiclo(it.billingCycle ?? "MENSAL");
    setFDia(it.billingDay != null ? String(it.billingDay) : "");
    setFInicio(it.startedAt ? it.startedAt.slice(0, 10) : "");
    setFFim(it.endedAt ? it.endedAt.slice(0, 10) : "");
  }
  function close() { setEditing(null); setErr(""); }

  // Ao escolher um serviço do catálogo sem apelido definido, sugere o nome.
  function onPickService(id: string) {
    setFServiceId(id);
    if (!fLabel.trim()) {
      const c = catalog.find((x) => x.id === id);
      if (c) setFLabel(c.name);
    }
  }

  async function save() {
    if (!fLabel.trim()) { setErr("Dê um apelido ao serviço."); return; }
    setSaving(true); setErr("");
    const payload = {
      serviceId: fServiceId || null, label: fLabel.trim(), status: fStatus,
      renewsAt: fRenews ? new Date(fRenews).toISOString() : null,
      url: fUrl.trim() || null, notes: fNotes.trim() || null,
      details: fDetails.filter((d) => d.label.trim() || d.value.trim()),
      amountCents: (() => {
        const n = parseFloat(fValor.replace(/\./g, "").replace(",", "."));
        return Number.isFinite(n) ? Math.round(n * 100) : null;
      })(),
      isRecurring: fRecorrente,
      billingCycle: fCiclo,
      billingDay: fDia ? parseInt(fDia, 10) : null,
      startedAt: fInicio ? new Date(fInicio + "T12:00:00").toISOString() : null,
      // Só manda `endedAt` quando preenchido: vazio deixa a API carimbar
      // sozinha ao mudar pra Encerrado, em vez de gravar nulo por cima.
      ...(fFim ? { endedAt: new Date(fFim + "T12:00:00").toISOString() } : {}),
    };
    const isNew = editing === "new";
    const url = isNew
      ? `/api/empresas/${companyId}/servicos-contratados`
      : `/api/empresas/${companyId}/servicos-contratados/${(editing as Item).id}`;
    const res = await fetch(url, { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error ?? "Erro ao salvar"); return; }
    const data = await res.json();
    const norm: Item = {
      id: data.id, serviceId: data.serviceId ?? null, serviceName: data.service?.name ?? null,
      label: data.label, status: data.status, renewsAt: data.renewsAt ?? null,
      url: data.url ?? null, notes: data.notes ?? null, details: (data.details as Detail[]) ?? null,
      amountCents: data.amountCents ?? null, isRecurring: data.isRecurring ?? false,
      billingCycle: data.billingCycle ?? null, billingDay: data.billingDay ?? null,
      startedAt: data.startedAt ?? null, endedAt: data.endedAt ?? null,
    };
    setItems((prev) => isNew ? [norm, ...prev] : prev.map((x) => x.id === norm.id ? norm : x));
    close();
    router.refresh();
  }

  async function remove(it: Item) {
    if (!confirm(`Remover "${it.label}"?`)) return;
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    await fetch(`/api/empresas/${companyId}/servicos-contratados/${it.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-white font-semibold text-sm flex items-center gap-1.5"><Boxes className="w-4 h-4 text-indigo-400" strokeWidth={2.25} /> Serviços contratados</h3>
          <p className="text-slate-500 text-xs mt-0.5">O que este cliente já tem com você (aparece no painel dele). Pode ter vários — inclusive o mesmo serviço mais de uma vez.</p>
        </div>
        {editing === null && (
          <button onClick={openNew} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap">
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </button>
        )}
      </div>

      {editing !== null && (
        <div className="bg-[#0a0f1a] border border-indigo-500/30 rounded-xl p-4 space-y-3 mb-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs">Serviço do catálogo</label>
              <select value={fServiceId} onChange={(e) => onPickService(e.target.value)} className={input + " mt-1"}>
                <option value="">— avulso (sem catálogo) —</option>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-xs">Apelido / identificação *</label>
              <input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="Ex.: Hospedagem site principal" className={input + " mt-1"} />
            </div>
          </div>
          {/* Cobrança — o bloco que liga este contrato ao Financeiro. */}
          <div className="rounded-lg border border-[#1e2d45] bg-white/[0.02] p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={fRecorrente}
                onChange={(e) => setFRecorrente(e.target.checked)}
                className="accent-indigo-500"
              />
              Cobrança recorrente
              <span className="text-xs text-slate-600">— entra na previsão do mês e na fila &ldquo;a faturar&rdquo;</span>
            </label>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="text-slate-400 text-xs">
                  {fRecorrente ? "Valor por ciclo (R$)" : "Valor (R$)"}
                </label>
                <input
                  value={fValor}
                  onChange={(e) => setFValor(e.target.value)}
                  placeholder="0,00"
                  className={input + " mt-1"}
                />
              </div>
              {fRecorrente && (
                <>
                  <div>
                    <label className="text-slate-400 text-xs">Periodicidade</label>
                    <select value={fCiclo} onChange={(e) => setFCiclo(e.target.value)} className={input + " mt-1"}>
                      <option value="MENSAL">Mensal</option>
                      <option value="TRIMESTRAL">Trimestral</option>
                      <option value="ANUAL">Anual</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs">Dia do vencimento</label>
                    <input
                      type="number" min={1} max={31}
                      value={fDia}
                      onChange={(e) => setFDia(e.target.value)}
                      placeholder="10"
                      className={input + " mt-1"}
                    />
                  </div>
                </>
              )}
            </div>
            {fRecorrente && fCiclo !== "MENSAL" && (
              // Trimestral e anual precisam de âncora pra saber em QUAL mês caem.
              <p className="text-xs text-amber-400/90">
                Contrato {fCiclo === "ANUAL" ? "anual" : "trimestral"}: preencha a
                &ldquo;Renovação / vencimento&rdquo; abaixo — é ela que define em quais meses a cobrança cai.
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="text-slate-400 text-xs">Status</label>
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={input + " mt-1"}>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-slate-400 text-xs">Início do contrato</label>
              <input type="date" value={fInicio} onChange={(e) => setFInicio(e.target.value)} className={input + " mt-1"} />
            </div>
            <div>
              <label className="text-slate-400 text-xs">
                Encerrado em
                {fStatus !== "ENCERRADO" && <span className="text-slate-600"> (ao marcar Encerrado)</span>}
              </label>
              <input type="date" value={fFim} onChange={(e) => setFFim(e.target.value)} className={input + " mt-1"} />
            </div>
            <div>
              <label className="text-slate-400 text-xs">Renovação / próximo ciclo</label>
              <input type="date" value={fRenews} onChange={(e) => setFRenews(e.target.value)} className={input + " mt-1"} />
              {fRecorrente && fCiclo !== "MENSAL" && (
                <p className="text-[10px] text-slate-600 mt-1">Define em quais meses a cobrança cai.</p>
              )}
            </div>
            <div>
              <label className="text-slate-400 text-xs">Link / acesso</label>
              <input value={fUrl} onChange={(e) => setFUrl(e.target.value)} placeholder="https://…" className={input + " mt-1"} />
            </div>
          </div>
          <div>
            <label className="text-slate-400 text-xs">Observações</label>
            <textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={2} className={input + " mt-1 resize-y"} placeholder="Detalhes internos deste contrato…" />
          </div>

          {/* Campos extras flexíveis */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-slate-400 text-xs">Campos extras <span className="text-slate-600">(ex.: Plano, Espaço, Login)</span></label>
              <button type="button" onClick={() => setFDetails((d) => [...d, { label: "", value: "" }])} className="text-[11px] text-indigo-300 hover:text-indigo-200">+ campo</button>
            </div>
            <div className="space-y-1.5 mt-1.5">
              {fDetails.map((d, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={d.label} onChange={(e) => setFDetails((arr) => arr.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} placeholder="Campo" className={input + " !py-1.5 flex-1"} />
                  <input value={d.value} onChange={(e) => setFDetails((arr) => arr.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))} placeholder="Valor" className={input + " !py-1.5 flex-1"} />
                  <button type="button" onClick={() => setFDetails((arr) => arr.filter((_, idx) => idx !== i))} className="text-slate-500 hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {err && <p className="text-red-400 text-xs">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium">
              {saving ? "Salvando…" : editing === "new" ? "Adicionar" : "Salvar"}
            </button>
            <button onClick={close} className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-sm hover:bg-[#1e2d45]">Cancelar</button>
          </div>
        </div>
      )}

      {items.length === 0 && editing === null ? (
        <p className="text-slate-600 text-xs">Nenhum serviço contratado cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const st = STATUS[it.status] ?? { label: it.status, cls: "bg-slate-500/15 text-slate-400" };
            return (
              <div key={it.id} className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg p-3 flex items-start gap-3 group">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-semibold">{it.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                    {it.serviceName && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">{it.serviceName}</span>}
                    {it.amountCents != null && (
                      <span className="text-[11px] text-emerald-400 font-medium">
                        {(it.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        {it.isRecurring && (
                          <span className="text-slate-500 font-normal">
                            {" "}/ {CICLO_LABEL[it.billingCycle ?? "MENSAL"]}
                            {it.billingDay ? ` · dia ${it.billingDay}` : ""}
                          </span>
                        )}
                      </span>
                    )}
                    {/* Recorrente sem valor não aparece na previsão — avisa aqui,
                        que é onde a pessoa consegue consertar. */}
                    {it.isRecurring && it.amountCents == null && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                        sem valor
                      </span>
                    )}
                  </div>
                  <div className="text-slate-500 text-[11px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {it.endedAt
                      ? <span className="text-slate-500">⛔ encerrado em {new Date(it.endedAt).toLocaleDateString("pt-BR")}</span>
                      : it.renewsAt && <span>🔁 renova {new Date(it.renewsAt).toLocaleDateString("pt-BR")}</span>}
                    {it.startedAt && <span>▶️ desde {new Date(it.startedAt).toLocaleDateString("pt-BR")}</span>}
                    {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline truncate max-w-[220px]">{it.url}</a>}
                    {it.details?.map((d, i) => <span key={i}>{d.label}: <span className="text-slate-400">{d.value}</span></span>)}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-none">
                  <button onClick={() => openEdit(it)} className="text-slate-500 hover:text-indigo-400" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => remove(it)} className="text-slate-500 hover:text-red-400" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
