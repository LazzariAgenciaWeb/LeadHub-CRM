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
  hasSystemAccess: boolean;
  moduleWhatsapp: boolean;
  moduleCrm: boolean;
  moduleTickets: boolean;
  moduleAI: boolean;
  moduleClickup: boolean;
}

interface Props {
  company: Company;
  isSuperAdmin?: boolean;
}

export default function EditCompanyButton({ company, isSuperAdmin = false }: Props) {
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
    hasSystemAccess: company.hasSystemAccess,
    moduleWhatsapp: company.moduleWhatsapp,
    moduleCrm: company.moduleCrm,
    moduleTickets: company.moduleTickets,
    moduleAI: company.moduleAI,
    moduleClickup: company.moduleClickup,
  });

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        segment: form.segment.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        website: form.website.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
      };

      if (isSuperAdmin) {
        payload.status = form.status;
        payload.triggerOnly = form.triggerOnly;
        payload.hasSystemAccess = form.hasSystemAccess;
        payload.moduleWhatsapp = form.moduleWhatsapp;
        payload.moduleCrm = form.moduleCrm;
        payload.moduleTickets = form.moduleTickets;
        payload.moduleAI = form.moduleAI;
        payload.moduleClickup = form.moduleClickup;
      }

      const res = await fetch(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300 text-lg leading-none">✕</button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
              {/* Nome */}
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Nome da empresa *</label>
                <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)}
                  className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="Ex: Acme Ltda"
                />
              </div>

              {/* Segmento */}
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Segmento</label>
                <input type="text" value={form.segment} onChange={(e) => set("segment", e.target.value)}
                  className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="Ex: Imobiliária, Clínica..."
                />
              </div>

              {/* Telefone + Email */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Telefone</label>
                  <input type="text" value={form.phone} onChange={(e) => set("phone", e.target.value)}
                    className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">E-mail</label>
                  <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)}
                    className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Website + Logo */}
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Website</label>
                <input type="url" value={form.website} onChange={(e) => set("website", e.target.value)}
                  className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="https://empresa.com.br"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">URL do Logo</label>
                <input type="url" value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)}
                  className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="https://empresa.com/logo.png"
                />
                {form.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoUrl} alt="Logo" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    className="mt-2 h-10 object-contain rounded border border-[#2a3d56] bg-white/5 p-1"
                  />
                )}
              </div>

              {/* SUPER_ADMIN: Status + TriggerOnly + Acesso + Módulos */}
              {isSuperAdmin && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 font-medium mb-1">Status</label>
                      <select value={form.status} onChange={(e) => set("status", e.target.value)}
                        className="w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                      >
                        <option value="ACTIVE">Ativo</option>
                        <option value="INACTIVE">Inativo</option>
                      </select>
                    </div>
                    <div className="flex flex-col justify-end">
                      <label className="flex items-center gap-2 cursor-pointer py-2">
                        <input type="checkbox" checked={form.triggerOnly} onChange={(e) => set("triggerOnly", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        <span className="text-xs text-slate-400 font-medium">Apenas gatilhos</span>
                      </label>
                      <p className="text-[10px] text-slate-600">Recebe mensagens mas não cria leads</p>
                    </div>
                  </div>

                  {/* Acesso ao sistema */}
                  <div className="border border-[#1e2d45] rounded-xl p-4 bg-[#0a1120] flex flex-col gap-3">
                    <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Acesso ao Sistema</p>

                    <label className="flex items-start gap-3 cursor-pointer">
                      <div className="relative mt-0.5 shrink-0">
                        <input type="checkbox" checked={form.hasSystemAccess} onChange={(e) => set("hasSystemAccess", e.target.checked)} className="sr-only peer" />
                        <div className="w-9 h-5 bg-[#1e2d45] rounded-full peer-checked:bg-indigo-600 transition-colors" />
                        <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                      </div>
                      <div>
                        <p className="text-sm text-white font-medium">Acesso ao portal</p>
                        <p className="text-xs text-slate-500 mt-0.5">Pode fazer login e usar o LeadHub</p>
                      </div>
                    </label>

                    {form.hasSystemAccess && (
                      <div>
                        <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Módulos</p>
                        <div className="flex flex-col gap-2">
                          {[
                            { key: "moduleWhatsapp", label: "WhatsApp" },
                            { key: "moduleCrm", label: "CRM" },
                            { key: "moduleTickets", label: "Chamados" },
                            { key: "moduleAI", label: "Assistente IA" },
                            { key: "moduleClickup", label: "ClickUp (integração)" },
                          ].map(({ key, label }) => (
                            <label key={key} className="flex items-center gap-3 cursor-pointer py-1 px-2 rounded-lg hover:bg-white/5 transition-colors">
                              <input type="checkbox" checked={(form as any)[key]} onChange={(e) => set(key, e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                              <span className="text-sm text-white">{label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1e2d45]">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
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
