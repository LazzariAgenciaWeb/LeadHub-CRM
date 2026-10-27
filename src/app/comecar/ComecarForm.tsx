"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Check, Loader2, MessageCircle, MousePointerClick, Store } from "lucide-react";
import { BIO_PASSWORD_MIN } from "@/lib/bio-page";

const OTHER = "__outro__";

export default function ComecarForm({
  segments, refSlug, refTitle,
}: {
  segments: string[];
  refSlug: string | null;
  refTitle: string | null;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    businessName: "", segment: "", otherSegment: "", city: "", name: "", email: "", phone: "", password: "",
  });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [website, setWebsite] = useState(""); // armadilha pra robô
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setError(null);
    setEmailTaken(false);
    const segment = f.segment === OTHER ? f.otherSegment.trim() : f.segment;
    if (!segment) return setError("Escolha o ramo do negócio.");
    if (f.password.length < BIO_PASSWORD_MIN) return setError(`A senha precisa de pelo menos ${BIO_PASSWORD_MIN} caracteres.`);
    if (!acceptTerms) return setError("É preciso aceitar os termos para criar a conta.");

    setSending(true);
    try {
      const res = await fetch("/api/comecar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, segment, acceptTerms, website, ref: refSlug }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Não deu pra criar a conta agora. Tente de novo.");
        setEmailTaken(!!j.emailTaken);
        return;
      }
      const login = await signIn("credentials", { email: f.email.trim().toLowerCase(), password: f.password, redirect: false });
      if (login?.error) {
        router.push("/login");
        return;
      }
      router.push("/pagina");
    } catch {
      setError("Sem conexão. Tente de novo.");
    } finally {
      setSending(false);
    }
  }

  const input = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500";
  const label = "block text-xs font-semibold text-slate-600 mb-1";

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-slate-900">
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 lg:grid-cols-2 lg:py-16">
        {/* Proposta */}
        <section className="lg:pt-6">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Grátis, sem cartão</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
            Seu link na bio que transforma visita em contato
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Monte em minutos uma página com seus serviços e perguntas rápidas. Quem responde deixa nome e WhatsApp — e você sabe exatamente quem quer o quê.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-slate-700">
            {[
              [Store, "Vitrine dos seus serviços, com foto e preço"],
              [MousePointerClick, "Perguntas com botões que qualificam o cliente"],
              [MessageCircle, "Contato direto na sua lista, com nome e telefone"],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Store;
              return (
                <li key={text as string} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                    <I className="h-4 w-4" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
          {refTitle && (
            <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200">
              <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
              <span>Você conheceu pela página de <strong>{refTitle}</strong></span>
            </p>
          )}
        </section>

        {/* Formulário */}
        <form onSubmit={submit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8 space-y-4">
          <h2 className="text-lg font-bold">Crie sua página</h2>

          <div>
            <label className={label} htmlFor="c-business">Nome do negócio</label>
            <input id="c-business" className={input} maxLength={80} required value={f.businessName} onChange={set("businessName")} placeholder="Ex.: Pet Feliz" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="c-segment">Ramo</label>
              <select id="c-segment" className={input} required value={f.segment} onChange={set("segment")}>
                <option value="" disabled>Escolha…</option>
                {segments.map((s) => <option key={s} value={s}>{s}</option>)}
                <option value={OTHER}>Outro</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor="c-city">Cidade</label>
              <input id="c-city" className={input} maxLength={60} required value={f.city} onChange={set("city")} placeholder="Ex.: Maripá" />
            </div>
          </div>
          {f.segment === OTHER && (
            <input className={input} maxLength={60} required value={f.otherSegment} onChange={set("otherSegment")} placeholder="Qual é o ramo?" aria-label="Qual é o ramo?" />
          )}
          <div>
            <label className={label} htmlFor="c-name">Seu nome</label>
            <input id="c-name" className={input} maxLength={80} required autoComplete="name" value={f.name} onChange={set("name")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="c-email">E-mail</label>
              <input id="c-email" type="email" className={input} maxLength={200} required autoComplete="email" value={f.email} onChange={set("email")} />
            </div>
            <div>
              <label className={label} htmlFor="c-phone">WhatsApp</label>
              <input id="c-phone" className={input} maxLength={30} required autoComplete="tel" inputMode="tel" value={f.phone} onChange={set("phone")} placeholder="(44) 99999-0000" />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="c-password">Crie uma senha</label>
            <input id="c-password" type="password" className={input} minLength={BIO_PASSWORD_MIN} required autoComplete="new-password" value={f.password} onChange={set("password")} placeholder={`Pelo menos ${BIO_PASSWORD_MIN} caracteres`} />
          </div>
          <input
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-indigo-600" />
            <span>
              Concordo em criar a conta e em receber contato da equipe sobre a minha página e serviços de site. Meus dados não são compartilhados com terceiros.
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-600">
              {error}{" "}
              {emailTaken && <Link href="/login" className="font-semibold underline">Entrar</Link>}
            </p>
          )}

          <button
            type="submit"
            disabled={sending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar minha página grátis
          </button>
          <p className="text-center text-xs text-slate-500">
            Já tem conta? <Link href="/login" className="font-semibold text-indigo-600">Entrar</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
