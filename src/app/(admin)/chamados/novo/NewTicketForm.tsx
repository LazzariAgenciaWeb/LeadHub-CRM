"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewTicketForm({
  isSuperAdmin,
  companies,
  defaultCompanyId,
  categories,
}: {
  isSuperAdmin: boolean;
  companies: { id: string; name: string }[];
  defaultCompanyId: string;
  categories: string[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "MEDIUM",
    category: "",
    companyId: defaultCompanyId,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return;

    setSaving(true);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (res.ok) {
      const ticket = await res.json();
      router.push(`/chamados/${ticket.id}`);
    } else {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-6 space-y-5">
      {isSuperAdmin && (
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">
            Empresa <span className="text-red-400">*</span>
          </label>
          <select
            required
            value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Selecione a empresa</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-slate-400 text-xs font-medium mb-1.5">
          Título <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Descreva o problema em poucas palavras..."
          className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">Categoria</label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">Prioridade</label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="LOW">🟢 Baixa</option>
            <option value="MEDIUM">🟡 Média</option>
            <option value="HIGH">🟠 Alta</option>
            <option value="URGENT">🔴 Urgente</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-slate-400 text-xs font-medium mb-1.5">
          Descrição <span className="text-red-400">*</span>
        </label>
        <textarea
          required
          rows={6}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Descreva o problema com o máximo de detalhes possível..."
          className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-sm hover:text-white transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {saving ? "Abrindo chamado..." : "Abrir Chamado"}
        </button>
      </div>
    </form>
  );
}
