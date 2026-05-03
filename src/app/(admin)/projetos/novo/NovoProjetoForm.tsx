"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };

export default function NovoProjetoForm({
  setores, clientCompanies,
}: { setores: Option[]; clientCompanies: Option[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    setorId:         setores[0]?.id ?? "",
    name:            "",
    clickupListId:   "",
    type:            "OUTRO",
    description:     "",
    clientCompanyId: "",
    dueDate:         "",
    startDate:       "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/projetos", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          ...form,
          clientCompanyId: form.clientCompanyId || null,
          dueDate:         form.dueDate || null,
          startDate:       form.startDate || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erro ao criar projeto");
      }
      const project = await res.json();
      router.push(`/projetos/${project.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  return (
    <form onSubmit={submit} className="space-y-4 bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <div>
        <Label>Nome do projeto</Label>
        <Input value={form.name} onChange={(v) => set("name", v)} required placeholder="Ex: Site institucional Cliente X" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Setor responsável</Label>
          <Select value={form.setorId} onChange={(v) => set("setorId", v)} required>
            {setores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={form.type} onChange={(v) => set("type", v)}>
            <option value="SITE">Site</option>
            <option value="MIDIA">Mídia</option>
            <option value="CAMPANHA">Campanha</option>
            <option value="OUTRO">Outro</option>
          </Select>
        </div>
      </div>

      <div>
        <Label>List ID do ClickUp</Label>
        <Input
          value={form.clickupListId}
          onChange={(v) => set("clickupListId", v)}
          required
          placeholder="901234567890"
          mono
        />
        <p className="text-slate-600 text-[10px] mt-1">
          ClickUp → lista → 3 pontos → Copiar link → último número da URL.
        </p>
      </div>

      <div>
        <Label>Cliente (opcional)</Label>
        <Select value={form.clientCompanyId} onChange={(v) => set("clientCompanyId", v)}>
          <option value="">— sem cliente vinculado —</option>
          {clientCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Início (opcional)</Label>
          <Input type="date" value={form.startDate} onChange={(v) => set("startDate", v)} />
        </div>
        <div>
          <Label>Prazo final</Label>
          <Input type="date" value={form.dueDate} onChange={(v) => set("dueDate", v)} />
        </div>
      </div>

      <div>
        <Label>Descrição</Label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          placeholder="Escopo, observações, links..."
          className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Criando..." : "Criar projeto"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 rounded-lg bg-transparent text-slate-400 hover:text-white text-sm"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1">{children}</label>;
}
function Input({ value, onChange, type, required, placeholder, mono }: {
  value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string; mono?: boolean;
}) {
  return (
    <input
      type={type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      placeholder={placeholder}
      className={`w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 ${mono ? "font-mono" : ""}`}
    />
  );
}
function Select({ value, onChange, required, children }: {
  value: string; onChange: (v: string) => void; required?: boolean; children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
    >
      {children}
    </select>
  );
}
