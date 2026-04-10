"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

const SOURCES = [
  { value: "WHATSAPP", label: "💬 WhatsApp" },
  { value: "INSTAGRAM", label: "📸 Instagram" },
  { value: "FACEBOOK", label: "👥 Facebook" },
  { value: "GOOGLE", label: "🔍 Google Ads" },
  { value: "LINK", label: "🔗 Link Direto" },
  { value: "OTHER", label: "📌 Outro" },
];

export default function NovaCampanhaPage() {
  const router = useRouter();
  const params = useParams();
  const companyId = params.id as string;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    source: "OTHER",
    budget: "",
    startDate: "",
    endDate: "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, companyId }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Erro ao criar campanha");
      return;
    }

    router.push(`/empresas/${companyId}`);
    router.refresh();
  }

  return (
    <div className="p-6 max-w-xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-sm">
        <Link href="/empresas" className="text-slate-500 hover:text-white transition-colors">
          Empresas
        </Link>
        <span className="text-slate-700">/</span>
        <Link href={`/empresas/${companyId}`} className="text-slate-500 hover:text-white transition-colors">
          Detalhe
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400">Nova Campanha</span>
      </div>

      <h1 className="text-white font-bold text-xl mb-1">Nova Campanha</h1>
      <p className="text-slate-500 text-sm mb-6">Configure uma campanha de marketing</p>

      <form
        onSubmit={handleSubmit}
        className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-6 flex flex-col gap-4"
      >
        {/* Nome */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
            Nome da campanha <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder="Ex: Botox Março 2025"
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
          />
        </div>

        {/* Descrição */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
            Descrição
          </label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Objetivo e detalhes da campanha..."
            rows={3}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600 resize-none"
          />
        </div>

        {/* Origem */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
            Canal / Origem
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => set("source", s.value)}
                className={`text-xs font-semibold py-2 px-2 rounded-lg border transition-all ${
                  form.source === s.value
                    ? "border-indigo-500 bg-indigo-500/15 text-indigo-400"
                    : "border-[#1e2d45] bg-[#161f30] text-slate-400 hover:border-slate-500"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Budget */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
            Orçamento (R$)
          </label>
          <input
            type="number"
            value={form.budget}
            onChange={(e) => set("budget", e.target.value)}
            placeholder="0,00"
            min="0"
            step="0.01"
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
          />
        </div>

        {/* Datas */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
              Data início
            </label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
              Data fim
            </label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => set("endDate", e.target.value)}
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-2">
          <Link
            href={`/empresas/${companyId}`}
            className="flex-1 text-center bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Salvando..." : "Criar Campanha"}
          </button>
        </div>
      </form>
    </div>
  );
}
