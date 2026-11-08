"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import GohubLogo from "@/components/GohubLogo";

// /entrar#t=CÓDIGO — fim do cadastro feito em outro domínio (gohub.com.br).
// Troca o código de uso único por sessão aqui no painel e abre o editor.
// O código vem no #fragmento: não vai pro servidor em log nem em Referer.

export default function EntrarPage() {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const token = hash.get("t");
    const assinar = hash.get("assinar");
    const dest = assinar && /^[A-Z_]{3,20}$/.test(assinar) ? `/pagina?assinar=${assinar}` : "/pagina";
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      window.location.replace("/login");
      return;
    }
    signIn("credentials", { handoff: token, redirect: false })
      .then((r) => {
        if (r?.ok && !r.error) window.location.replace(dest);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-[#0B0B0D] px-4 text-center">
      <div className="flex flex-col items-center gap-6">
      <GohubLogo size={34} />
      {failed ? (
        <div className="max-w-sm">
          <p className="text-white font-semibold">Sua conta foi criada.</p>
          <p className="text-white/60 text-sm mt-1">Entre com o e-mail e a senha que você acabou de cadastrar.</p>
          <a href="/login" className="mt-4 inline-block rounded-xl bg-[#FF2E96] px-5 py-2.5 text-sm font-semibold text-white">Entrar</a>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-white/60 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Abrindo sua página…
        </p>
      )}
      </div>
    </main>
  );
}
