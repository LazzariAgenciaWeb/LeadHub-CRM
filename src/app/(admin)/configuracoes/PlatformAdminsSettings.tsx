"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, UserPlus, Building2 } from "lucide-react";

/**
 * Configurações → Administradores (SUPER_ADMIN only).
 *
 * Cria outro dono de plataforma e, no mesmo passo, a "conta interna" dele numa
 * empresa. O vínculo (User.linkedSuperAdminId) é o que faz o assistente
 * pessoal, os pontos e as mensagens saírem no nome da pessoa quando ela
 * impersona aquela empresa — cada um com o bloquinho, os lembretes e as
 * tarefas dele.
 */

export type PlatformAdmin = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  isMe: boolean;
  linked: { id: string; name: string; email: string; role: string; companyId: string | null; companyName: string | null }[];
};

type Created = {
  superAdmin: { name: string; email: string; tempPassword: string };
  internal: { name: string; email: string; role: string; password: string | null; created: boolean; companyName: string } | null;
};

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", CLIENT: "Atendente", SUPER_ADMIN: "Super admin" };

export default function PlatformAdminsSettings({
  admins,
  companies,
}: {
  admins: PlatformAdmin[];
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [internalEmail, setInternalEmail] = useState("");
  const [internalRole, setInternalRole] = useState<"ADMIN" | "CLIENT">("ADMIN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName(""); setEmail(""); setCompanyId(""); setInternalEmail(""); setInternalRole("ADMIN");
    setError(null); setCreated(null); setSaving(false); setCopied(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/admin/super-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email,
          companyId: companyId || undefined,
          internalEmail: companyId ? internalEmail : undefined,
          internalRole: companyId ? internalRole : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao criar administrador");
      setCreated(data);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  function copyCreds() {
    if (!created) return;
    const lines = [
      `Plataforma (controla todos os clientes)`,
      `E-mail: ${created.superAdmin.email}`,
      `Senha: ${created.superAdmin.tempPassword}`,
    ];
    if (created.internal?.password) {
      lines.push("", `Conta interna — ${created.internal.companyName}`, `E-mail: ${created.internal.email}`, `Senha: ${created.internal.password}`);
    }
    navigator.clipboard?.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-indigo-400" strokeWidth={2.25} />
          </div>
          <h1 className="text-white font-bold text-lg">Administradores da plataforma</h1>
        </div>
        <button
          onClick={() => { reset(); setOpen(true); }}
          className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-xs px-3.5 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          <UserPlus className="w-4 h-4" strokeWidth={2.25} />
          Novo administrador
        </button>
      </div>
      <p className="text-slate-500 text-xs mb-5">
        Super admin vê e gerencia todos os clientes. A conta interna vinculada é a identidade da pessoa dentro de uma
        empresa — é por ela que o assistente pessoal, os lembretes e as tarefas ficam só dela.
      </p>

      <div className="space-y-2.5">
        {admins.map((a) => (
          <div key={a.id} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl px-4 py-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-semibold text-sm">{a.name}</span>
              {a.isMe && <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/15 border border-indigo-500/25 rounded px-1.5 py-0.5">você</span>}
            </div>
            <div className="text-slate-500 text-xs mt-0.5">{a.email}</div>
            {a.linked.length > 0 ? (
              <div className="mt-2.5 space-y-1">
                {a.linked.map((u) => (
                  <div key={u.id} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Building2 className="w-3.5 h-3.5 text-slate-600" strokeWidth={2.25} />
                    <span className="text-slate-300">{u.companyName ?? "—"}</span>
                    <span className="text-slate-600">·</span>
                    <span>{u.name} ({ROLE_LABEL[u.role] ?? u.role})</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-slate-600">
                Sem conta interna vinculada — impersonando, aparece com a identidade de plataforma.
              </div>
            )}
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <h2 className="text-white font-bold text-base">{created ? "✓ Administrador criado" : "Novo administrador"}</h2>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            {created ? (
              <div className="p-6 space-y-4">
                <p className="text-slate-400 text-sm">
                  Credenciais enviadas por e-mail. Guarde as senhas temporárias — elas não aparecem de novo:
                </p>
                <div className="bg-[#080b12] border border-[#1e2d45] rounded-lg p-4 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">Plataforma (todos os clientes)</div>
                  <div className="text-xs text-slate-400">E-mail: <span className="text-white font-medium">{created.superAdmin.email}</span></div>
                  <div className="text-xs text-slate-400">Senha: <code className="text-white text-sm">{created.superAdmin.tempPassword}</code></div>
                </div>
                {created.internal && (
                  <div className="bg-[#080b12] border border-[#1e2d45] rounded-lg p-4 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">Conta interna · {created.internal.companyName}</div>
                    <div className="text-xs text-slate-400">E-mail: <span className="text-white font-medium">{created.internal.email}</span></div>
                    {created.internal.password ? (
                      <div className="text-xs text-slate-400">Senha: <code className="text-white text-sm">{created.internal.password}</code></div>
                    ) : (
                      <div className="text-xs text-slate-500">Conta que já existia — senha mantida, só o vínculo foi criado.</div>
                    )}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={copyCreds}
                    className="flex-1 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white text-sm transition-colors"
                  >
                    {copied ? "Copiado!" : "Copiar credenciais"}
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="p-6 space-y-4">
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Nome</label>
                  <input
                    value={name} onChange={(e) => setName(e.target.value)} required autoFocus
                    placeholder="Nome da pessoa"
                    className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">E-mail de plataforma (login do super admin)</label>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                    placeholder="nome@lazzari.net.br"
                    className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="border-t border-[#1e2d45] pt-4 space-y-3">
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">Conta interna (opcional)</label>
                    <select
                      value={companyId} onChange={(e) => setCompanyId(e.target.value)}
                      className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">Sem conta interna</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <p className="text-[11px] text-slate-600 mt-1.5">
                      Dá a ele uma identidade dentro da empresa: assistente pessoal, lembretes e tarefas próprios, e o
                      que ele fizer lá sai no nome dele.
                    </p>
                  </div>
                  {companyId && (
                    <div className="grid grid-cols-[1fr_auto] gap-3">
                      <div>
                        <label className="block text-slate-400 text-xs font-medium mb-1.5">E-mail na empresa</label>
                        <input
                          type="email" value={internalEmail} onChange={(e) => setInternalEmail(e.target.value)} required
                          placeholder="nome@empresa.com.br"
                          className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                        <p className="text-[11px] text-slate-600 mt-1.5">Se a conta já existir, o vínculo é só criado.</p>
                      </div>
                      <div>
                        <label className="block text-slate-400 text-xs font-medium mb-1.5">Papel</label>
                        <select
                          value={internalRole} onChange={(e) => setInternalRole(e.target.value as "ADMIN" | "CLIENT")}
                          className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="ADMIN">Admin</option>
                          <option value="CLIENT">Atendente</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit" disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Criando..." : "Criar e enviar acesso"}
                  </button>
                  <button
                    type="button" onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-sm transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
