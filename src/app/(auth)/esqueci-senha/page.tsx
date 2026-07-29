"use client";

import { useState } from "react";
import Link from "next/link";

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => {});
    setLoading(false);
    setSent(true);
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
          {sent ? (
            <>
              <h1 className="text-white font-bold text-xl mb-1">Verifique seu email</h1>
              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                Se houver uma conta com <b className="text-slate-200">{email.trim()}</b>, enviamos um link para redefinir a senha. O link expira em 1 hora.
              </p>
              <Link href="/login" className="block text-center w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition-opacity">
                Voltar para o login
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-white font-bold text-xl mb-1">Esqueceu a senha?</h1>
              <p className="text-slate-500 text-sm mb-6">Informe seu email e enviaremos um link para redefinir.</p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 transition-colors"
                    placeholder="seu@email.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg py-2.5 text-sm mt-1 hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {loading ? "Enviando..." : "Enviar link de redefinição"}
                </button>
              </form>
              <div className="text-center mt-5">
                <Link href="/login" className="text-slate-500 hover:text-slate-300 text-sm transition-colors">← Voltar para o login</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
