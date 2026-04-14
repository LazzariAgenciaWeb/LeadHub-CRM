"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Company {
  id: string;
  name: string;
  slug: string;
  segment: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  status: "ACTIVE" | "INACTIVE";
  triggerOnly: boolean;
}

export default function EditCompanyButton({ company }: { company: Company }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: company.name,
    segment: company.segment ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    website: company.website ?? "",
    logoUrl: company.logoUrl ?? "",
    status: company.status,
    triggerOnly: company.triggerOnly,
  });

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          segment: form.segment.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          website: form.website.trim() || null,
          logoUrl: form.logoUrl.trim() || null,
          status: form.status,
          triggerOnly: form.triggerOnly,
        }),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
      setOpen(false);
      router.refresh();
    } catch {
      alert("Erro ao salvar empresa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1e2d45] border border-[#2a3d56] text-slate-300 text-sm font-medium hover:bg-[#253348] transition-colors"
      >
        ✏️ Editar
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45]">
              <h2 className="text-white font-bold text-sm">Editar Empresa</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-slate-300 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              {/* Nome */}
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Nome da empresa *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="Ex: Acme Ltda"
                />
              </div>

              {/* Segmento */}
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Segmento</label>
                <input
                  type="text"
                  value={form.segment}
                  onChange={(e) => set("segment", e.target.value)}
                  className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="Ex: Imobiliária, Clínica, E-commerce..."
                />
              </div>

              {/* Telefone + Email */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Telefone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    placeholder="Ex: 11999999999"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">E-mail</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    placeholder="contato@empresa.com"
                  />
                </div>
              </div>

              {/* Website */}
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Website</label>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => set("website", e.target.value)}
                  className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="https://empresa.com.br"
                />
              </div>

              {/* Logo URL */}
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">URL do Logo</label>
                <input
                  type="url"
                  value={form.logoUrl}
                  onChange={(e) => set("logoUrl", e.target.value)}
                  className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="https://empresa.com/logo.png"
                />
                {form.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.logoUrl}
                    alt="Logo preview"
                    className="mt-2 h-10 object-contain rounded border border-[#2a3d56] bg-white/5 p-1"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
              </div>

              {/* Status + TriggerOnly */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => set("status", e.target.value)}
                    className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ACTIVE">Ativo</option>
                    <option value="INACTIVE">Inativo</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer py-2">
                    <input
                      type="checkbox"
                      checked={form.triggerOnly}
                      onChange={(e) => set("triggerOnly", e.target.checked)}
                      className="w-4 h-4 accent-indigo-500"
                    />
                    <span className="text-xs text-slate-400 font-medium">Apenas gatilhos</span>
                  </label>
                  <p className="text-[10px] text-slate-600">Recebe mensagens mas não cria leads automaticamente</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1e2d45]">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
