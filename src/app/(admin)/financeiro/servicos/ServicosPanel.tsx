"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Check, Loader2, X } from "lucide-react";
import FinanceiroTabs from "../FinanceiroTabs";
import { brlFromCents } from "../lib";

export interface ServicosData {
  catalogo: { id: string; name: string }[];
  contratos: {
    id: string; label: string; status: string; amountCents: number; isRecurring: boolean;
    cliente: string; clienteId: string; catalogo: string | null; catalogoId: string | null;
  }[];
}

const card = "bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5";
const input =
  "bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

/**
 * Padronização em massa: seleciona contratos (busca + "só sem catálogo"),
 * escolhe o serviço do catálogo e/ou o novo rótulo, aplica de uma vez.
 */
export default function ServicosPanel({ data }: { data: ServicosData }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [soSemCatalogo, setSoSemCatalogo] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [destinoCatalogo, setDestinoCatalogo] = useState("");
  const [novoRotulo, setNovoRotulo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState("");

  const visiveis = data.contratos.filter((c) => {
    if (soSemCatalogo && c.catalogoId) return false;
    const q = busca.trim().toLowerCase();
    return !q || `${c.cliente} ${c.label} ${c.catalogo ?? ""}`.toLowerCase().includes(q);
  });

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((c) => sel.has(c.id));
  const marcados = data.contratos.filter((c) => sel.has(c.id));

  async function aplicar() {
    if (marcados.length === 0) { setErro("Selecione ao menos um serviço."); return; }
    if (!destinoCatalogo && !novoRotulo.trim()) {
      setErro("Escolha o serviço do catálogo e/ou informe o novo rótulo.");
      return;
    }
    const resumo = [
      destinoCatalogo && `vincular ao catálogo "${data.catalogo.find((s) => s.id === destinoCatalogo)?.name}"`,
      novoRotulo.trim() && `renomear pra "${novoRotulo.trim()}"`,
    ].filter(Boolean).join(" e ");
    if (!confirm(`Aplicar em ${marcados.length} serviço(s): ${resumo}?`)) return;

    setSalvando(true); setErro(""); setFeito("");
    const res = await fetch("/api/financeiro/servicos/lote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceIds: marcados.map((c) => c.id),
        ...(destinoCatalogo ? { catalogServiceId: destinoCatalogo } : {}),
        ...(novoRotulo.trim() ? { label: novoRotulo.trim() } : {}),
      }),
    });
    setSalvando(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Não foi possível atualizar.");
      return;
    }
    const r = await res.json();
    setFeito(`${r.updated} serviço(s) atualizado(s).`);
    setSel(new Set());
    setNovoRotulo("");
    router.refresh();
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      <div>
        <h1 className="text-white font-bold text-xl flex items-center gap-2">
          <Boxes className="w-5 h-5 text-indigo-400" />
          Serviços da carteira
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Padronize em massa: selecione contratos, vincule ao serviço do catálogo e/ou renomeie o rótulo.
        </p>
      </div>

      <FinanceiroTabs />

      {erro && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-lg px-4 py-3 text-sm text-red-300 flex items-center justify-between">
          {erro}
          <button onClick={() => setErro("")}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {feito && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-4 py-3 text-sm text-emerald-300 flex items-center justify-between">
          {feito}
          <button onClick={() => setFeito("")}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Barra de ação do lote */}
      <div className={card}>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-500">Vincular ao serviço do catálogo</span>
            <select value={destinoCatalogo} onChange={(e) => setDestinoCatalogo(e.target.value)} className={input}>
              <option value="">— não mudar —</option>
              {data.catalogo.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-[11px] text-slate-500">Novo rótulo (opcional — aplica o MESMO em todos)</span>
            <input
              value={novoRotulo}
              onChange={(e) => setNovoRotulo(e.target.value)}
              placeholder="Ex.: Hospedagem de Site"
              className={input}
            />
          </label>
          <button
            onClick={aplicar}
            disabled={salvando || sel.size === 0}
            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-1.5"
          >
            {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Aplicar em {sel.size} selecionado(s)
          </button>
        </div>
        <p className="text-[11px] text-slate-600 mt-2">
          Vincular ao catálogo é o que &ldquo;mescla&rdquo;: relatórios e filtros passam a tratar tudo como o
          mesmo serviço, mantendo cada contrato com seu valor e cliente. O rótulo só muda se você preencher.
        </p>
      </div>

      {/* Lista */}
      <div className={card}>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente, serviço ou catálogo…"
            className={input + " flex-1 min-w-[220px]"}
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={soSemCatalogo}
              onChange={(e) => setSoSemCatalogo(e.target.checked)}
              className="accent-indigo-500 w-3.5 h-3.5"
            />
            só sem catálogo
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={todosVisiveisMarcados}
              onChange={() =>
                setSel((prev) => {
                  const next = new Set(prev);
                  if (todosVisiveisMarcados) visiveis.forEach((c) => next.delete(c.id));
                  else visiveis.forEach((c) => next.add(c.id));
                  return next;
                })
              }
              className="accent-indigo-500 w-3.5 h-3.5"
            />
            {todosVisiveisMarcados ? "limpar visíveis" : `selecionar visíveis (${visiveis.length})`}
          </label>
        </div>

        {visiveis.length === 0 ? (
          <p className="text-slate-600 text-sm py-6 text-center">Nenhum serviço bate com o filtro.</p>
        ) : (
          <div className="space-y-1 max-h-[540px] overflow-y-auto">
            {visiveis.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                  sel.has(c.id) ? "bg-indigo-500/[0.07] border-indigo-500/30" : "bg-white/[0.02] border-transparent"
                }`}
              >
                <input
                  type="checkbox"
                  checked={sel.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="accent-indigo-500 w-3.5 h-3.5 flex-shrink-0"
                  aria-label={`Selecionar ${c.cliente} — ${c.label}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">
                    {c.label}
                    <Link href={`/empresas/${c.clienteId}#servicos`} className="text-slate-500 text-xs ml-2 hover:text-indigo-400">
                      {c.cliente}
                    </Link>
                  </div>
                  <div className="text-xs text-slate-600">
                    {c.isRecurring ? "recorrente" : "pontual"} · {brlFromCents(c.amountCents)} · {c.status.toLowerCase().replace("_", " ")}
                  </div>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                    c.catalogo ? "bg-indigo-500/15 text-indigo-300" : "bg-amber-500/15 text-amber-400"
                  }`}
                >
                  {c.catalogo ?? "sem catálogo"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
