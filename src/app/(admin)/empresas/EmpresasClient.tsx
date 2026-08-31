"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DeleteMergeModal from "./DeleteMergeModal";

interface Company {
  id: string;
  name: string;
  /** Nome fantasia — como o cliente é chamado no dia a dia. */
  tradeName?: string | null;
  segment: string | null;
  status: string;
  hasSystemAccess: boolean;
  fullSystemAccess: boolean;
  moduleWhatsapp: boolean;
  moduleCrm: boolean;
  moduleTickets: boolean;
  parentCompanyId: string | null;
  parentCompany: { id: string; name: string } | null;
  _count: { leads: number; campaigns: number; whatsappInstances: number; subCompanies: number };
}

interface Props {
  companies: Company[];
  isSuperAdmin: boolean;
  parentCompanyName: string | null;
}

const PINNED_KEY = "pinned_company_ids";
function getPinned(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]"); } catch { return []; }
}
function setPinned(ids: string[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}

export default function EmpresasClient({ companies, isSuperAdmin, parentCompanyName }: Props) {
  const router = useRouter();
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  // Filtros por NÍVEL DE ACESSO (o que a empresa tem) + HIERARQUIA (quem gerencia).
  const [filter, setFilter] = useState<"all" | "sistema" | "espaco" | "crm" | "diretas" | "agencias">("all");
  const [search, setSearch] = useState("");
  // Menu "⋯" por cartão (Transferir / Excluir ficam aqui em vez de soltos).
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // Modal de transferência: mover empresa para outra empresa-mãe (parentCompanyId)
  const [transferTarget, setTransferTarget] = useState<Company | null>(null);
  const [newParentId, setNewParentId] = useState<string>("");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Empresa selecionada pra deletar ou mesclar. O modal compartilhado cuida do resto.
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);

  useEffect(() => { setPinnedIds(getPinned()); }, []);

  // Empresas elegíveis para serem "mãe": todas com hasSystemAccess (= têm admin que vai gerenciar).
  // Não pode escolher a própria empresa nem suas próprias subs.
  function eligibleParents(forCompany: Company): Company[] {
    return companies.filter((c) =>
      c.hasSystemAccess &&
      c.id !== forCompany.id &&
      c.parentCompanyId !== forCompany.id // evita ciclo direto
    );
  }

  async function handleTransferConfirm() {
    if (!transferTarget) return;
    setTransferring(true);
    setTransferError(null);
    try {
      const res = await fetch(`/api/companies/${transferTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCompanyId: newParentId || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Falha ao transferir");
      }
      setTransferTarget(null);
      setNewParentId("");
      router.refresh();
    } catch (err: any) {
      setTransferError(err.message ?? "Erro inesperado");
    } finally {
      setTransferring(false);
    }
  }

  function togglePin(id: string) {
    const next = pinnedIds.includes(id) ? pinnedIds.filter(p => p !== id) : [id, ...pinnedIds];
    setPinnedIds(next);
    setPinned(next);
  }

  const filtered = companies.filter(c => {
    // Nível de acesso: sistema completo | só Meu Espaço (login sem sistema) | só CRM.
    if (filter === "sistema")       { if (!(c.hasSystemAccess && c.fullSystemAccess)) return false; }
    else if (filter === "espaco")   { if (!(c.hasSystemAccess && !c.fullSystemAccess)) return false; }
    else if (filter === "crm")      { if (c.hasSystemAccess) return false; }
    // Hierarquia: diretas (sem mãe, geridas por você) | de agências (sub-empresas).
    else if (filter === "diretas")  { if (c.parentCompanyId !== null) return false; }
    else if (filter === "agencias") { if (c.parentCompanyId === null) return false; }

    // Busca por nome ou empresa-mãe
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        // Fantasia entra na busca: quem procura raramente lembra a razão social.
        (c.tradeName ?? "").toLowerCase().includes(q) ||
        (c.segment ?? "").toLowerCase().includes(q) ||
        (c.parentCompany?.name ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const ap = pinnedIds.includes(a.id) ? 0 : 1;
    const bp = pinnedIds.includes(b.id) ? 0 : 1;
    return ap - bp;
  });

  const countSistema  = companies.filter(c => c.hasSystemAccess && c.fullSystemAccess).length;
  const countEspaco   = companies.filter(c => c.hasSystemAccess && !c.fullSystemAccess).length;
  const countCrm      = companies.filter(c => !c.hasSystemAccess).length;
  const countDiretas  = companies.filter(c => c.parentCompanyId === null).length;
  const countAgencias = companies.filter(c => c.parentCompanyId !== null).length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-white font-bold text-xl">
            {isSuperAdmin ? "Empresas" : "Meus Clientes"}
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {isSuperAdmin
              ? `${filtered.length} de ${companies.length} empresa${companies.length !== 1 ? "s" : ""}`
              : `Clientes cadastrados${parentCompanyName ? ` por ${parentCompanyName}` : ""}`}
            {pinnedIds.length > 0 && (
              <span className="ml-2 text-yellow-500/70 text-xs">📌 {pinnedIds.length} fixada{pinnedIds.length !== 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        <Link
          href="/empresas/nova"
          className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          + {isSuperAdmin ? "Nova Empresa" : "Novo Cliente"}
        </Link>
      </div>

      {/* Busca (todos) + Filtros por tipo (apenas SUPER_ADMIN) */}
      <div className="flex flex-col gap-3 mb-5">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={isSuperAdmin
            ? "Buscar por nome, segmento ou empresa-mãe…"
            : "Buscar por nome ou segmento…"}
          className="w-full bg-[#0f1623] border border-[#1e2d45] text-white text-sm rounded-lg px-3 py-2 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"
        />

        {isSuperAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Eixo 1: por nível de acesso (o que a empresa tem) */}
            {([
              ["all",     `Todas (${companies.length})`],
              ["sistema", `💻 Com sistema (${countSistema})`],
              ["espaco",  `🏠 Só Meu Espaço (${countEspaco})`],
              ["crm",     `📋 Só CRM (${countCrm})`],
            ] as const).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  filter === f
                    ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300"
                    : "border-[#1e2d45] text-slate-500 hover:text-slate-300 hover:border-slate-600"
                }`}
              >
                {label}
              </button>
            ))}

            {/* Divisor entre os eixos */}
            <span className="w-px h-5 bg-[#1e2d45] mx-1" aria-hidden="true" />

            {/* Eixo 2: por hierarquia (quem gerencia) */}
            {([
              ["diretas",  `🏢 Diretas (${countDiretas})`],
              ["agencias", `↳ De agências (${countAgencias})`],
            ] as const).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                title={f === "diretas"
                  ? "Empresas sem empresa-mãe — geridas direto por você"
                  : "Clientes cadastrados por uma agência-cliente (sub-empresas)"}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  filter === f
                    ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300"
                    : "border-[#1e2d45] text-slate-500 hover:text-slate-300 hover:border-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">{isSuperAdmin ? "🏢" : "👥"}</div>
          <div className="text-white font-semibold mb-1">
            {filter !== "all"
              ? "Nenhuma empresa nesta categoria"
              : isSuperAdmin
              ? "Nenhuma empresa cadastrada"
              : "Nenhum cliente cadastrado ainda"}
          </div>
          <div className="text-slate-500 text-sm mb-4">
            {isSuperAdmin
              ? "Cadastre sua primeira empresa para começar"
              : "Adicione os clientes da sua empresa"}
          </div>
          <Link
            href="/empresas/nova"
            className="inline-block bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            + {isSuperAdmin ? "Nova Empresa" : "Novo Cliente"}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((company) => {
            const isPinned = pinnedIds.includes(company.id);
            return (
              <div
                key={company.id}
                className={`bg-[#0f1623] border rounded-xl p-5 hover:border-indigo-500/50 transition-colors group relative ${
                  isPinned ? "border-yellow-500/40 shadow-[0_0_0_1px_rgba(234,179,8,0.1)]" : "border-[#1e2d45]"
                }`}
              >
                {/* Pin button */}
                {isSuperAdmin && (
                  <button
                    onClick={() => togglePin(company.id)}
                    title={isPinned ? "Desafixar" : "Fixar no topo"}
                    className={`absolute top-3 right-3 text-sm transition-all ${
                      isPinned ? "text-yellow-400 opacity-100" : "text-slate-700 opacity-0 group-hover:opacity-100 hover:text-yellow-400"
                    }`}
                  >
                    📌
                  </button>
                )}

                {/* Nome + badge de acesso */}
                <div className="flex items-start justify-between mb-3 pr-6">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isPinned && <span className="text-yellow-500 text-[10px]">📌</span>}
                      {/* Fantasia na frente quando existe: é como o cliente é
                          chamado. A razão social fica logo abaixo, porque é
                          ela que casa com nota fiscal e com o Bling. */}
                      <h2 className="text-white font-bold text-[15px] truncate">
                        {company.tradeName || company.name}
                      </h2>
                    </div>
                    {company.tradeName && company.tradeName !== company.name && (
                      <p className="text-slate-500 text-[11px] truncate">{company.name}</p>
                    )}
                    <p className="text-slate-500 text-xs mt-0.5">{company.segment ?? "Sem segmento"}</p>
                    {/* Tag de empresa-mãe */}
                    {company.parentCompany && (
                      <p className="text-amber-400/80 text-[10px] mt-1 font-medium">
                        ↳ Sub de: {company.parentCompany.name}
                      </p>
                    )}
                  </div>
                  <span
                    className={`ml-2 shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      company.status === "ACTIVE"
                        ? "text-green-400 bg-green-500/10 border-green-500/20"
                        : "text-slate-400 bg-slate-500/10 border-slate-500/20"
                    }`}
                  >
                    {company.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </span>
                </div>

                {/* Badge de tipo (acesso ao sistema ou só CRM) */}
                {isSuperAdmin && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {company.hasSystemAccess ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">
                        🔐 Acesso ao sistema
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/20 text-slate-400">
                        📋 Só CRM
                      </span>
                    )}
                    {company.hasSystemAccess && (
                      <>
                        {company.moduleWhatsapp && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
                            WhatsApp
                          </span>
                        )}
                        {company.moduleCrm && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
                            CRM
                          </span>
                        )}
                        {company.moduleTickets && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400">
                            Chamados
                          </span>
                        )}
                        {(company as any).moduleAI && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
                            IA
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                    <div className="text-white font-bold text-lg">{company._count.leads}</div>
                    <div className="text-slate-500 text-[10px]">Leads</div>
                  </div>
                  <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                    <div className="text-white font-bold text-lg">{company._count.subCompanies}</div>
                    <div className="text-slate-500 text-[10px]">Clientes</div>
                  </div>
                  <div className="bg-[#161f30] rounded-lg p-2.5 text-center">
                    <div className={`font-bold text-lg ${company._count.whatsappInstances > 0 ? "text-green-400" : "text-slate-500"}`}>
                      {company._count.whatsappInstances > 0 ? "✓" : "—"}
                    </div>
                    <div className="text-slate-500 text-[10px]">WhatsApp</div>
                  </div>
                </div>

                {/* Actions — principal + Detalhes + menu "⋯" (Transferir/Excluir) */}
                <div className="flex gap-2 pt-3 border-t border-[#1e2d45] items-stretch">
                  {isSuperAdmin && company.hasSystemAccess && (
                    /* <a> em vez de <Link>: navegação real para a API setar o cookie */
                    <a
                      href={`/api/admin/impersonate/${company.id}`}
                      title="Logar e usar o sistema como esta empresa"
                      className="flex-1 flex items-center justify-center gap-1 text-white bg-gradient-to-r from-indigo-500 to-purple-600 text-xs font-semibold py-1.5 rounded-lg hover:opacity-90 transition-opacity"
                    >
                      👁 Ver como cliente
                    </a>
                  )}
                  <Link
                    href={`/empresas/${company.id}`}
                    className="flex-1 flex items-center justify-center text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-xs font-semibold py-1.5 rounded-lg transition-colors"
                  >
                    Detalhes
                  </Link>

                  {/* Menu ⋯ — ações secundárias ficam aqui, não soltas */}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === company.id ? null : company.id); }}
                      title="Mais ações"
                      aria-label="Mais ações"
                      className="h-full px-2.5 flex items-center text-slate-400 bg-white/[0.03] hover:bg-white/[0.08] border border-[#1e2d45] rounded-lg transition-colors"
                    >
                      ⋯
                    </button>
                    {menuOpenId === company.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                        <div className="absolute right-0 bottom-full mb-1 z-20 w-44 bg-[#0c1220] border border-[#1e2d45] rounded-xl shadow-xl overflow-hidden py-1">
                          {isSuperAdmin && (
                            <button
                              onClick={() => { setMenuOpenId(null); setTransferTarget(company); setNewParentId(company.parentCompanyId ?? ""); setTransferError(null); }}
                              className="w-full text-left px-3 py-2 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors"
                            >
                              ↗ Transferir empresa
                            </button>
                          )}
                          {/* ADMIN também pode deletar/mesclar — a lista só traz subs dele, então é seguro */}
                          <button
                            onClick={() => { setMenuOpenId(null); setDeleteTarget(company); }}
                            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            🗑️ Excluir / mesclar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Transferência (SuperAdmin) */}
      {transferTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setTransferTarget(null)} />
          <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-base">↗ Transferir empresa</h2>
                <p className="text-slate-500 text-xs mt-0.5 truncate">
                  <strong className="text-slate-300">{transferTarget.name}</strong> {transferTarget.parentCompany ? `· hoje sub de ${transferTarget.parentCompany.name}` : "· hoje no nível raiz"}
                </p>
              </div>
              <button onClick={() => setTransferTarget(null)} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">Nova empresa-mãe (admin que vai gerenciar)</label>
                <select
                  value={newParentId}
                  onChange={(e) => setNewParentId(e.target.value)}
                  className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— Sem empresa-mãe (nível raiz, gerenciado por SuperAdmin) —</option>
                  {eligibleParents(transferTarget).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p className="text-slate-600 text-[10px] mt-1.5">
                  A empresa vai aparecer como sub-empresa do admin selecionado, que passa a poder gerenciá-la.
                  Leads, instâncias e histórico permanecem intactos.
                </p>
              </div>

              {transferError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">
                  {transferError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleTransferConfirm}
                  disabled={transferring}
                  className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {transferring ? "Transferindo..." : "Confirmar transferência"}
                </button>
                <button
                  onClick={() => setTransferTarget(null)}
                  className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-sm transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Deleção / Mesclagem — componente compartilhado com a página de detalhe */}
      {deleteTarget && (
        <DeleteMergeModal
          target={deleteTarget}
          eligibleTargets={companies
            .filter((c) => c.id !== deleteTarget.id)
            .map((c) => ({ id: c.id, name: c.name }))}
          open={true}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => router.refresh()}
          onMerged={() => router.refresh()}
        />
      )}
    </div>
  );
}
