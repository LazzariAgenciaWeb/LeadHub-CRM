"use client";

import { useEffect, useState } from "react";

interface Template {
  id: string;
  name: string;
  subject: string;
  html: string;
  text: string | null;
  updatedAt: string;
}

const VARS_HINT_BASIC = "Básicas: {{nome}}, {{primeiroNome}}, {{email}}, {{phone}}, {{empresa}}";
const VARS_HINT_DIAG = "Diagnóstico IA: {{diagnosticoSummary}}, {{diagnosticoPontosFortes}}, {{diagnosticoOportunidades}}, {{diagnosticoQuickWins}}, {{diagnosticoUrl}}, {{diagnosticoCompleto}}";
const VARS_HINT_CTA = "CTAs: {{whatsappAvaliacaoUrl}} (link WA com ref), {{diagnosticoCtaDuplo}} (2 botões: Ver + WhatsApp)";

export default function EmailTemplatesSection({ companyId }: { companyId?: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const qs = companyId ? `?companyId=${companyId}` : "";

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/email/templates${qs}`);
      if (res.ok) setTemplates(await res.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function handleDelete(t: Template) {
    if (!confirm(`Remover template "${t.name}"?`)) return;
    const res = await fetch(`/api/email/templates/${t.id}`, { method: "DELETE" });
    if (res.ok) setTemplates((p) => p.filter((x) => x.id !== t.id));
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Erro ao remover");
    }
  }

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-bold text-sm">📝 Templates</h2>
          <p className="text-slate-500 text-xs">Modelos reutilizáveis usados nas campanhas.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
        >
          + Novo template
        </button>
      </div>

      {loading ? (
        <p className="text-slate-600 text-xs text-center py-6">Carregando...</p>
      ) : templates.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">📝</div>
          <p className="text-slate-500 text-sm">Nenhum template ainda.</p>
          <p className="text-slate-600 text-xs mt-1">Crie um modelo pra reutilizar em várias campanhas.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[#1e2d45]">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-3 hover:bg-white/[0.02] rounded-lg px-2 group">
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm font-medium truncate">{t.name}</div>
                <div className="text-slate-500 text-xs truncate">{t.subject}</div>
              </div>
              <button onClick={() => setEditing(t)} className="text-slate-500 hover:text-white text-xs px-2 py-1">Editar</button>
              <button onClick={() => handleDelete(t)} className="text-slate-600 hover:text-red-400 text-xs px-2 py-1">🗑️</button>
            </li>
          ))}
        </ul>
      )}

      {(showCreate || editing) && (
        <TemplateEditor
          companyId={companyId}
          initial={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { reload(); setShowCreate(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  companyId, initial, onClose, onSaved,
}: {
  companyId?: string;
  initial: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [html, setHtml] = useState(initial?.html ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"editor" | "preview">("editor");

  async function save() {
    setSaving(true); setErr(null);
    const url = isEdit ? `/api/email/templates/${initial!.id}` : "/api/email/templates";
    const method = isEdit ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, subject, html, text: text || null,
        ...(companyId ? { companyId } : {}),
      }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error ?? "Erro ao salvar");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-4xl h-[85vh] shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45] flex items-center justify-between">
          <h2 className="text-white font-bold text-base">{isEdit ? "Editar template" : "Novo template"}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="px-5 py-3 border-b border-[#1e2d45] grid grid-cols-1 gap-3">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Nome do template (interno)"
            className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
          <input
            type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="Assunto do email (pode usar {{nome}}…)"
            className="bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="px-5 pt-2 border-b border-[#1e2d45] flex gap-2">
          {(["editor", "preview"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-2 text-xs font-medium border-b-2 ${tab === k ? "border-indigo-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
            >
              {k === "editor" ? "✏️ HTML" : "👁️ Preview"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "editor" ? (
            <>
              <div className="text-slate-500 text-[10px] mb-2 space-y-1">
                <p>{VARS_HINT_BASIC}</p>
                <p>{VARS_HINT_DIAG}</p>
                <p>{VARS_HINT_CTA}</p>
                <p className="text-slate-600 italic">
                  💡 <code className="text-slate-400">{`{{diagnosticoCtaDuplo}}`}</code> renderiza 2 botões: <strong>Ver diagnóstico</strong> + <strong>Solicitar via WhatsApp</strong>.
                  O link do WA já vem com mensagem pré-preenchida + tag <code className="text-slate-400">(ref:&nbsp;TOKEN)</code> — quando o cliente envia, o sistema reconhece e linka o lead direto à conversa.
                </p>
              </div>
              <textarea
                value={html} onChange={(e) => setHtml(e.target.value)}
                placeholder="<p>Olá {{primeiroNome}},</p><p>...</p>"
                className="w-full h-[300px] bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <p className="text-slate-500 text-[10px] mt-4 mb-1">Texto puro (opcional — gerado automaticamente do HTML)</p>
              <textarea
                value={text} onChange={(e) => setText(e.target.value)}
                placeholder="Versão texto pra clientes antigos"
                className="w-full h-[100px] bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </>
          ) : (
            <div className="bg-white rounded-lg p-4 min-h-[300px]" dangerouslySetInnerHTML={{ __html: html || "<em>Sem HTML</em>" }} />
          )}
        </div>

        {err && <div className="mx-5 mb-3 text-xs rounded-lg px-3 py-2 border bg-red-500/10 border-red-500/30 text-red-400">{err}</div>}

        <div className="px-5 py-3 border-t border-[#1e2d45] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white text-sm">Cancelar</button>
          <button onClick={save} disabled={saving || !name.trim() || !subject.trim() || !html.trim()} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
            {saving ? "Salvando..." : (isEdit ? "Salvar" : "Criar template")}
          </button>
        </div>
      </div>
    </div>
  );
}
