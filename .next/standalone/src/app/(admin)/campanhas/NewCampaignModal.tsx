"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Company {
  id: string;
  name: string;
}

export default function NewCampaignModal({
  isSuperAdmin,
  companies,
  defaultCompanyId,
}: {
  isSuperAdmin: boolean;
  companies: Company[];
  defaultCompanyId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    status: "ACTIVE",
    startDate: "",
    endDate: "",
    companyId: defaultCompanyId ?? companies[0]?.id ?? "",
  });

  function reset() {
    setForm({
      name: "",
      description: "",
      status: "ACTIVE",
      startDate: "",
      endDate: "",
      companyId: defaultCompanyId ?? companies[0]?.id ?? "",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const campaign = await res.json();
      setOpen(false);
      reset();
      router.push(`/campanhas/${campaign.id}`);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
      >
        + Nova Campanha
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative bg-[#0f1623] border border-[#1e2d45] rounded-2xl w-full max-w-lg shadow-2xl">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <h2 className="text-white font-bold text-base">📣 Nova Campanha</h2>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Empresa (SUPER_ADMIN only) */}
              {isSuperAdmin && (
                <div>
                  <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                    Empresa *
                  </label>
                  <select
                    required
                    value={form.companyId}
                    onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Selecione uma empresa...</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Nome */}
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  Nome da Campanha *
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Botox Maio 2026, Black Friday..."
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  Descrição
                </label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Objetivo da campanha..."
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div>
                <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="ACTIVE">Ativa</option>
                  <option value="PAUSED">Pausada</option>
                  <option value="FINISHED">Encerrada</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                    Data início
                  </label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                    Data término
                  </label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 py-2.5 rounded-lg border border-[#1e2d45] text-slate-400 text-sm font-medium hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                >
                  {saving ? "Criando..." : "Criar Campanha"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
