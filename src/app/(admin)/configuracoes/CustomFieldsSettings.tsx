"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface FieldDef {
  id: string;
  name: string;
  key: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT";
  options: string[] | null;
  required: boolean;
  order: number;
}

const TYPE_LABELS: Record<FieldDef["type"], { label: string; icon: string }> = {
  TEXT:   { label: "Texto",     icon: "📝" },
  NUMBER: { label: "Número",    icon: "🔢" },
  DATE:   { label: "Data",      icon: "📅" },
  SELECT: { label: "Lista",     icon: "📋" },
};

export default function CustomFieldsSettings({
  isSuperAdmin,
  defaultCompanyId,
  allCompanies,
}: {
  isSuperAdmin: boolean;
  defaultCompanyId: string;
  allCompanies: { id: string; name: string }[];
}) {
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form de criar
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<FieldDef["type"]>("TEXT");
  const [formOptions, setFormOptions] = useState("");
  const [formRequired, setFormRequired] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) { setFields([]); setLoading(false); return; }
    setLoading(true);
    fetch(`/api/custom-fields?companyId=${companyId}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setFields(data))
      .finally(() => setLoading(false));
  }, [companyId]);

  function resetForm() {
    setFormName(""); setFormType("TEXT"); setFormOptions(""); setFormRequired(false);
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!formName.trim()) { setError("Nome obrigatório"); return; }
    const opts = formType === "SELECT"
      ? formOptions.split(/\n|,/).map((s) => s.trim()).filter(Boolean)
      : [];
    if (formType === "SELECT" && opts.length === 0) {
      setError("Lista precisa de pelo menos 1 opção");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/custom-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formName.trim(),
        type: formType,
        options: opts,
        required: formRequired,
        ...(isSuperAdmin && companyId ? { companyId } : {}),
      }),
    });
    if (res.ok) {
      const created: FieldDef = await res.json();
      setFields((prev) => [...prev, created]);
      resetForm();
      setShowForm(false);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar");
    }
    setSaving(false);
  }

  async function handleDelete(field: FieldDef) {
    if (!confirm(`Remover campo "${field.name}"? Os valores preenchidos nos leads serão apagados.`)) return;
    const res = await fetch(`/api/custom-fields/${field.id}`, { method: "DELETE" });
    if (res.ok) setFields((prev) => prev.filter((f) => f.id !== field.id));
  }

  async function handleToggleRequired(field: FieldDef) {
    const next = !field.required;
    setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, required: next } : f)));
    const res = await fetch(`/api/custom-fields/${field.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ required: next }),
    });
    if (!res.ok) {
      // rollback
      setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, required: !next } : f)));
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-white text-lg font-bold mb-1">📋 Campos personalizados</h2>
        <p className="text-slate-500 text-xs">
          Crie campos extras pra preencher nos leads — &quot;Convênio&quot;, &quot;Tipo do imóvel&quot;, &quot;Verba mensal&quot; etc.
          Aparecem no painel lateral de cada lead em <Link href="/crm/leads" className="text-indigo-400 hover:underline">Leads</Link>,{" "}
          <Link href="/crm/oportunidades" className="text-indigo-400 hover:underline">Oportunidades</Link> e{" "}
          <Link href="/crm/prospeccao" className="text-indigo-400 hover:underline">Prospecção</Link>.
        </p>
      </div>

      {isSuperAdmin && allCompanies.length > 0 && (
        <div className="mb-4">
          <label className="block text-slate-400 text-xs font-medium mb-1">Empresa</label>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full max-w-sm bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            {allCompanies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Lista atual */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden mb-4">
        {loading ? (
          <div className="p-6 text-slate-600 text-xs text-center">Carregando...</div>
        ) : fields.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-3xl mb-2">📋</div>
            <div className="text-slate-400 text-sm">Nenhum campo criado ainda.</div>
            <div className="text-slate-600 text-xs mt-1">Adicione o primeiro campo abaixo.</div>
          </div>
        ) : (
          <ul className="divide-y divide-[#1e2d45]">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center gap-3 p-3 hover:bg-white/[0.02]">
                <span className="text-lg flex-shrink-0">{TYPE_LABELS[f.type].icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-medium">{f.name}</span>
                    <span className="text-slate-600 text-[10px]">{TYPE_LABELS[f.type].label}</span>
                    {f.required && (
                      <span className="bg-red-500/15 text-red-400 border border-red-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded">
                        OBRIGATÓRIO
                      </span>
                    )}
                  </div>
                  <div className="text-slate-600 text-[10px] mt-0.5 font-mono">key: {f.key}</div>
                  {f.type === "SELECT" && f.options && f.options.length > 0 && (
                    <div className="text-slate-500 text-[11px] mt-1">
                      Opções: {f.options.join(" · ")}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleToggleRequired(f)}
                  className="text-slate-500 hover:text-amber-400 text-[10px] px-2 py-1 rounded hover:bg-amber-500/10"
                  title={f.required ? "Tornar opcional" : "Tornar obrigatório"}
                >
                  {f.required ? "Tornar opcional" : "Tornar obrigatório"}
                </button>
                <button
                  onClick={() => handleDelete(f)}
                  className="text-slate-600 hover:text-red-400 text-sm px-2"
                  title="Remover"
                >
                  🗑️
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Form de adicionar */}
      {showForm ? (
        <form onSubmit={handleCreate} className="bg-[#0f1623] border border-indigo-500/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm">+ Novo campo</h3>
            <button
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
              className="text-slate-500 hover:text-white text-sm"
            >
              ✕
            </button>
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1">Nome <span className="text-red-400">*</span></label>
            <input
              autoFocus
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder='Ex: "Convênio", "Tipo do imóvel", "Verba mensal"'
              className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-xs font-medium mb-1">Tipo</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as FieldDef["type"])}
                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="TEXT">📝 Texto</option>
                <option value="NUMBER">🔢 Número</option>
                <option value="DATE">📅 Data</option>
                <option value="SELECT">📋 Lista (opções)</option>
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formRequired}
                  onChange={(e) => setFormRequired(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-slate-300 text-xs">Obrigatório</span>
              </label>
            </div>
          </div>

          {formType === "SELECT" && (
            <div>
              <label className="block text-slate-400 text-xs font-medium mb-1">
                Opções <span className="text-red-400">*</span>
                <span className="text-slate-600 text-[10px] ml-2 font-normal">(uma por linha ou separadas por vírgula)</span>
              </label>
              <textarea
                value={formOptions}
                onChange={(e) => setFormOptions(e.target.value)}
                rows={4}
                placeholder="Unimed&#10;Bradesco Saúde&#10;Particular"
                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none font-mono"
              />
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Criando..." : "Criar campo"}
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-xl border border-dashed border-[#1e2d45] text-slate-500 hover:border-indigo-500/50 hover:text-indigo-400 text-sm font-medium transition-colors"
        >
          + Adicionar campo
        </button>
      )}
    </div>
  );
}
