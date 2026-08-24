"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, AlertTriangle, Check, Loader2, ArrowLeft, Users, Repeat, ExternalLink } from "lucide-react";
import FinanceiroTabs from "../FinanceiroTabs";
import { brlFromCents } from "../lib";

export interface RelatorioTela {
  totalTasks: number;
  encerradas: number;
  contratos: number;
  mrrCents: number;
  semValor: number;
  semDia: number;
  porCategoria: { categoria: string; n: number; cents: number }[];
  clientesExistentes: { clickup: string; empresaId: string; empresaNome: string; temCnpj: boolean }[];
  clientesNovos: { nome: string; parecidos: { id: string; nome: string }[] }[];
  nomesParecidos: [string, string][];
  servicos: { nome: string; n: number; noCatalogo: boolean }[];
  itens: {
    taskId: string; cliente: string; label: string;
    amountCents: number | null; billingCycle: string; billingDay: number | null;
    url: string | null;
  }[];
}

const card = "bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5";

export default function ImportarClickup({
  listaPadrao, incluirEncerrados: encerradosIniciais, temEmpresa, temToken, relatorio, erroServidor,
}: {
  listaPadrao: string;
  incluirEncerrados: boolean;
  temEmpresa: boolean;
  temToken: boolean;
  relatorio: RelatorioTela | null;
  erroServidor: string | null;
}) {
  const router = useRouter();
  const [listId, setListId] = useState(listaPadrao);
  const [incluirEncerrados, setIncluirEncerrados] = useState(encerradosIniciais);
  const [importando, setImportando] = useState(false);
  // Navegar pra um server component lento NÃO dá retorno visual nenhum: a tela
  // fica parada até o servidor responder, e parece que o clique não pegou.
  // useTransition expõe esse "estou indo" pra virar spinner no botão.
  const [navegando, iniciarPrevia] = useTransition();
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<{ criados: number; atualizados: number; clientesNovos: number; comCatalogo: number } | null>(null);

  const rel = relatorio;
  const bloqueado = !temEmpresa || !temToken;
  const semCnpj = rel ? rel.clientesExistentes.filter((c) => !c.temCnpj).length + rel.clientesNovos.length : 0;
  const comSugestao = rel ? rel.clientesNovos.filter((c) => c.parecidos.length > 0).length : 0;
  const foraDoCatalogo = rel ? rel.servicos.filter((sv) => !sv.noCatalogo).length : 0;
  const urlPrevia = `/financeiro/importar?previa=1&lista=${encodeURIComponent(listId)}${incluirEncerrados ? "&encerrados=1" : ""}`;

  /**
   * Só a gravação continua sendo requisição. A resposta é minúscula (três
   * contadores), diferente da prévia, que agora vem pronta do servidor.
   */
  async function importar() {
    setImportando(true);
    setErro("");
    try {
      const res = await fetch("/api/financeiro/importar-clickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId, incluirEncerrados, apply: true }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setErro(e.error ?? `O servidor respondeu ${res.status}.`);
        return;
      }
      const data = await res.json();
      setResultado(data.resultado);
      router.refresh();
    } catch (e) {
      const tempo = e instanceof DOMException && e.name === "TimeoutError";
      setErro(
        tempo
          ? "A importação passou de 3 minutos e foi interrompida."
          : `A conexão caiu durante a importação (${(e as Error).message}).`
      );
    } finally {
      setImportando(false);
    }
  }

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
            {/* Navegação (o relatório vem montado do servidor), mas disparada
                por botão em transition pra existir estado de "carregando". */}
            <button
              type="button"
              onClick={() => iniciarPrevia(() => router.push(urlPrevia))}
              disabled={navegando}
              className="px-4 py-2 rounded-lg border border-[#1e2d45] text-slate-200 hover:border-indigo-500 disabled:opacity-60 text-sm flex items-center gap-1.5"
            >
              {navegando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {navegando ? "Lendo o ClickUp…" : "Ver prévia"}
            </button>
          </div>
          <p className="text-xs text-slate-600 -mt-2">
            A prévia só lê o ClickUp. Nada é gravado até você confirmar.
            {navegando && " A leitura é paginada e pode levar alguns segundos."}
          </p>
        </>
      )}

      {(erro || erroServidor) && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-lg px-4 py-3 text-sm text-red-300">
          {erro || `Não foi possível ler o ClickUp: ${erroServidor}`}
        </div>
      )}

      {resultado && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-5 py-4">
          <div className="text-emerald-300 font-medium text-sm flex items-center gap-2">
            <Check className="w-4 h-4" /> Importação concluída
          </div>
          <p className="text-sm text-slate-300 mt-1">
            {resultado.criados} contrato(s) criado(s) · {resultado.atualizados} atualizado(s) ·{" "}
            {resultado.clientesNovos} cliente(s) novo(s) · {resultado.comCatalogo} vinculado(s) ao catálogo.
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
              <h2 className="text-white font-semibold text-sm mb-3">Serviços × catálogo</h2>
              <p className="text-xs text-slate-600 mb-3">
                O que casar com o Catálogo de Serviços entra vinculado; o resto entra como avulso —
                funciona igual, só não aparece organizado no painel do cliente.
              </p>
              <div className="space-y-1.5 mb-5">
                {rel.servicos.map((sv) => (
                  <div key={sv.nome} className="flex items-center justify-between gap-2 text-sm">
                    <span className={sv.noCatalogo ? "text-slate-300" : "text-amber-300"}>
                      {sv.nome}
                      {!sv.noCatalogo && <span className="text-[10px] text-amber-500/80 ml-1.5">fora do catálogo</span>}
                    </span>
                    <span className="text-slate-500 flex-shrink-0">{sv.n}</span>
                  </div>
                ))}
              </div>

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
                {foraDoCatalogo > 0 && (
                  <li className="flex gap-2 text-slate-400">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-600" />
                    <span>
                      <b>{foraDoCatalogo}</b> serviço(s) não existem no Catálogo de Serviços. Os contratos
                      entram como avulsos. Se quiser vinculados, crie no catálogo com o mesmo nome e
                      reimporte — a importação atualiza o que já existe.
                    </span>
                  </li>
                )}
                {comSugestao > 0 && (
                  <li className="flex gap-2 text-amber-300">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      <b>{comSugestao}</b> cliente(s) novo(s) parecem com empresa que já existe na sua
                      carteira. Veja em &ldquo;Serão criados&rdquo; — importar assim cria cadastro duplicado.
                    </span>
                  </li>
                )}
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
                {semCnpj === 0 && rel.semValor === 0 && rel.nomesParecidos.length === 0 && comSugestao === 0 && foraDoCatalogo === 0 && (
                  <li className="text-slate-500">Nada pendente. Pode importar.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Já cadastrados: dá pra abrir cada um e conferir antes de gravar. */}
            <div className={card}>
              <h2 className="text-white font-semibold text-sm mb-1">
                Já cadastrados no sistema ({rel.clientesExistentes.length})
              </h2>
              <p className="text-xs text-slate-600 mb-3">
                Casaram pelo nome. Os contratos entram no cadastro que já existe — nada é duplicado.
              </p>
              {rel.clientesExistentes.length === 0 ? (
                <p className="text-slate-600 text-sm py-4">Nenhum casou pelo nome exato.</p>
              ) : (
                <div className="space-y-1 max-h-[260px] overflow-y-auto">
                  {rel.clientesExistentes.map((c) => (
                    <Link
                      key={c.empresaId}
                      href={`/empresas/${c.empresaId}`}
                      target="_blank"
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.03] group"
                    >
                      <span className="text-sm text-slate-300 truncate">{c.clickup}</span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        {!c.temCnpj && <span className="text-[10px] text-amber-500/80">sem CNPJ</span>}
                        <ExternalLink className="w-3 h-3 text-slate-700 group-hover:text-indigo-400" />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Novos: com os candidatos parecidos que já existem na carteira. */}
            <div className={card}>
              <h2 className="text-white font-semibold text-sm mb-1">
                Serão criados ({rel.clientesNovos.length})
              </h2>
              <p className="text-xs text-slate-600 mb-3">
                Onde aparecer <span className="text-amber-400">parece com</span>, confira: se for a mesma
                empresa, renomeie no ClickUp para bater com o cadastro e rode a prévia de novo.
              </p>
              {rel.clientesNovos.length === 0 ? (
                <p className="text-slate-600 text-sm py-4">Nenhum cliente novo — todos já existem.</p>
              ) : (
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                  {rel.clientesNovos.map((c) => (
                    <div key={c.nome} className="px-2.5 py-1.5 rounded-lg bg-white/[0.02]">
                      <div className="text-sm text-slate-300">{c.nome}</div>
                      {c.parecidos.length > 0 && (
                        <div className="mt-0.5 text-xs text-amber-400/90 flex flex-wrap items-center gap-1">
                          parece com
                          {c.parecidos.map((p) => (
                            <Link
                              key={p.id}
                              href={`/empresas/${p.id}`}
                              target="_blank"
                              className="underline decoration-dotted hover:text-amber-300"
                            >
                              {p.nome}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={card}>
            <h2 className="text-white font-semibold text-sm mb-3">Contratos ({rel.itens.length})</h2>
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase text-slate-600 sticky top-0 bg-[#0f1623]">
                  <tr>
                    <th className="text-left font-medium py-1.5">Cliente</th>
                    <th className="text-left font-medium">Contrato</th>
                    <th className="text-left font-medium pr-3">Site</th>
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
                      <td className="pr-3 max-w-[220px] truncate">
                        {i.url ? (
                          <a href={i.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300">
                            {i.url.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
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
              type="button"
              onClick={importar}
              disabled={importando}
              className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-2"
            >
              {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
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
