"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Check, Pencil } from "lucide-react";

/**
 * Particularidades da cobrança deste cliente — o que quem fatura precisa saber
 * ANTES de lançar: "emitir NF dentro do mês", "avisar no WhatsApp e mandar a
 * nota", "mandar o Pix pra ele pagar".
 *
 * Mora aqui e reaparece na fila "a faturar" (Lançamentos do mês), que é onde a
 * conferência acontece — instrução que só existe na cabeça de alguém vira
 * cobrança errada quando essa pessoa está de férias.
 */
export default function CompanyBillingNotes({
  companyId, initial,
}: {
  companyId: string; initial: string | null;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(initial ?? "");
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    setSalvando(true);
    setErro("");
    const res = await fetch(`/api/companies/${companyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billingNotes: texto }),
    });
    setSalvando(false);
    if (!res.ok) { setErro("Não foi possível salvar."); return; }
    setEditando(false);
    router.refresh();
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-amber-200 font-semibold text-sm flex items-center gap-1.5">
          <Info className="w-4 h-4" strokeWidth={2.25} />
          Instruções de cobrança
        </h3>
        {!editando && (
          <button
            onClick={() => setEditando(true)}
            className="text-slate-400 hover:text-white text-xs flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" /> {texto ? "Editar" : "Adicionar"}
          </button>
        )}
      </div>

      {editando ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            autoFocus
            placeholder={"Ex.: emitir NF sempre dentro do mês de competência.\nAvisar no WhatsApp do financeiro e mandar a nota.\nEnviar o Pix — não usa boleto."}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={salvar}
              disabled={salvando}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" /> {salvando ? "Salvando…" : "Salvar"}
            </button>
            <button
              onClick={() => { setTexto(initial ?? ""); setEditando(false); }}
              className="text-slate-400 hover:text-white text-xs"
            >
              Cancelar
            </button>
            {erro && <span className="text-[11px] text-red-400">{erro}</span>}
          </div>
          <p className="text-[11px] text-slate-500">
            Aparece na fila &ldquo;A faturar&rdquo; dos Lançamentos do mês, pra quem fizer a conferência ver antes de lançar.
          </p>
        </div>
      ) : texto ? (
        <p className="text-sm text-amber-100/90 whitespace-pre-wrap">{texto}</p>
      ) : (
        <p className="text-sm text-slate-500">
          Nenhuma particularidade registrada. Use pra combinados que mudam a forma de cobrar —
          emitir NF dentro do mês, avisar no WhatsApp, mandar Pix em vez de boleto.
        </p>
      )}
    </div>
  );
}
