"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Globe } from "lucide-react";

/**
 * Controle "Aberto / Restrito" pra chamados e projetos. Renderiza só o conteúdo
 * (sem card) — o chamador embrulha no card do contexto.
 *
 * Aberto    = toda a empresa vê.
 * Restrito  = só setor + pessoas extras (marcadas aqui) + envolvidos.
 * ADMIN/SUPER_ADMIN sempre veem, independente disso.
 */
export default function VisibilityControl({
  kind,
  id,
  visibility,
  accessUserIds,
  users,
}: {
  kind: "ticket" | "project";
  id: string;
  visibility: string;
  accessUserIds: string[];
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [vis, setVis] = useState(visibility === "RESTRICTED" ? "RESTRICTED" : "OPEN");
  const [ids, setIds] = useState<string[]>(accessUserIds);
  const [saving, setSaving] = useState(false);

  const endpoint = kind === "ticket" ? `/api/tickets/${id}` : `/api/projetos/${id}`;

  async function persist(nextVis: string, nextIds: string[]) {
    setSaving(true);
    try {
      await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: nextVis, accessUserIds: nextIds }),
      });
    } finally {
      setSaving(false);
      router.refresh();
    }
  }

  function changeVisibility(next: "OPEN" | "RESTRICTED") {
    if (next === vis) return;
    setVis(next);
    persist(next, ids);
  }

  function toggleUser(uid: string) {
    const next = ids.includes(uid) ? ids.filter((x) => x !== uid) : [...ids, uid];
    setIds(next);
    persist(vis, next);
  }

  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">
        🔒 Visibilidade
      </div>

      <div className="grid grid-cols-2 gap-1 bg-[#080b12] border border-[#1e2d45] rounded-lg p-1">
        <button
          type="button"
          onClick={() => changeVisibility("OPEN")}
          disabled={saving}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50 ${
            vis === "OPEN" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "text-slate-500 hover:text-white"
          }`}
        >
          <Globe className="w-3 h-3" /> Aberto
        </button>
        <button
          type="button"
          onClick={() => changeVisibility("RESTRICTED")}
          disabled={saving}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50 ${
            vis === "RESTRICTED" ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" : "text-slate-500 hover:text-white"
          }`}
        >
          <Lock className="w-3 h-3" /> Restrito
        </button>
      </div>

      {vis === "OPEN" ? (
        <p className="text-[10px] text-slate-600 mt-1.5">Toda a empresa vê.</p>
      ) : (
        <div className="mt-2">
          <p className="text-[10px] text-slate-500 mb-1.5">
            Veem: {kind === "project" ? "setor + membros" : "setor + responsável"} e quem você marcar abaixo. ADMIN sempre vê.
          </p>
          {users.length === 0 ? (
            <p className="text-[10px] text-slate-600">Nenhum usuário pra adicionar.</p>
          ) : (
            <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
              {users.map((u) => {
                const checked = ids.includes(u.id);
                return (
                  <label key={u.id} className="flex items-center gap-2 cursor-pointer text-[11px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleUser(u.id)}
                      disabled={saving}
                      className="w-3.5 h-3.5 rounded accent-amber-500"
                    />
                    <span className={checked ? "text-white" : "text-slate-400"}>{u.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
