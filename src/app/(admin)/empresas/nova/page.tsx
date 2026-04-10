"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const SEGMENTS = [
  "Saúde & Estética",
  "Alimentação",
  "Imóveis",
  "Educação",
  "Varejo",
  "Serviços",
  "Tecnologia",
  "Bem-estar",
  "Outro",
];

export default function NovaEmpresaPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    segment: "",
    phone: "",
    email: "",
    website: "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Erro ao criar empresa");
      return;
    }

    router.push("/empresas");
    router.refresh();
  }

  return (
    <div className="p-6 max-w-xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/empresas"
          className="text-slate-500 hover:text-white text-sm transition-colors"
        >
          ← Empresas
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400 text-sm">Nova Empresa</span>
      </div>

      <h1 className="text-white font-bold text-xl mb-1">Nova Empresa</h1>
      <p className="text-slate-500 text-sm mb-6">
        Cadastre um novo cliente de marketing
      </p>

      <form
        onSubmit={handleSubmit}
        className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-6 flex flex-col gap-4"
      >
        {/* Nome */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
            Nome da empresa <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder="Ex: Clínica Bella Vida"
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
          />
        </div>

        {/* Segmento */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
            Segmento
          </label>
          <select
            value={form.segment}
            onChange={(e) => set("segment", e.target.value)}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">Selecione...</option>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Email + Phone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="contato@empresa.com"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
            />
          </div>
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
              Telefone
            </label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="(41) 99999-0001"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
            />
          </div>
        </div>

        {/* Website */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
            Website
          </label>
          <input
            type="url"
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            placeholder="https://empresa.com.br"
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
          />
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-2">
          <Link
            href="/empresas"
            className="flex-1 text-center bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Salvando..." : "Cadastrar Empresa"}
          </button>
        </div>
      </form>
    </div>
  );
}
