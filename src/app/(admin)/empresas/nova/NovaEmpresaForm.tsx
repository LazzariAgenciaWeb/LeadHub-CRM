"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const SEGMENTS = [
  "Saúde & Estética", "Alimentação", "Imóveis", "Educação",
  "Varejo", "Serviços", "Tecnologia", "Bem-estar", "Outro",
];

interface Props {
  isSuperAdmin: boolean;
}

export default function NovaEmpresaForm({ isSuperAdmin }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    segment: "",
    phone: "",
    email: "",
    website: "",
    // SUPER_ADMIN only
    hasSystemAccess: false,
    moduleWhatsapp: false,
    moduleCrm: true,
    moduleTickets: false,
  });

  function set(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const payload: any = {
      name: form.name.trim(),
      segment: form.segment || null,
      phone: form.phone || null,
      email: form.email || null,
      website: form.website || null,
    };

    if (isSuperAdmin) {
      payload.hasSystemAccess = form.hasSystemAccess;
      payload.moduleWhatsapp = form.moduleWhatsapp;
      payload.moduleCrm = form.moduleCrm;
      payload.moduleTickets = form.moduleTickets;
    }

    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/empresas" className="text-slate-500 hover:text-white text-sm transition-colors">
          ← {isSuperAdmin ? "Empresas" : "Meus Clientes"}
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400 text-sm">{isSuperAdmin ? "Nova Empresa" : "Novo Cliente"}</span>
      </div>

      <h1 className="text-white font-bold text-xl mb-1">
        {isSuperAdmin ? "Nova Empresa" : "Novo Cliente"}
      </h1>
      <p className="text-slate-500 text-sm mb-6">
        {isSuperAdmin
          ? "Cadastre uma empresa — pode ser um cliente com acesso ao sistema ou apenas um registro CRM."
          : "Cadastre um cliente da sua empresa para organizar chamados e oportunidades."}
      </p>

      <form onSubmit={handleSubmit} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-6 flex flex-col gap-4">
        {/* Nome */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
            Nome <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder={isSuperAdmin ? "Ex: Refriar Engenharia" : "Ex: Clínica Bella Vida"}
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
            {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Email + Phone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="contato@empresa.com"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
            />
          </div>
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">Telefone</label>
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
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">Website</label>
          <input
            type="url"
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            placeholder="https://empresa.com.br"
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
          />
        </div>

        {/* ─── SUPER_ADMIN: Controle de acesso e módulos ─── */}
        {isSuperAdmin && (
          <div className="border border-[#1e2d45] rounded-xl p-4 flex flex-col gap-4 bg-[#0a1120]">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Acesso ao Sistema</p>

            {/* hasSystemAccess toggle */}
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={form.hasSystemAccess}
                  onChange={(e) => set("hasSystemAccess", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#1e2d45] rounded-full peer-checked:bg-indigo-600 transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
              </div>
              <div>
                <p className="text-sm text-white font-medium">Acesso ao portal</p>
                <p className="text-xs text-slate-500 mt-0.5">Esta empresa pode fazer login e usar o sistema LeadHub</p>
              </div>
            </label>

            {/* Módulos (só aparece se hasSystemAccess = true) */}
            {form.hasSystemAccess && (
              <div>
                <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Módulos habilitados</p>
                <div className="flex flex-col gap-2">
                  {[
                    { key: "moduleWhatsapp", label: "WhatsApp", desc: "Inbox e envio de mensagens" },
                    { key: "moduleCrm", label: "CRM", desc: "Leads, prospecção e oportunidades" },
                    { key: "moduleTickets", label: "Chamados", desc: "Helpdesk e suporte" },
                  ].map(({ key, label, desc }) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
                      <input
                        type="checkbox"
                        checked={(form as any)[key]}
                        onChange={(e) => set(key, e.target.checked)}
                        className="w-4 h-4 accent-indigo-500 shrink-0"
                      />
                      <div>
                        <span className="text-sm text-white font-medium">{label}</span>
                        <span className="text-xs text-slate-500 ml-2">{desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
            {loading ? "Salvando..." : isSuperAdmin ? "Cadastrar Empresa" : "Cadastrar Cliente"}
          </button>
        </div>
      </form>
    </div>
  );
}
