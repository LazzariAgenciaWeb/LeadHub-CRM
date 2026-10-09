"use client";

import { useEffect, useState } from "react";
import { ChevronDown, UserCheck } from "lucide-react";

type CompanyUser = { id: string; name: string; email: string; role: string };

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
      {/* <a> em vez de <Link>: rotas de API precisam de navegação real do browser
          para o redirect HTTP funcionar e setar/limpar o cookie de impersonação */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/api/admin/impersonate/exit"
        className="text-amber-400 text-xs font-semibold hover:text-amber-200 border border-amber-500/40 rounded px-2 py-0.5 transition-colors flex-shrink-0"
      >
        ← Voltar ao admin
      </a>

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
