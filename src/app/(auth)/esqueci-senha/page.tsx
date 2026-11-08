"use client";

import { useState } from "react";
import Link from "next/link";
import GohubLogo from "@/components/GohubLogo";

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
    <div className="min-h-screen bg-[#0B0B0D] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <GohubLogo size={34} />
          <div className="text-xs text-white/50">Painel do seu negócio</div>
        </div>

        <div className="bg-[#141217] border border-[#26222B] rounded-2xl p-8">
          {sent ? (
            <>
              <h1 className="text-white font-bold text-xl mb-1">Verifique seu email</h1>
              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                Se houver uma conta com <b className="text-slate-200">{email.trim()}</b>, enviamos um link para redefinir a senha. O link expira em 1 hora.
              </p>
              <Link href="/login" className="block text-center w-full bg-[#FF2E96] hover:bg-[#E0167C] text-white font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition-opacity">
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
                    className="w-full bg-[#0B0B0D] border border-[#2E2933] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#FF2E96] transition-colors"
                    placeholder="seu@email.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#FF2E96] hover:bg-[#E0167C] text-white font-semibold rounded-lg py-2.5 text-sm mt-1 hover:opacity-90 transition-opacity disabled:opacity-50"
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
