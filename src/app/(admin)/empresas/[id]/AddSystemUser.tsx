"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

export default function AddSystemUser({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"CLIENT" | "ADMIN">("CLIENT");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string; name: string } | null>(null);

  function reset() {
    setName(""); setEmail(""); setRole("CLIENT"); setPhone("");
    setError(null); setCreated(null); setSaving(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, phone: phone || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao criar usuário");
      setCreated({ email: data.user.email, password: data.tempPassword, name: data.user.name });
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-bold text-sm">Usuários & acessos</h2>
          <p className="text-slate-500 text-xs mt-0.5">Crie um login direto — o usuário recebe as credenciais por email.</p>
        </div>
        <button
          onClick={() => { reset(); setOpen(true); }}
          className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-xs px-3.5 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          <UserPlus className="w-4 h-4" strokeWidth={2.25} />
          Adicionar usuário
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <h2 className="text-white font-bold text-base">
                {created ? "✓ Usuário criado" : "Adicionar usuário"}
              </h2>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            {created ? (
              <div className="p-6 space-y-4">
                <p className="text-slate-400 text-sm">
                  Login criado para <strong className="text-white">{created.name}</strong>. As credenciais foram enviadas por email
                  {" "}(com o vídeo de introdução, se configurado). Guarde a senha temporária:
                </p>
                <div className="bg-[#080b12] border border-[#1e2d45] rounded-lg p-4 space-y-1.5">
                  <div className="text-xs text-slate-400">Email: <span className="text-white font-medium">{created.email}</span></div>
                  <div className="text-xs text-slate-400">Senha temporária: <code className="text-white text-sm">{created.password}</code></div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => { navigator.clipboard?.writeText(`Email: ${created.email}\nSenha: ${created.password}`); }}
                    className="flex-1 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white text-sm transition-colors"
                  >
                    Copiar credenciais
                  </button>
                  <button
                    onClick={() => reset()}
                    className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                  >
                    Adicionar outro
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="p-6 space-y-4">
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Nome</label>
                  <input
                    value={name} onChange={(e) => setName(e.target.value)} required autoFocus
                    placeholder="Nome do usuário"
                    className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Email (será o login)</label>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                    placeholder="nome@empresa.com"
                    className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">Papel</label>
                    <select
                      value={role} onChange={(e) => setRole(e.target.value as "CLIENT" | "ADMIN")}
                      className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="CLIENT">Atendente</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">WhatsApp (opcional)</label>
                    <input
                      value={phone} onChange={(e) => setPhone(e.target.value)}
                      placeholder="5544999999999"
                      className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit" disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Criando..." : "Criar usuário e enviar acesso"}
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
    </>
  );
}
