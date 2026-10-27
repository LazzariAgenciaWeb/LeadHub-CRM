"use client";

import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, Check, ChevronRight, Globe, Loader2, Mail, MessageCircle, Phone, X,
} from "lucide-react";
import type { BioClientEvent } from "@/lib/bio-page";

export interface BioViewBlock {
  id: string;
  type: "LINK" | "SERVICE" | "SOCIAL";
  title: string;
  description: string | null;
  href: string | null;
  imageUrl: string | null;
  priceLabel: string | null;
  network: string | null;
}

export interface BioViewData {
  slug: string;
  template: "CARTAO" | "VITRINE";
  title: string;
  headline: string | null;
  about: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  accent: string;
  blocks: BioViewBlock[];
  quiz: {
    title: string;
    cta: string;
    thankYou: string;
    consent: string;
    questions: { id: string; text: string; options: string[] }[];
  } | null;
}

// ─── Rastreio ────────────────────────────────────────────────────────────────
// Best-effort: sendBeacon sobrevive à navegação (clique em link externo). Sem
// cookie de terceiro — o visitante anônimo é um id no localStorage.

const VISITOR_KEY = "gh_bio_vid";

function visitorId(): string | null {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function origin() {
  const q = new URLSearchParams(window.location.search);
  return {
    visitorId: visitorId(),
    referrer: document.referrer || null,
    utmSource: q.get("utm_source"),
    utmMedium: q.get("utm_medium"),
    utmCampaign: q.get("utm_campaign"),
  };
}

function track(slug: string, kind: BioClientEvent, extra: { blockId?: string } = {}) {
  const body = JSON.stringify({ slug, kind, ...extra, ...origin() });
  try {
    if (navigator.sendBeacon?.("/api/pagina/evento", body)) return;
  } catch { /* cai no fetch */ }
  fetch("/api/pagina/evento", { method: "POST", body, keepalive: true }).catch(() => {});
}

// ─── Ícones de rede (lucide não traz marcas) ─────────────────────────────────

function NetworkIcon({ network, className }: { network: string | null; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch ((network ?? "").toLowerCase()) {
    case "instagram":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="4" />
          <path d="m10 9 5 3-5 3z" fill="currentColor" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 3c.5 2.8 2.4 4.5 5 4.8" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="20" height="20" rx="3" />
          <path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" />
        </svg>
      );
    case "whatsapp":
      return <MessageCircle className={className} aria-hidden />;
    case "email":
      return <Mail className={className} aria-hidden />;
    case "telefone":
    case "phone":
      return <Phone className={className} aria-hidden />;
    default:
      return <Globe className={className} aria-hidden />;
  }
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function BioPageView({ data }: { data: BioViewData }) {
  const { slug, accent, quiz } = data;
  const accentStyle = { "--accent": accent } as CSSProperties;

  const socials = data.blocks.filter((b) => b.type === "SOCIAL");
  const links = data.blocks.filter((b) => b.type === "LINK");
  const services = data.blocks.filter((b) => b.type === "SERVICE");

  const [openService, setOpenService] = useState<BioViewBlock | null>(null);
  const quizRef = useRef<QuizHandle>(null);

  // Uma visita por aba — recarregar a página não infla o número.
  useEffect(() => {
    const key = `gh_bio_view:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* sem storage: registra mesmo assim */ }
    track(slug, "VIEW");
  }, [slug]);

  function clickBlock(b: BioViewBlock) {
    track(slug, "CLICK", { blockId: b.id });
  }

  function interestFromService() {
    setOpenService(null);
    quizRef.current?.start();
  }

  return (
    <div style={accentStyle} className="min-h-screen bg-[#f4f5f7] text-slate-900">
      <div className="mx-auto w-full max-w-md px-4 pb-12">
        {/* ── Topo ── */}
        <header className="relative">
          {data.coverUrl ? (
            <div className="-mx-4 h-36 overflow-hidden sm:mx-0 sm:mt-4 sm:rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.coverUrl} alt="" className="h-full w-full object-cover" />
            </div>
          ) : (
            <div className="-mx-4 h-24 sm:mx-0 sm:mt-4 sm:rounded-2xl" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}99)` }} />
          )}
          <div className="-mt-12 flex flex-col items-center text-center">
            <div className="h-24 w-24 overflow-hidden rounded-full border-4 border-[#f4f5f7] bg-white shadow-sm">
              {data.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.avatarUrl} alt={data.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-white" style={{ background: accent }}>
                  {data.title.trim().charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <h1 className="mt-3 text-xl font-bold leading-tight">{data.title}</h1>
            {data.headline && <p className="mt-1 text-sm text-slate-600">{data.headline}</p>}

            {socials.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {socials.map((b) => (
                  <a
                    key={b.id}
                    href={b.href!}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => clickBlock(b)}
                    aria-label={b.title}
                    title={b.title}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:text-[var(--accent)]"
                  >
                    <NetworkIcon network={b.network} className="h-5 w-5" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </header>

        {data.about && (
          <p className="mt-5 whitespace-pre-line text-center text-sm leading-relaxed text-slate-600">{data.about}</p>
        )}

        {/* ── Perguntas: o próximo passo vem primeiro ── */}
        {quiz && <Quiz ref={quizRef} slug={slug} quiz={quiz} accent={accent} />}

        {/* ── Links ── */}
        {links.length > 0 && (
          <nav className="mt-5 space-y-3">
            {links.map((b) => (
              <a
                key={b.id}
                href={b.href!}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => clickBlock(b)}
                className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200 transition hover:ring-[var(--accent)]"
              >
                {b.network && (
                  <NetworkIcon network={b.network} className="h-5 w-5 flex-shrink-0 text-[var(--accent)]" />
                )}
                <span className="flex-1 text-left">
                  <span className="block text-sm font-semibold">{b.title}</span>
                  {b.description && <span className="block text-xs text-slate-500">{b.description}</span>}
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
              </a>
            ))}
          </nav>
        )}

        {/* ── Serviços ── */}
        {services.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Serviços</h2>
            {data.template === "VITRINE" ? (
              <div className="grid grid-cols-2 gap-3">
                {services.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => { clickBlock(b); setOpenService(b); }}
                    className="overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-[var(--accent)]"
                  >
                    <div className="aspect-square bg-slate-100">
                      {b.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white" style={{ background: `${accent}cc` }}>
                          {b.title.trim().charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug">{b.title}</p>
                      {b.priceLabel && <p className="mt-1 text-xs font-medium text-[var(--accent)]">{b.priceLabel}</p>}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                {services.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => { clickBlock(b); setOpenService(b); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                  >
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">{b.title}</span>
                      {b.priceLabel && <span className="block text-xs text-[var(--accent)]">{b.priceLabel}</span>}
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {openService && (
        <ServiceSheet
          block={openService}
          hasQuiz={!!quiz}
          onClose={() => setOpenService(null)}
          onInterest={interestFromService}
        />
      )}
    </div>
  );
}

// ─── Detalhe do serviço ──────────────────────────────────────────────────────

function ServiceSheet({
  block, hasQuiz, onClose, onInterest,
}: {
  block: BioViewBlock;
  hasQuiz: boolean;
  onClose: () => void;
  onInterest: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={block.title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white sm:rounded-3xl"
      >
        {block.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.imageUrl} alt="" className="aspect-video w-full object-cover" />
        )}
        <div className="p-5">
          <div className="flex items-start gap-3">
            <h3 className="flex-1 text-lg font-bold leading-snug">{block.title}</h3>
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
          {block.priceLabel && <p className="mt-1 text-sm font-semibold text-[var(--accent)]">{block.priceLabel}</p>}
          {block.description && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{block.description}</p>
          )}
          <div className="mt-5 space-y-2">
            {hasQuiz && (
              <button
                type="button"
                onClick={onInterest}
                className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Tenho interesse
              </button>
            )}
            {block.href && (
              <a
                href={block.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                Ver mais
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Perguntas + contato ─────────────────────────────────────────────────────

interface QuizHandle { start: () => void }

type Step = { kind: "intro" } | { kind: "question"; index: number } | { kind: "form" } | { kind: "done" };

function Quiz({
  ref, slug, quiz, accent,
}: {
  ref: React.Ref<QuizHandle>;
  slug: string;
  quiz: NonNullable<BioViewData["quiz"]>;
  accent: string;
}) {
  const { questions } = quiz;
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const boxRef = useRef<HTMLDivElement>(null);

  function start() {
    if (step.kind === "intro") track(slug, "QUIZ_START");
    if (step.kind !== "done") setStep(questions.length > 0 ? { kind: "question", index: 0 } : { kind: "form" });
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // "Tenho interesse" no detalhe do serviço abre as perguntas daqui.
  useImperativeHandle(ref, () => ({ start }));

  function answer(qId: string, option: string, index: number) {
    setAnswers((a) => ({ ...a, [qId]: option }));
    if (index + 1 < questions.length) {
      setStep({ kind: "question", index: index + 1 });
    } else {
      track(slug, "QUIZ_COMPLETE");
      setStep({ kind: "form" });
    }
  }

  function back() {
    if (step.kind === "question" && step.index > 0) setStep({ kind: "question", index: step.index - 1 });
    else if (step.kind === "form" && questions.length > 0) setStep({ kind: "question", index: questions.length - 1 });
    else setStep({ kind: "intro" });
  }

  const total = questions.length + 1;
  const position = step.kind === "question" ? step.index + 1 : step.kind === "form" ? total : 0;

  return (
    <div ref={boxRef} className="mt-6 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
      {step.kind === "intro" && (
        <div className="p-5 text-center">
          <p className="text-base font-semibold leading-snug">{quiz.title}</p>
          <button
            type="button"
            onClick={start}
            className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: accent }}
          >
            {quiz.cta}
          </button>
        </div>
      )}

      {(step.kind === "question" || step.kind === "form") && (
        <>
          <div className="h-1 bg-slate-100">
            <div className="h-full transition-all" style={{ width: `${(position / total) * 100}%`, background: accent }} />
          </div>
          <div className="p-5">
            <button type="button" onClick={back} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </button>

            {step.kind === "question" && (() => {
              const q = questions[step.index];
              return (
                <div>
                  <p className="text-xs font-medium text-slate-400">{step.index + 1} de {questions.length}</p>
                  <p className="mt-1 text-base font-semibold leading-snug">{q.text}</p>
                  <div className="mt-4 space-y-2">
                    {q.options.map((opt) => {
                      const chosen = answers[q.id] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => answer(q.id, opt, step.index)}
                          className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-medium ring-1 transition ${
                            chosen ? "text-white ring-transparent" : "bg-white text-slate-800 ring-slate-200 hover:ring-[var(--accent)]"
                          }`}
                          style={chosen ? { background: accent } : undefined}
                        >
                          {opt}
                          {chosen && <Check className="h-4 w-4" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {step.kind === "form" && (
              <ContactForm
                slug={slug}
                consent={quiz.consent}
                accent={accent}
                answers={questions.filter((q) => answers[q.id]).map((q) => ({ questionId: q.id, answer: answers[q.id] }))}
                onDone={() => setStep({ kind: "done" })}
              />
            )}
          </div>
        </>
      )}

      {step.kind === "done" && (
        <div className="p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white" style={{ background: accent }}>
            <Check className="h-6 w-6" />
          </div>
          <p className="mt-3 whitespace-pre-line text-sm font-medium leading-relaxed text-slate-700">{quiz.thankYou}</p>
        </div>
      )}
    </div>
  );
}

function ContactForm({
  slug, consent, accent, answers, onDone,
}: {
  slug: string;
  consent: string;
  accent: string;
  answers: { questionId: string; answer: string }[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [website, setWebsite] = useState(""); // armadilha pra robô
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setError(null);
    if (name.trim().length < 2) return setError("Informe seu nome.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Informe um telefone com DDD.");
    if (!agreed) return setError("Marque que concorda com o uso dos dados.");

    setSending(true);
    try {
      const res = await fetch("/api/pagina/contato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name, phone, email, consent: true, answers, website, ...origin() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Não deu pra enviar agora. Tente de novo.");
        return;
      }
      onDone();
    } catch {
      setError("Sem conexão. Tente de novo.");
    } finally {
      setSending(false);
    }
  }

  const input = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--accent)]";

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-base font-semibold leading-snug">Pra onde a gente manda a resposta?</p>
      <input className={input} placeholder="Seu nome" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      <input className={input} placeholder="WhatsApp ou telefone com DDD" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
      <input className={input} placeholder="E-mail (opcional)" autoComplete="email" inputMode="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
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
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ accentColor: accent }} />
        <span>{consent}</span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={sending}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        style={{ background: accent }}
      >
        {sending && <Loader2 className="h-4 w-4 animate-spin" />}
        Enviar
      </button>
    </form>
  );
}
