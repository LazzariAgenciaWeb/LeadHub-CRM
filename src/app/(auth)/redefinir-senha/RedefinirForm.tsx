"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RedefinirForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("A senha precisa ter ao menos 6 caracteres."); return; }
    if (password !== confirm) { setError("As senhas não conferem."); return; }
    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (res.ok) {
      setDone(true);
      setTimeout(() => router.push("/login"), 2200);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Não foi possível redefinir. Peça um novo link.");
    }
  }

  return (
    <div className="min-h-screen bg-[#080b12] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-lg font-bold">⚡</div>
          <div>
            <div className="text-white font-bold text-xl leading-none">LeadHub</div>
            <div className="text-slate-500 text-xs">Marketing CRM</div>
          </div>
        </div>

        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl p-8">
          {!token ? (
            <>
              <h1 className="text-white font-bold text-xl mb-1">Link inválido</h1>
              <p className="text-slate-400 text-sm mb-6">Este link de redefinição não é válido. Peça um novo.</p>
              <Link href="/esqueci-senha" className="block text-center w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition-opacity">Pedir novo link</Link>
            </>
          ) : done ? (
            <>
              <h1 className="text-white font-bold text-xl mb-1">Senha redefinida ✓</h1>
              <p className="text-slate-400 text-sm mb-6">Sua senha foi atualizada. Redirecionando para o login…</p>
              <Link href="/login" className="block text-center w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition-opacity">Ir para o login</Link>
            </>
          ) : (
            <>
              <h1 className="text-white font-bold text-xl mb-1">Nova senha</h1>
              <p className="text-slate-500 text-sm mb-6">Escolha uma nova senha para sua conta.</p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">Nova senha</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus minLength={6}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors" placeholder="••••••••" />
                </div>
                <div>
                  <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">Confirmar senha</label>
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors" placeholder="••••••••" />
                </div>
                {error && <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading}
                  className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg py-2.5 text-sm mt-1 hover:opacity-90 transition-opacity disabled:opacity-50">
                  {loading ? "Salvando..." : "Redefinir senha"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
