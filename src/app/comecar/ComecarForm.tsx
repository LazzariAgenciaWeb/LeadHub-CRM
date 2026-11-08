"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Check, Loader2, MessageCircle, MousePointerClick, Store } from "lucide-react";
import { BIO_PASSWORD_MIN } from "@/lib/bio-page";
import { Inter_Tight } from "next/font/google";
import GohubLogo from "@/components/GohubLogo";

const display = Inter_Tight({ subsets: ["latin"], weight: ["800"], display: "swap" });

const OTHER = "__outro__";

export default function ComecarForm({
  segments, refSlug, refTitle, appBase, plan = null,
}: {
  segments: string[];
  refSlug: string | null;
  refTitle: string | null;
  /** Painel (login/editor) — o cadastro pode abrir em outro domínio (gohub.com.br). */
  appBase: string;
  /** Plano escolhido no site: depois do cadastro o editor abre o pagamento. */
  plan?: { slug: string; label: string; price: number } | null;
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
        body: JSON.stringify({ ...f, segment, acceptTerms, website, ref: refSlug, plano: plan?.slug ?? null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Não deu pra criar a conta agora. Tente de novo.");
        setEmailTaken(!!j.emailTaken);
        return;
      }
      // Código de uso único: entra no painel já logado, em qualquer domínio.
      if (typeof j.next === "string" && j.next) {
        window.location.assign(j.next);
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

  const input = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#FF2E96] focus:ring-2 focus:ring-[#FF2E96]/15";
  const label = "block text-xs font-semibold text-slate-600 mb-1";

  return (
    <div className="min-h-screen bg-white text-[#16131A]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <a href="https://gohub.com.br" aria-label="GoHub"><GohubLogo tone="light" size={28} /></a>
        <Link href={`${appBase}/login`} className="text-sm font-semibold text-slate-600 hover:text-[#D6157A]">Entrar</Link>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-12 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        {/* Proposta */}
        <section className="rounded-3xl bg-[#0B0B0D] p-7 text-white sm:p-10">
          <p className="inline-flex rounded-full bg-[#FF2E96]/15 px-3 py-1 text-xs font-bold text-[#FF2E96]">Grátis, sem cartão</p>
          <h1 className={`${display.className} mt-4 text-[34px] font-extrabold leading-[1.05] tracking-[-0.04em] sm:text-5xl`}>
            O link da sua bio agora traz cliente pelo WhatsApp.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-white/70">
            Monte em minutos a página do seu negócio com WhatsApp, serviços e redes sociais. Fica no ar no endereço gohub.com.br/p/seu-negocio.
          </p>
          <ul className="mt-8 space-y-3.5 text-sm text-white/85">
            {[
              [Store, "Seus serviços e redes num link só"],
              [MessageCircle, "Botão de WhatsApp a um toque"],
              [MousePointerClick, "No Pro: formulário que qualifica o cliente antes da conversa"],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Store;
              return (
                <li key={text as string} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/5 text-[#FF2E96] ring-1 ring-white/10">
                    <I className="h-4 w-4" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
          {refTitle && (
            <p className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/70 ring-1 ring-white/10">
              <Check className="h-3.5 w-3.5 flex-shrink-0 text-[#FF2E96]" />
              <span>Você conheceu pela página de <strong className="text-white">{refTitle}</strong></span>
            </p>
          )}
        </section>

        {/* Formulário */}
        <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-200 sm:p-8 lg:mt-0">
          <div>
            <h2 className={`${display.className} text-2xl font-extrabold tracking-[-0.03em]`}>Crie sua página</h2>
            <p className="mt-1 text-sm text-slate-500">Leva 2 minutos. Depois você monta tudo no painel.</p>
          </div>
          {plan && (
            <p className="rounded-xl bg-[#0B0B0D] px-3.5 py-2.5 text-xs text-white">
              Plano <strong className="text-[#FF2E96]">{plan.label}</strong> (R$ {plan.price.toFixed(2).replace(".", ",")}/mês). Depois de criar a conta, você vai direto para o pagamento.
            </p>
          )}

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
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#FF2E96]" />
            <span>
              Concordo em criar a conta e em receber contato da equipe sobre a minha página e serviços de site. Meus dados não são compartilhados com terceiros.
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-600">
              {error}{" "}
              {emailTaken && <Link href={`${appBase}/login`} className="font-semibold underline">Entrar</Link>}
            </p>
          )}

          <button
            type="submit"
            disabled={sending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#D6157A] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#B80F67] disabled:opacity-60"
          >
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            {plan ? `Criar conta e assinar o ${plan.label}` : "Criar minha página grátis"}
          </button>
          <p className="text-center text-xs text-slate-500">
            Já tem conta? <Link href={`${appBase}/login`} className="font-semibold text-[#D6157A]">Entrar</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
