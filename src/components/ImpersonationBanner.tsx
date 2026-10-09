"use client";

import { useEffect, useState } from "react";
import { ChevronDown, UserCheck, ArrowLeftRight } from "lucide-react";

type CompanyUser = { id: string; name: string; email: string; role: string };
type Company = { id: string; name: string; hasSystemAccess?: boolean };

/**
 * Banner da impersonação. Além do "Voltar ao admin", permite escolher a conta
 * vinculada ("Agindo como"): o usuário desta empresa que É o super admin. Com
 * vínculo, tudo que ele faz dentro do cliente sai no nome desse usuário.
 */
export default function ImpersonationBanner({
  companyName,
  actingAs,
}: {
  companyName: string;
  actingAs: { userId: string; name: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<CompanyUser[] | null>(null);
  const [saving, setSaving] = useState(false);
  // Trocar cliente — única forma de mudar de empresa enquanto impersona
  const [switchOpen, setSwitchOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companySearch, setCompanySearch] = useState("");

  useEffect(() => {
    if (!switchOpen || companies) return;
    fetch("/api/admin/impersonatable-companies")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCompanies(Array.isArray(d) ? d : []))
      .catch(() => setCompanies([]));
  }, [switchOpen, companies]);

  function switchTo(companyId: string) {
    const returnTo = window.location.pathname;
    window.location.assign(`/api/admin/impersonate/${companyId}?returnTo=${encodeURIComponent(returnTo)}`);
  }

  useEffect(() => {
    if (!open || users) return;
    fetch("/api/admin/impersonate/act-as")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setUsers(d.users ?? []))
      .catch(() => setUsers([]));
  }, [open, users]);

  async function choose(userId: string | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/impersonate/act-as", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) window.location.reload();
      else setSaving(false);
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between flex-shrink-0 relative">
      <div className="flex items-center gap-3 text-amber-300 text-xs font-medium min-w-0">
        <span>👁</span>
        <span className="truncate">Visualizando como cliente: <strong>{companyName}</strong></span>
        <span className="text-amber-500/50">·</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-amber-200 hover:text-white transition-colors"
          title="Escolher com qual usuário desta empresa você age (mensagens, atribuições e pontos saem no nome dele)"
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>
            Agindo como: <strong>{actingAs ? actingAs.name : "super admin (só observando)"}</strong>
          </span>
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setSwitchOpen((v) => !v)}
          className="flex items-center gap-1 text-amber-300 text-xs font-semibold hover:text-amber-100 border border-amber-500/40 rounded px-2 py-0.5 transition-colors"
        >
          <ArrowLeftRight className="w-3 h-3" />
          Trocar cliente
        </button>
        {/* <a> em vez de <Link>: rotas de API precisam de navegação real do browser
            para o redirect HTTP funcionar e setar/limpar o cookie de impersonação */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/admin/impersonate/exit"
          className="text-amber-400 text-xs font-semibold hover:text-amber-200 border border-amber-500/40 rounded px-2 py-0.5 transition-colors"
        >
          ← Voltar ao admin
        </a>
      </div>

      {switchOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSwitchOpen(false)} />
          <div className="absolute right-4 top-full mt-1 z-50 w-72 bg-[#0c1220] border border-[#1e2d45] rounded-xl shadow-2xl overflow-hidden">
            <div className="p-2 border-b border-[#1e2d45]">
              <input
                autoFocus
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Buscar cliente..."
                className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {companies === null && <p className="px-3 py-2 text-[11px] text-slate-600">Carregando...</p>}
              {companies
                ?.filter((c) => c.hasSystemAccess !== false)
                .filter((c) => c.name.toLowerCase().includes(companySearch.toLowerCase()))
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => switchTo(c.id)}
                    className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-white/5 truncate"
                  >
                    {c.name}
                  </button>
                ))}
              {companies && companies.length === 0 && <p className="px-3 py-2 text-[11px] text-slate-600">Nenhuma empresa.</p>}
            </div>
          </div>
        </>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-4 top-full mt-1 z-50 w-80 bg-[#0c1220] border border-[#1e2d45] rounded-xl shadow-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-[#1e2d45]">
              <p className="text-[11px] text-slate-400">
                Vincule o usuário desta empresa que é <strong className="text-slate-200">você</strong>. Fica salvo: toda vez
                que entrar neste cliente, você já age como ele.
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              <button
                disabled={saving}
                onClick={() => choose(null)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-white/5 ${!actingAs ? "text-amber-300" : "text-slate-400"}`}
              >
                Só observar (identidade do super admin)
              </button>
              {users === null && <p className="px-3 py-2 text-[11px] text-slate-600">Carregando...</p>}
              {users?.length === 0 && <p className="px-3 py-2 text-[11px] text-slate-600">Esta empresa não tem usuários.</p>}
              {users?.map((u) => (
                <button
                  key={u.id}
                  disabled={saving}
                  onClick={() => choose(u.id)}
                  className={`w-full text-left px-3 py-2 hover:bg-white/5 ${actingAs?.userId === u.id ? "bg-amber-500/10" : ""}`}
                >
                  <p className={`text-xs font-medium ${actingAs?.userId === u.id ? "text-amber-300" : "text-slate-200"}`}>{u.name}</p>
                  <p className="text-[10px] text-slate-600 truncate">{u.email} · {u.role}</p>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
