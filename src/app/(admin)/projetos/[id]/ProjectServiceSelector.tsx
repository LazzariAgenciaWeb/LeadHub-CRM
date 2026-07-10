"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";

// Vincula o projeto a um serviço do catálogo. Ao vincular, o projeto passa a
// contar como serviço contratado do cliente (sem cadastrar em 2 lugares).
export default function ProjectServiceSelector({
  projectId, currentServiceId, services,
}: {
  projectId: string;
  currentServiceId: string | null;
  services: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentServiceId ?? "");
  const [saving, setSaving] = useState(false);

  async function change(v: string) {
    setValue(v);
    setSaving(true);
    await fetch(`/api/projetos/${projectId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ serviceId: v || null }),
    }).catch(() => {});
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
      <span className="text-slate-500 text-xs uppercase tracking-wider flex items-center gap-1.5">
        <Tag className="w-3.5 h-3.5 text-indigo-400" strokeWidth={2.25} /> Serviço (catálogo)
      </span>
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        className="w-full mt-2 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
      >
        <option value="">— nenhum —</option>
        {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <p className="text-slate-600 text-[11px] mt-1.5">
        Vinculando, este projeto já conta como <b className="text-slate-400">serviço contratado</b> do cliente — não precisa cadastrar de novo na empresa.
      </p>
    </div>
  );
}
