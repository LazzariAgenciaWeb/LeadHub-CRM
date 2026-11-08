"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import GohubLogo from "@/components/GohubLogo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Email ou senha incorretos.");
    } else {
      // callbackUrl (ex.: consentimento OAuth do MCP) — só caminhos internos.
      const cb = new URLSearchParams(window.location.search).get("callbackUrl") ?? "";
      let target = "/";
      if (cb.startsWith("/") && !cb.startsWith("//")) target = cb;
      else if (/^https?:\/\//.test(cb)) { try { const u = new URL(cb); if (u.origin === window.location.origin) target = u.pathname + u.search; } catch {} }
      // Vai pra "/" e deixa o roteamento central decidir: empresa-cliente
      // (sub-company) cai no "Meu espaço"; agência/super-admin no dashboard.
      router.push(target);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B0B0D] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <GohubLogo size={34} />
          <div className="text-xs text-white/50">Painel do seu negócio</div>
        </div>

        {/* Card */}
        <div className="bg-[#141217] border border-[#26222B] rounded-2xl p-8">
          <h1 className="text-white font-bold text-xl mb-1">Bem-vindo de volta</h1>
          <p className="text-slate-500 text-sm mb-6">Entre com sua conta para continuar</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[#0B0B0D] border border-[#2E2933] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#FF2E96] transition-colors"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-1.5 block">
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#0B0B0D] border border-[#2E2933] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#FF2E96] transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#FF2E96] hover:bg-[#E0167C] text-white font-semibold rounded-lg py-2.5 text-sm mt-1 hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className="text-center mt-5">
            <Link href="/esqueci-senha" className="text-slate-500 hover:text-[#FF2E96] text-sm transition-colors">
              Esqueci minha senha
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
