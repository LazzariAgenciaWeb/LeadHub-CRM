"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Company {
  id: string;
  name: string;
  segment: string | null;
  status: string;
  hasSystemAccess: boolean;
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
  const [filter, setFilter] = useState<"all" | "access" | "crm" | "root" | "sub">("all");
  const [search, setSearch] = useState("");

  // Modal de transferência: mover empresa para outra empresa-mãe (parentCompanyId)
  const [transferTarget, setTransferTarget] = useState<Company | null>(null);
  const [newParentId, setNewParentId] = useState<string>("");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Modal de confirmação de deleção (SuperAdmin)
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/companies/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Falha ao deletar");
      }
      setDeleteTarget(null);
      router.refresh();
    } catch (err: any) {
      setDeleteError(err.message ?? "Erro inesperado");
    } finally {
      setDeleting(false);
    }
  }

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
    // Filtro de tipo
    if (filter === "access") { if (!c.hasSystemAccess) return false; }
    else if (filter === "crm") { if (c.hasSystemAccess) return false; }
    else if (filter === "root") { if (c.parentCompanyId !== null) return false; }
    else if (filter === "sub")  { if (c.parentCompanyId === null) return false; }

    // Busca por nome ou empresa-mãe
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
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

  const countAccess = companies.filter(c => c.hasSystemAccess).length;
  const countCrm    = companies.filter(c => !c.hasSystemAccess).length;
  const countRoot   = companies.filter(c => c.parentCompanyId === null).length;
  const countSub    = companies.filter(c => c.parentCompanyId !== null).length;

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

      {/* Busca + Filtros (apenas SUPER_ADMIN) */}
      {isSuperAdmin && (
        <div className="flex flex-col gap-3 mb-5">
          {/* Campo de busca */}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, segmento ou empresa-mãe…"
            className="w-full bg-[#0f1623] border border-[#1e2d45] text-white text-sm rounded-lg px-3 py-2 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"
          />

          {/* Filtros por tipo */}
          <div className="flex flex-wrap gap-2">
            {([
              ["all",    `Todas (${companies.length})`],
              ["root",   `🏢 Raiz (${countRoot})`],
              ["sub",    `↳ Sub-empresas (${countSub})`],
              ["access", `🔐 Com acesso (${countAccess})`],
              ["crm",    `📋 Só CRM (${countCrm})`],
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
          </div>
        </div>
      )}

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
                      <h2 className="text-white font-bold text-[15px] truncate">{company.name}</h2>
                    </div>
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

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-[#1e2d45]">
                  <Link
                    href={`/empresas/${company.id}`}
                    className="flex-1 text-center text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-xs font-semibold py-1.5 rounded-lg transition-colors"
                  >
                    Ver Detalhes
                  </Link>
                  {isSuperAdmin && (
                    <button
                      onClick={() => { setTransferTarget(company); setNewParentId(company.parentCompanyId ?? ""); setTransferError(null); }}
                      title="Transferir para outra empresa-mãe (admin)"
                      className="text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors"
                    >
                      ↗ Transferir
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button
                      onClick={() => { setDeleteTarget(company); setDeleteError(null); }}
                      title="Deletar esta empresa (apaga leads, mensagens, instâncias, etc.)"
                      className="text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors"
                    >
                      🗑️
                    </button>
                  )}
                  {isSuperAdmin && company.hasSystemAccess && (
                    /* <a> em vez de <Link>: navegação real para a API setar o cookie */
                    <a
                      href={`/api/admin/impersonate/${company.id}`}
                      title="Logar e usar o sistema como esta empresa"
                      className="flex-1 text-center text-white bg-gradient-to-r from-indigo-500 to-purple-600 text-xs font-semibold py-1.5 rounded-lg hover:opacity-90 transition-opacity"
                    >
                      👁 Visualizar como cliente
                    </a>
                  )}
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

      {/* Modal de Deleção (SuperAdmin) */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-[#0c1220] border border-red-500/40 rounded-2xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <div>
                <h2 className="text-red-400 font-bold text-base">🗑️ Deletar empresa</h2>
                <p className="text-slate-500 text-xs mt-0.5 truncate"><strong className="text-slate-300">{deleteTarget.name}</strong></p>
              </div>
              <button onClick={() => setDeleteTarget(null)} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-3 space-y-1">
                <p className="font-semibold">⚠️ Esta ação NÃO pode ser desfeita.</p>
                <p>Vai apagar todos os dados vinculados a esta empresa:</p>
                <ul className="list-disc list-inside space-y-0.5 text-red-300/80">
                  <li>{deleteTarget._count.leads} leads</li>
                  <li>{deleteTarget._count.campaigns} campanhas</li>
                  <li>{deleteTarget._count.whatsappInstances} instâncias WhatsApp</li>
                  <li>Mensagens, conversas, contatos, setores, tickets, etc.</li>
                </ul>
                {deleteTarget._count.subCompanies > 0 && (
                  <p className="mt-2 font-semibold text-amber-300">
                    🚫 Esta empresa tem {deleteTarget._count.subCompanies} sub-empresa(s).
                    Transfira-as para outra empresa-mãe antes de deletar.
                  </p>
                )}
              </div>

              {deleteError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">
                  {deleteError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleting || deleteTarget._count.subCompanies > 0}
                  className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                >
                  {deleting ? "Deletando..." : "Sim, deletar permanentemente"}
                </button>
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-sm transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
