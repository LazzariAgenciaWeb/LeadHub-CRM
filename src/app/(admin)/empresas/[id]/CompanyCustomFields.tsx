"use client";

import { useEffect, useState } from "react";

type FieldType = "TEXT" | "NUMBER" | "DATE" | "SELECT" | "LINK";

type FieldDef = {
  id:      string;
  name:    string;
  key:     string;
  type:    FieldType;
  options: string[] | null;
  order:   number;
};

type FieldValue = {
  fieldId: string;
  value:   string;
};

type Props = {
  companyId: string;
};

const TYPE_LABEL: Record<FieldType, string> = {
  TEXT:   "Texto",
  NUMBER: "Número",
  DATE:   "Data",
  SELECT: "Lista",
  LINK:   "Link",
};

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export default function CompanyCustomFields({ companyId }: Props) {
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<FieldType>("TEXT");
  const [newOptionsText, setNewOptionsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const [defsRes, valuesRes] = await Promise.all([
        fetch(`/api/company-custom-fields?companyId=${companyId}`),
        fetch(`/api/companies/${companyId}/custom-values`),
      ]);
      if (defsRes.ok) {
        const d = await defsRes.json();
        setDefs(d.defs ?? []);
      }
      if (valuesRes.ok) {
        const v = await valuesRes.json();
        const map: Record<string, string> = {};
        for (const row of v) map[row.fieldId] = row.value;
        setValues(map);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [companyId]);

  async function saveValue(fieldId: string, value: string) {
    setSavingFieldId(fieldId);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/custom-values`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fieldId, value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao salvar");
        return;
      }
      setValues((m) => ({ ...m, [fieldId]: value }));
    } finally {
      setSavingFieldId(null);
    }
  }

  async function createField() {
    if (!newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const options = newType === "SELECT"
        ? newOptionsText.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const res = await fetch("/api/company-custom-fields", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ companyId, name: newName.trim(), type: newType, options }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao criar campo");
        return;
      }
      setNewName("");
      setNewType("TEXT");
      setNewOptionsText("");
      setShowNewForm(false);
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteField(def: FieldDef) {
    const ok = window.confirm(
      `Remover o campo "${def.name}"?\n\nIsso apaga o valor deste campo em todas as empresas onde foi preenchido.`,
    );
    if (!ok) return;
    const res = await fetch(`/api/company-custom-fields/${def.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao remover");
      return;
    }
    await reload();
  }

  if (loading) {
    return <div className="text-slate-600 text-xs">Carregando…</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {defs.length === 0 && !showNewForm && (
        <div className="text-slate-600 text-xs italic">Nenhum campo personalizado.</div>
      )}

      {defs.map((def) => (
        <div key={def.id} className="flex items-start gap-2 group">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide">
                {def.name}
              </span>
              <button
                onClick={() => void deleteField(def)}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-[10px] transition-opacity"
                title="Remover campo (em todas as empresas)"
              >
                ✕
              </button>
            </div>
            <FieldEditor
              def={def}
              value={values[def.id] ?? ""}
              saving={savingFieldId === def.id}
              onSave={(v) => void saveValue(def.id, v)}
            />
          </div>
        </div>
      ))}

      {showNewForm ? (
        <div className="mt-2 p-3 bg-[#0a0f1a] border border-[#1e2d45] rounded-lg flex flex-col gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do campo (ex.: Plano contratado)"
            className="bg-[#0f1623] border border-[#1e2d45] rounded px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            autoFocus
          />
          <div className="flex gap-2">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as FieldType)}
              className="bg-[#0f1623] border border-[#1e2d45] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="TEXT">Texto</option>
              <option value="NUMBER">Número</option>
              <option value="DATE">Data</option>
              <option value="SELECT">Lista</option>
              <option value="LINK">Link</option>
            </select>
            {newType === "SELECT" && (
              <input
                type="text"
                value={newOptionsText}
                onChange={(e) => setNewOptionsText(e.target.value)}
                placeholder="Opções separadas por vírgula"
                className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowNewForm(false); setNewName(""); setNewOptionsText(""); setError(null); }}
              className="text-slate-500 hover:text-white text-xs px-2 py-1 transition-colors"
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              onClick={() => void createField()}
              disabled={submitting || !newName.trim()}
              className="bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-xs font-semibold px-3 py-1 rounded transition-colors disabled:opacity-50"
            >
              {submitting ? "Criando…" : "Criar"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewForm(true)}
          className="text-indigo-400 hover:text-indigo-300 text-xs font-medium text-left mt-1 transition-colors"
        >
          + Adicionar campo
        </button>
      )}

      {error && <div className="text-red-400 text-[11px] mt-1">{error}</div>}
    </div>
  );
}

function FieldEditor({
  def, value, saving, onSave,
}: {
  def:    FieldDef;
  value:  string;
  saving: boolean;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const baseClass =
    "w-full bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50";

  function commit() {
    if (draft !== value) onSave(draft);
  }

  if (def.type === "SELECT") {
    const opts = def.options ?? [];
    return (
      <select
        value={draft}
        onChange={(e) => { setDraft(e.target.value); onSave(e.target.value); }}
        disabled={saving}
        className={baseClass}
      >
        <option value="">— vazio —</option>
        {opts.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }

  if (def.type === "LINK") {
    const savedUrl = value ? normalizeUrl(value) : "";
    return (
      <div className="flex items-center gap-1">
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="https://…"
          disabled={saving}
          className={baseClass}
        />
        {savedUrl && (
          <a
            href={savedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[11px] font-semibold px-2 py-1 rounded transition-colors"
            title={savedUrl}
          >
            Abrir ↗
          </a>
        )}
      </div>
    );
  }

  return (
    <input
      type={def.type === "NUMBER" ? "number" : def.type === "DATE" ? "date" : "text"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      placeholder={TYPE_LABEL[def.type]}
      disabled={saving}
      className={baseClass}
    />
  );
}
