"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, AlertTriangle, Check, Loader2, ArrowLeft, Users, Repeat } from "lucide-react";
import FinanceiroTabs from "../FinanceiroTabs";
import { brlFromCents } from "../lib";

interface Relatorio {
  totalTasks: number;
  encerradas: number;
  contratos: number;
  mrrCents: number;
  semValor: number;
  semDia: number;
  porCategoria: { categoria: string; n: number; cents: number }[];
  clientesExistentes: { nome: string; temCnpj: boolean }[];
  clientesNovos: string[];
  nomesParecidos: [string, string][];
  itens: {
    taskId: string; codigo: string; taskUrl: string; cliente: string; label: string;
    amountCents: number | null; billingCycle: string; billingDay: number | null; categoria: string;
  }[];
}

const card = "bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5";

export default function ImportarClickup({
  listaPadrao, temEmpresa, temToken,
}: {
  listaPadrao: string; temEmpresa: boolean; temToken: boolean;
}) {
  const router = useRouter();
  const [listId, setListId] = useState(listaPadrao);
  const [incluirEncerrados, setIncluirEncerrados] = useState(false);
  const [carregando, setCarregando] = useState<"previa" | "aplicar" | null>(null);
  const [erro, setErro] = useState("");
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [resultado, setResultado] = useState<{ criados: number; atualizados: number; clientesNovos: number } | null>(null);

  async function chamar(apply: boolean) {
    setCarregando(apply ? "aplicar" : "previa");
    setErro("");
    if (!apply) setResultado(null);
    const res = await fetch("/api/financeiro/importar-clickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listId, incluirEncerrados, apply }),
    });
    setCarregando(null);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErro(e.error ?? "Falha ao falar com o ClickUp.");
      return;
    }
    const data = await res.json();
    setRel(data.relatorio);
    if (data.aplicado) { setResultado(data.resultado); router.refresh(); }
  }

  const bloqueado = !temEmpresa || !temToken;
  const semCnpj = rel ? rel.clientesExistentes.filter((c) => !c.temCnpj).length + rel.clientesNovos.length : 0;

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      <div>
        <h1 className="text-white font-bold text-xl flex items-center gap-2">
          <Download className="w-5 h-5 text-indigo-400" />
          Importar contratos do ClickUp
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Traz a lista de contratos mensais para os contratos do Financeiro, criando os clientes que faltarem.
        </p>
      </div>

      <FinanceiroTabs />

      {bloqueado ? (
        <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl px-5 py-4 text-sm text-amber-200">
          {!temEmpresa
            ? "Esta sessão não está vinculada a uma empresa. Entre com a conta da agência dona da carteira."
            : "Token do ClickUp não configurado para esta empresa — configure em Configurações → Integrações."}
        </div>
      ) : (
        <>
          <div className={`${card} flex items-end gap-4 flex-wrap`}>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">ID da lista no ClickUp</span>
              <input
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 w-[200px]"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400 pb-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={incluirEncerrados}
                onChange={(e) => setIncluirEncerrados(e.target.checked)}
                className="accent-indigo-500"
              />
              Incluir encerrados
            </label>
            <button
              onClick={() => chamar(false)}
              disabled={carregando !== null}
              className="px-4 py-2 rounded-lg border border-[#1e2d45] text-slate-200 hover:border-indigo-500 disabled:opacity-50 text-sm flex items-center gap-1.5"
            >
              {carregando === "previa" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Ver prévia
            </button>
          </div>

          {/* A prévia não grava nada. Existe porque casar cliente por nome erra,
              e errar aqui cria empresa duplicada — chato de desfazer depois. */}
          <p className="text-xs text-slate-600 -mt-2">
            A prévia só lê o ClickUp. Nada é gravado até você confirmar.
          </p>
        </>
      )}

      {erro && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-lg px-4 py-3 text-sm text-red-300">
          {erro}
        </div>
      )}

      {resultado && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-5 py-4">
          <div className="text-emerald-300 font-medium text-sm flex items-center gap-2">
            <Check className="w-4 h-4" /> Importação concluída
          </div>
          <p className="text-sm text-slate-300 mt-1">
            {resultado.criados} contrato(s) criado(s) · {resultado.atualizados} atualizado(s) ·{" "}
            {resultado.clientesNovos} cliente(s) novo(s).
          </p>
          <Link href="/financeiro" className="text-indigo-400 hover:text-indigo-300 text-sm mt-2 inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Ver a previsão do mês
          </Link>
        </div>
      )}

      {rel && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={card}>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Contratos</div>
              <div className="text-2xl font-bold text-white mt-1">{rel.contratos}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                de {rel.totalTasks} tasks · {rel.encerradas} encerrada(s) fora
              </div>
            </div>
            <div className={card}>
              <div className="text-xs text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Repeat className="w-3.5 h-3.5" /> Recorrência mensal
              </div>
              <div className="text-2xl font-bold text-indigo-400 mt-1">{brlFromCents(rel.mrrCents)}</div>
              <div className="text-xs text-slate-500 mt-0.5">anual entra rateado</div>
            </div>
            <div className={card}>
              <div className="text-xs text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Clientes
              </div>
              <div className="text-2xl font-bold text-white mt-1">
                {rel.clientesExistentes.length + rel.clientesNovos.length}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {rel.clientesExistentes.length} já existem · {rel.clientesNovos.length} novos
              </div>
            </div>
            <div className={card}>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Sem valor</div>
              <div className={`text-2xl font-bold mt-1 ${rel.semValor > 0 ? "text-amber-400" : "text-slate-600"}`}>
                {rel.semValor}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{rel.semDia} sem dia de vencimento</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className={card}>
              <h2 className="text-white font-semibold text-sm mb-3">Por categoria</h2>
              <div className="space-y-1.5">
                {rel.porCategoria.map((c) => (
                  <div key={c.categoria} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300 capitalize">{c.categoria}</span>
                    <span className="text-slate-500">
                      {c.n} × <b className="text-emerald-400 font-medium">{brlFromCents(c.cents)}</b>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className={card}>
              <h2 className="text-white font-semibold text-sm mb-3">O que precisa de atenção</h2>
              <ul className="space-y-2 text-sm">
                {semCnpj > 0 && (
                  <li className="flex gap-2 text-amber-300">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      <b>{semCnpj}</b> cliente(s) ficarão sem CNPJ. É a chave que liga o cadastro ao Bling —
                      sem ela o sync futuro duplica empresa.
                    </span>
                  </li>
                )}
                {rel.semValor > 0 && (
                  <li className="flex gap-2 text-amber-300">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span><b>{rel.semValor}</b> contrato(s) sem valor — não entram na previsão até você preencher.</span>
                  </li>
                )}
                {rel.nomesParecidos.length > 0 && (
                  <li className="flex gap-2 text-amber-300">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <b>{rel.nomesParecidos.length}</b> par(es) de nome parecido — confira se é a mesma empresa:
                      <div className="mt-1 space-y-0.5 text-xs text-slate-400">
                        {rel.nomesParecidos.slice(0, 8).map(([a, b]) => (
                          <div key={a + b}>{a} <span className="text-slate-600">~</span> {b}</div>
                        ))}
                      </div>
                    </div>
                  </li>
                )}
                {semCnpj === 0 && rel.semValor === 0 && rel.nomesParecidos.length === 0 && (
                  <li className="text-slate-500">Nada pendente. Pode importar.</li>
                )}
              </ul>
            </div>
          </div>

          {rel.clientesNovos.length > 0 && (
            <div className={card}>
              <h2 className="text-white font-semibold text-sm mb-1">
                Clientes que serão criados ({rel.clientesNovos.length})
              </h2>
              <p className="text-xs text-slate-600 mb-3">
                Se algum destes já existe com outro nome, ajuste no ClickUp antes de importar — depois vira empresa duplicada.
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-[200px] overflow-y-auto">
                {rel.clientesNovos.map((n) => (
                  <span key={n} className="text-xs px-2 py-1 rounded bg-white/5 text-slate-300">{n}</span>
                ))}
              </div>
            </div>
          )}

          <div className={card}>
            <h2 className="text-white font-semibold text-sm mb-3">Contratos ({rel.itens.length})</h2>
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase text-slate-600 sticky top-0 bg-[#0f1623]">
                  <tr>
                    <th className="text-left font-medium py-1.5">Cliente</th>
                    <th className="text-left font-medium">Contrato</th>
                    <th className="text-right font-medium">Valor</th>
                    <th className="text-center font-medium">Dia</th>
                    <th className="text-left font-medium pl-3">Ciclo</th>
                  </tr>
                </thead>
                <tbody>
                  {rel.itens.map((i) => (
                    <tr key={i.taskId} className="border-t border-[#1e2d45]/60">
                      <td className="py-1.5 text-slate-200 pr-3">{i.cliente}</td>
                      <td className="text-slate-500 pr-3">{i.label}</td>
                      <td className={`text-right ${i.amountCents ? "text-emerald-400" : "text-amber-500"}`}>
                        {i.amountCents ? brlFromCents(i.amountCents) : "sem valor"}
                      </td>
                      <td className="text-center text-slate-500">{i.billingDay ?? "—"}</td>
                      <td className="text-slate-600 pl-3">{i.billingCycle === "ANUAL" ? "Anual" : "Mensal"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3 pb-4">
            <button
              onClick={() => chamar(true)}
              disabled={carregando !== null}
              className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-2"
            >
              {carregando === "aplicar" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Importar {rel.contratos} contrato(s)
            </button>
            <span className="text-xs text-slate-600">
              Pode rodar de novo quando quiser: contrato já importado é atualizado, não duplicado.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
