"use client";

import { useState } from "react";

interface SetorUser {
  userId: string;
  user: { id: string; name: string; email: string };
}
interface SetorInstance {
  instanceId: string;
  instance: { id: string; instanceName: string; phone: string | null; status: string };
}
interface Setor {
  id: string;
  name: string;
  canManageUsers: boolean;
  canViewLeads: boolean;
  canCreateLeads: boolean;
  canViewTickets: boolean;
  canCreateTickets: boolean;
  canViewConfig: boolean;
  canUseAI: boolean;
  canViewInbox: boolean;
  canSendMessages: boolean;
  canViewCompanies: boolean;
  canCreateCompanies: boolean;
  users: SetorUser[];
  instances: SetorInstance[];
  _count: { tickets: number };
}

interface User     { id: string; name: string; email: string }
interface Instance { id: string; instanceName: string; phone: string | null; status: string }

type PermKey =
  | "canManageUsers" | "canViewLeads" | "canCreateLeads"
  | "canViewTickets" | "canCreateTickets" | "canViewConfig"
  | "canUseAI" | "canViewInbox" | "canSendMessages"
  | "canViewCompanies" | "canCreateCompanies";

interface PermGroup {
  label: string;
  perms: { key: PermKey; label: string; desc: string }[];
}

const PERM_GROUPS: PermGroup[] = [
  {
    label: "Mensagens (WhatsApp)",
    perms: [
      { key: "canViewInbox",      label: "Ver Mensagens",      desc: "Acessar a caixa de entrada" },
      { key: "canSendMessages",   label: "Enviar Mensagens",   desc: "Responder conversas" },
    ],
  },
  {
    label: "CRM",
    perms: [
      { key: "canViewLeads",      label: "Ver CRM",            desc: "Prospects, Leads e Oportunidades" },
      { key: "canCreateLeads",    label: "Cadastrar no CRM",   desc: "Criar e mover leads" },
    ],
  },
  {
    label: "Chamados",
    perms: [
      { key: "canViewTickets",    label: "Ver Chamados",       desc: "Chamados atribuídos ao setor" },
      { key: "canCreateTickets",  label: "Abrir Chamados",     desc: "Criar novos chamados" },
    ],
  },
  {
    label: "Inteligência Artificial",
    perms: [
      { key: "canUseAI",          label: "Usar Assistente IA", desc: "Análises e chat com IA" },
    ],
  },
  {
    label: "Empresas",
    perms: [
      { key: "canViewCompanies",  label: "Ver Empresas",       desc: "Lista de clientes/empresas" },
      { key: "canCreateCompanies",label: "Criar Empresas",     desc: "Cadastrar novas empresas" },
    ],
  },
  {
    label: "Administração",
    perms: [
      { key: "canViewConfig",     label: "Configurações",      desc: "Acessar área de configurações" },
      { key: "canManageUsers",    label: "Gerenciar Usuários", desc: "Cadastrar e editar usuários" },
    ],
  },
];

// flat list for the permission badge summary on the card
const ALL_PERMS = PERM_GROUPS.flatMap((g) => g.perms);

const STATUS_DOT: Record<string, string> = {
  CONNECTED:    "bg-green-400",
  DISCONNECTED: "bg-slate-600",
  CONNECTING:   "bg-yellow-400 animate-pulse",
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-9 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? "bg-indigo-600" : "bg-slate-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
    </button>
  );
}

const EMPTY_FORM = {
  name: "",
  canManageUsers:    false,
  canViewLeads:      true,
  canCreateLeads:    false,
  canViewTickets:    true,
  canCreateTickets:  true,
  canViewConfig:     false,
  canUseAI:          false,
  canViewInbox:      true,
  canSendMessages:   true,
  canViewCompanies:  false,
  canCreateCompanies:false,
  userIds:           [] as string[],
  instanceIds:       [] as string[],
};

