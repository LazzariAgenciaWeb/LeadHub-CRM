"use client";

import { useMemo, useState } from "react";
import { Building2, Search } from "lucide-react";

type Company = { id: string; name: string; parentName: string | null };

export default function SuperAdminCompanyPicker({ companies }: { companies: Company[] }) {
  const [q, setQ] = useState("");
  const [going, setGoing] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(t) || c.parentName?.toLowerCase().includes(t));
  }, [companies, q]);

  function choose(id: string) {
    setGoing(id);
    // Rota de API precisa de navegação real (redirect HTTP seta o cookie).
    // returnTo = esta mesma tela, já impersonando o cliente escolhido.
    const returnTo = window.location.pathname + window.location.search;
    window.location.assign(`/api/admin/impersonate/${id}?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return (
    <div className="max-w-xl">
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente..."
          className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60"
        />
      </div>
      <div className="bg-[#0c1220] border border-[#1e2d45] rounded-2xl overflow-hidden divide-y divide-[#1e2d45] max-h-[60vh] overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-slate-600 text-xs py-6 text-center">Nenhum cliente encontrado.</p>
        )}
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => choose(c.id)}
            disabled={!!going}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-4 h-4 text-indigo-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-200 font-medium truncate">{c.name}</p>
              {c.parentName && <p className="text-[11px] text-slate-600 truncate">Cliente de {c.parentName}</p>}
            </div>
            <span className="text-[11px] text-indigo-300 font-semibold">{going === c.id ? "Entrando..." : "Acessar →"}</span>
          </button>
        ))}
      </div>
      <p className="text-slate-600 text-[11px] mt-3">
        Você entra como ADMIN do cliente. Para voltar ao super admin, use &quot;Voltar ao admin&quot; no aviso do topo.
      </p>
    </div>
  );
}
