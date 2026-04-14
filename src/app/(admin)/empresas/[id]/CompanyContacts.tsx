"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  isGroup: boolean;
  role: string;
  hasAccess: boolean;
  notes: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

const ROLE_OPTIONS = [
  { value: "CONTACT",       label: "Contato",          icon: "👤" },
  { value: "DECISION_MAKER",label: "Decisor",           icon: "🎯" },
  { value: "TECHNICAL",     label: "Técnico",           icon: "🔧" },
  { value: "FINANCIAL",     label: "Financeiro",        icon: "💰" },
];

const ROLE_BADGE: Record<string, string> = {
  CONTACT:        "text-slate-400 bg-white/5",
  DECISION_MAKER: "text-amber-400 bg-amber-500/10",
  TECHNICAL:      "text-cyan-400 bg-cyan-500/10",
  FINANCIAL:      "text-green-400 bg-green-500/10",
};

function roleLabel(r: string) {
  return ROLE_OPTIONS.find((o) => o.value === r) ?? { label: r, icon: "👤" };
}

function formatPhone(phone: string, isGroup: boolean) {
  if (isGroup) return phone;
  const d = phone.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  return phone;
}

export default function CompanyContacts({
  companyId,
  initialContacts,
}: {
  companyId: string;
  initialContacts: Contact[];
}) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add form
  const [form, setForm] = useState({
    name: "", phone: "", isGroup: false, role: "CONTACT", notes: "",
  });

  // Access modal state
  const [accessModal, setAccessModal] = useState<{ contact: Contact; email: string; userName: string } | null>(null);
  // Credenciais geradas — exibir uma única vez após criação/reset
  const [credentials, setCredentials] = useState<{ email: string; password: string; name: string } | null>(null);

  // Edit inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", role: "CONTACT", notes: "" });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.phone.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/companies/${companyId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const c = await res.json();
      setContacts((prev) => [...prev, c]);
      setForm({ name: "", phone: "", isGroup: false, role: "CONTACT", notes: "" });
      setShowAdd(false);
    } else {
      const err = await res.json();
      alert(err.error ?? "Erro ao adicionar contato");
    }
    setSaving(false);
  }

  async function handleToggleAccess(contact: Contact) {
    if (!contact.hasAccess) {
      // Ativar → abre modal para email (opcional)
      setAccessModal({ contact, email: "", userName: contact.name ?? "" });
    } else {
      // Desativar imediatamente
      await patchContact(contact.id, { hasAccess: false });
    }
  }

  async function handleGrantAccess() {
    if (!accessModal) return;
    setSaving(true);
    await patchContact(accessModal.contact.id, {
      hasAccess: true,
      userEmail: accessModal.email || undefined,
      userName: accessModal.userName || undefined,
    });
    setAccessModal(null);
    setSaving(false);
  }

  async function patchContact(contactId: string, data: Record<string, any>) {
    const res = await fetch(`/api/companies/${companyId}/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      setContacts((prev) => prev.map((c) => (c.id === contactId ? updated : c)));
      // Se a API retornou credenciais geradas, exibe o painel
      if (updated.tempPassword && updated.user?.email) {
        setCredentials({ email: updated.user.email, password: updated.tempPassword, name: updated.user.name });
      }
      return updated;
    }
  }

  async function handleResetPassword(contact: Contact) {
    if (!contact.user) return;
    if (!confirm(`Redefinir a senha de ${contact.user.email}? A senha atual deixará de funcionar.`)) return;
    setSaving(true);
    await patchContact(contact.id, { resetPassword: true });
    setSaving(false);
  }

  async function handleDelete(contactId: string) {
    if (!confirm("Remover este contato?")) return;
    await fetch(`/api/companies/${companyId}/contacts/${contactId}`, { method: "DELETE" });
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
  }

  async function handleSaveEdit(contactId: string) {
    await patchContact(contactId, editForm);
    setEditingId(null);
  }

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">

      {/* Painel de credenciais geradas — aparece uma única vez */}
      {credentials && (
        <div className="mx-4 mt-4 bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-green-400 font-semibold text-sm mb-2">✅ Acesso criado! Anote as credenciais abaixo:</p>
              <div className="space-y-1.5 font-mono text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs w-12">E-mail:</span>
                  <span className="text-white bg-[#0c1220] px-3 py-1 rounded-lg border border-[#1e2d45] select-all">{credentials.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs w-12">Senha:</span>
                  <span className="text-green-300 bg-[#0c1220] px-3 py-1 rounded-lg border border-green-500/30 select-all font-bold tracking-wider">{credentials.password}</span>
                </div>
              </div>
              <p className="text-slate-500 text-[11px] mt-2">⚠️ Esta senha não será exibida novamente. Copie agora e envie para {credentials.name}.</p>
            </div>
            <button onClick={() => setCredentials(null)} className="text-slate-500 hover:text-white text-xl flex-shrink-0">×</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 py-4 border-b border-[#1e2d45] flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-sm">📱 Contatos WhatsApp</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Telefones e grupos vinculados a esta empresa
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
        >
          + Adicionar
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="px-5 py-4 border-b border-[#1e2d45] bg-indigo-500/5">
          <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">
                Telefone / ID do Grupo *
              </label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder={form.isGroup ? "120363xxxxxx@g.us" : "5511999999999"}
                className="w-full bg-[#0c1220] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Nome</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nome do contato ou grupo"
                className="w-full bg-[#0c1220] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-[10px] uppercase tracking-wide mb-1">Papel</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="bg-[#0c1220] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isGroup}
                  onChange={(e) => setForm({ ...form, isGroup: e.target.checked })}
                  className="w-3.5 h-3.5 rounded accent-indigo-500"
                />
                <span className="text-slate-400 text-xs">Grupo</span>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Adicionar"}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 text-xs hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Contact list */}
      {contacts.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="text-3xl mb-2">📭</div>
          <div className="text-slate-500 text-sm">Nenhum contato vinculado</div>
          <div className="text-slate-600 text-xs mt-1">Adicione telefones ou grupos do WhatsApp desta empresa</div>
        </div>
      ) : (
        <div className="divide-y divide-[#1e2d45]/60">
          {contacts.map((c) => {
            const rl = roleLabel(c.role);
            const isEditing = editingId === c.id;
            return (
              <div key={c.id} className="px-5 py-3.5">
                {isEditing ? (
                  /* ── Modo edição ── */
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-slate-500 text-[10px] uppercase tracking-wide mb-1">Nome</label>
                      <input
                        autoFocus
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full bg-[#0c1220] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 text-[10px] uppercase tracking-wide mb-1">Papel</label>
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                        className="bg-[#0c1220] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                      >
                        {ROLE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveEdit(c.id)} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500">
                        Salvar
                      </button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 text-xs hover:text-white">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Modo visualização ── */
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-[#1e2d45] flex items-center justify-center text-base flex-shrink-0">
                      {c.isGroup ? "👥" : "👤"}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-sm font-semibold">
                          {c.name ?? (c.isGroup ? "Grupo sem nome" : "Sem nome")}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ROLE_BADGE[c.role] ?? "text-slate-400 bg-white/5"}`}>
                          {rl.icon} {rl.label}
                        </span>
                        {c.isGroup && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-indigo-400 bg-indigo-500/10">
                            👥 Grupo
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500 text-xs mt-0.5">
                        {formatPhone(c.phone, c.isGroup)}
                      </div>
                      {c.user && (
                        <div className="text-green-400 text-[10px] mt-0.5">
                          🔑 Portal: {c.user.email}
                        </div>
                      )}
                    </div>

                    {/* Acesso ao portal */}
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleToggleAccess(c)}
                        title={c.hasAccess ? "Revogar acesso ao portal" : "Dar acesso ao portal"}
                        className={`relative w-11 h-6 rounded-full transition-colors ${
                          c.hasAccess ? "bg-green-600" : "bg-[#1e2d45]"
                        }`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                          c.hasAccess ? "left-[22px]" : "left-0.5"
                        }`} />
                      </button>
                      <span className="text-[9px] text-slate-600 font-medium">
                        {c.hasAccess ? "Acesso" : "Sem acesso"}
                      </span>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {c.user && (
                        <button
                          onClick={() => handleResetPassword(c)}
                          disabled={saving}
                          className="w-7 h-7 rounded-lg hover:bg-yellow-500/10 flex items-center justify-center text-slate-500 hover:text-yellow-400 transition-colors text-xs disabled:opacity-50"
                          title="Redefinir senha"
                        >
                          🔑
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingId(c.id); setEditForm({ name: c.name ?? "", role: c.role, notes: c.notes ?? "" }); }}
                        className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors text-xs"
                        title="Editar"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="w-7 h-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-slate-600 hover:text-red-400 transition-colors text-xs"
                        title="Remover"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Configurar acesso ao portal */}
      {accessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5 border-b border-[#1e2d45]">
              <h3 className="text-white font-bold">🔑 Acesso ao Portal</h3>
              <p className="text-slate-500 text-sm mt-1">
                Configure o acesso de <strong className="text-slate-300">{accessModal.contact.name ?? accessModal.contact.phone}</strong> ao portal do cliente.
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5">
                  Nome do usuário
                </label>
                <input
                  type="text"
                  value={accessModal.userName}
                  onChange={(e) => setAccessModal({ ...accessModal, userName: e.target.value })}
                  placeholder="Nome completo"
                  className="w-full bg-[#0c1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5">
                  E-mail para login <span className="text-slate-600 font-normal normal-case">(opcional)</span>
                </label>
                <input
                  type="email"
                  value={accessModal.email}
                  onChange={(e) => setAccessModal({ ...accessModal, email: e.target.value })}
                  placeholder="email@empresa.com"
                  className="w-full bg-[#0c1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
                <p className="text-slate-600 text-[11px] mt-1.5">
                  {accessModal.email
                    ? "Uma conta de acesso será criada com este e-mail."
                    : "Sem e-mail, o acesso fica marcado mas sem conta de login."}
                </p>
              </div>
            </div>

            <div className="px-6 pb-5 flex gap-3 justify-end">
              <button
                onClick={() => setAccessModal(null)}
                className="px-4 py-2 rounded-lg bg-white/5 text-slate-400 text-sm hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleGrantAccess}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {saving ? "Salvando..." : "✓ Confirmar Acesso"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