export default function SetoresSection({
  initialSetores,
  allUsers,
  allInstances,
}: {
  initialSetores: Setor[];
  allUsers: User[];
  allInstances: Instance[];
}) {
  const [setores, setSetores] = useState<Setor[]>(initialSetores);
  const [editing, setEditing]   = useState<Setor | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm]         = useState({ ...EMPTY_FORM });
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setSaveError(null);
    setCreating(true);
  }

  function openEdit(s: Setor) {
    setCreating(false);
    setSaveError(null);
    setForm({
      name:               s.name,
      canManageUsers:     s.canManageUsers,
      canViewLeads:       s.canViewLeads,
      canCreateLeads:     s.canCreateLeads,
      canViewTickets:     s.canViewTickets,
      canCreateTickets:   s.canCreateTickets,
      canViewConfig:      s.canViewConfig,
      canUseAI:           s.canUseAI,
      canViewInbox:       s.canViewInbox,
      canSendMessages:    s.canSendMessages,
      canViewCompanies:   s.canViewCompanies,
      canCreateCompanies: s.canCreateCompanies,
      userIds:            s.users.map((u) => u.userId),
      instanceIds:        s.instances.map((i) => i.instanceId),
    });
    setEditing(s);
  }

  function closePanel() {
    setCreating(false);
    setEditing(null);
    setSaveError(null);
  }

  function toggleId(field: "userIds" | "instanceIds", id: string) {
    setForm((prev) => {
      const arr = prev[field];
      return { ...prev, [field]: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] };
    });
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) {
        const res = await fetch(`/api/setores/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (res.ok) {
          const updated: Setor = await res.json();
          setSetores((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
          closePanel();
        } else {
          const err = await res.json().catch(() => ({}));
          setSaveError(err.error ?? `Erro ${res.status}`);
        }
      } else {
        const res = await fetch("/api/setores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (res.ok) {
          const created: Setor = await res.json();
          setSetores((prev) => [...prev, created]);
          closePanel();
        } else {
          const err = await res.json().catch(() => ({}));
          setSaveError(err.error ?? `Erro ${res.status}`);
        }
      }
    } catch (e: any) {
      setSaveError(e?.message ?? "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este setor? Os chamados vinculados perderão o setor.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/setores/${id}`, { method: "DELETE" });
      if (res.ok) setSetores((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  const panelOpen = creating || !!editing;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Lista de setores */}
      <div className={`flex flex-col ${panelOpen ? "w-[340px] min-w-[340px]" : "flex-1"} border-r border-[#1e2d45] overflow-y-auto transition-all`}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-white font-bold text-base">Setores</h2>
            <p className="text-slate-500 text-xs mt-0.5">Times e controle de acesso por departamento</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
          >
            + Novo Setor
          </button>
        </div>

        {setores.length === 0 && !panelOpen && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-8 py-16">
            <span className="text-5xl">🏷️</span>
            <p className="text-slate-400 text-sm font-medium">Nenhum setor criado ainda</p>
            <p className="text-slate-600 text-xs">Crie setores para controlar quais instâncias e áreas do sistema cada time pode acessar.</p>
          </div>
        )}

        <div className="px-4 pb-6 space-y-3">
          {setores.map((s) => {
            const isEditingThis = editing?.id === s.id;
            return (
              <div
                key={s.id}
                className={`rounded-xl border p-4 transition-colors ${isEditingThis ? "border-indigo-500/50 bg-indigo-500/5" : "border-[#1e2d45] bg-[#0c1220] hover:border-[#2a3a55]"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{s.name}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      <span className="text-slate-500 text-[11px]">👥 {s.users.length} usuário{s.users.length !== 1 ? "s" : ""}</span>
                      <span className="text-slate-500 text-[11px]">📱 {s.instances.length} instância{s.instances.length !== 1 ? "s" : ""}</span>
                      {s._count.tickets > 0 && (
                        <span className="text-slate-500 text-[11px]">🎫 {s._count.tickets} chamado{s._count.tickets !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => openEdit(s)}
                      className="px-2.5 py-1 rounded-lg bg-[#1e2d45] hover:bg-[#2a3a55] text-slate-300 text-[11px] transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={deleting === s.id}
                      className="px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] transition-colors disabled:opacity-50"
                    >
                      {deleting === s.id ? "..." : "✕"}
                    </button>
                  </div>
                </div>

                {/* Resumo de permissões */}
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {ALL_PERMS.filter((p) => (s as any)[p.key] as boolean).map((p) => (
                    <span key={p.key} className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">
                      {p.label}
                    </span>
                  ))}
                </div>

                {/* Usuários */}
                {s.users.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {s.users.map((u) => (
                      <span key={u.userId} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-400">
                        {u.user.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Painel de criação/edição */}
      {panelOpen && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-6 pb-10 max-w-lg">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-white font-bold text-base">
                {editing ? `Editar: ${editing.name}` : "Novo Setor"}
              </h3>
              <button onClick={closePanel} className="text-slate-500 hover:text-slate-300 text-sm">✕ Fechar</button>
            </div>

            {/* Nome */}
            <div className="mb-5">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">Nome do Setor</label>
              <input
                autoFocus
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="ex: Vendas, Suporte, Financeiro..."
                className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Permissões */}
            <div className="mb-6">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider block mb-3">Permissões</label>
              <div className="space-y-4">
                {PERM_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-slate-600 text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-1">{group.label}</p>
                    <div className="space-y-1.5">
                      {group.perms.map((p) => (
                        <div key={p.key} className="flex items-center justify-between gap-4 px-3 py-2.5 rounded-lg bg-[#0c1220] border border-[#1e2d45]">
                          <div>
                            <p className="text-white text-xs font-medium">{p.label}</p>
                            <p className="text-slate-600 text-[10px]">{p.desc}</p>
                          </div>
                          <Toggle
                            checked={(form as any)[p.key] as boolean}
                            onChange={(v) => setForm((prev) => ({ ...prev, [p.key]: v }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Instâncias WhatsApp */}
            <div className="mb-6">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider block mb-3">
                Instâncias WhatsApp
                <span className="text-slate-600 normal-case font-normal ml-1.5">— quais chips este setor pode ver e usar</span>
              </label>
              {allInstances.length === 0 ? (
                <p className="text-slate-600 text-xs">Nenhuma instância cadastrada.</p>
              ) : (
                <div className="space-y-1.5">
                  {allInstances.map((inst) => {
                    const checked = form.instanceIds.includes(inst.id);
                    return (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={() => toggleId("instanceIds", inst.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                          checked ? "border-indigo-500/50 bg-indigo-500/5" : "border-[#1e2d45] bg-[#0c1220] hover:border-[#2a3a55]"
                        }`}
                      >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[inst.status] ?? "bg-slate-600"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-medium truncate">{inst.instanceName}</p>
                          {inst.phone && <p className="text-slate-600 text-[10px] font-mono">{inst.phone}</p>}
                        </div>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? "bg-indigo-600 border-indigo-600" : "border-slate-600"}`}>
                          {checked && <span className="text-white text-[10px] font-bold">✓</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Usuários */}
            <div className="mb-8">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider block mb-3">
                Usuários do Setor
                <span className="text-slate-600 normal-case font-normal ml-1.5">— podem pertencer a mais de um</span>
              </label>
              {allUsers.length === 0 ? (
                <p className="text-slate-600 text-xs">Nenhum usuário cadastrado.</p>
              ) : (
                <div className="space-y-1.5">
                  {allUsers.map((u) => {
                    const checked = form.userIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleId("userIds", u.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                          checked ? "border-indigo-500/50 bg-indigo-500/5" : "border-[#1e2d45] bg-[#0c1220] hover:border-[#2a3a55]"
                        }`}
                      >
                        <div className="w-7 h-7 rounded-full bg-[#1e2d45] flex items-center justify-center text-xs font-bold text-slate-400 flex-shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-medium truncate">{u.name}</p>
                          <p className="text-slate-600 text-[10px] truncate">{u.email}</p>
                        </div>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? "bg-indigo-600 border-indigo-600" : "border-slate-600"}`}>
                          {checked && <span className="text-white text-[10px] font-bold">✓</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Erro */}
            {saveError && (
              <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                ⚠️ {saveError}
              </div>
            )}

            {/* Ações */}
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {saving ? "Salvando..." : editing ? "Salvar Alterações" : "Criar Setor"}
              </button>
              <button
                onClick={closePanel}
                className="px-4 py-2.5 rounded-lg border border-[#1e2d45] text-slate-400 text-sm hover:text-white transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
