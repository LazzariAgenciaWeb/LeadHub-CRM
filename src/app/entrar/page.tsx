"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";

// /entrar#t=CÓDIGO — fim do cadastro feito em outro domínio (gohub.com.br).
// Troca o código de uso único por sessão aqui no painel e abre o editor.
// O código vem no #fragmento: não vai pro servidor em log nem em Referer.

export default function EntrarPage() {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      window.location.replace("/login");
      return;
    }
    signIn("credentials", { handoff: token, redirect: false })
      .then((r) => {
        if (r?.ok && !r.error) window.location.replace("/pagina");
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4 text-center">
      {failed ? (
        <div className="max-w-sm">
          <p className="text-slate-800 font-semibold">Sua conta foi criada.</p>
          <p className="text-slate-500 text-sm mt-1">Entre com o e-mail e a senha que você acabou de cadastrar.</p>
          <a href="/login" className="mt-4 inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white">Entrar</a>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Abrindo sua página…
        </p>
      )}
    </main>
  );
}
