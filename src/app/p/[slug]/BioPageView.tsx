"use client";

import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, ArrowRight, Briefcase, CalendarDays, Check, ChevronRight, Clock, Globe, House, Link2, Loader2, Mail, MapPin, Phone,
  Sparkles, X,
} from "lucide-react";
import { bioOnAccent, type BioClientEvent, type BioFixedTarget } from "@/lib/bio-page";
import { BRAND_ICONS } from "@/lib/brand-icons";

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
  /** Rodapé "Feito com GoHub" → /comecar?ref=slug (página do plano grátis). */
  badge?: boolean;
  blocks: BioViewBlock[];
  quiz: {
    title: string;
    cta: string;
    thankYou: string;
    consent: string;
    questions: { id: string; text: string; options: string[]; multiple?: boolean }[];
  } | null;
  /** Link de agenda externo (seção depois dos serviços). */
  booking?: { href: string; text: string } | null;
  /** Contato no rodapé — links já saneados no servidor. */
  contact?: {
    phone: string | null; phoneHref: string | null;
    email: string | null; emailHref: string | null;
    address: string | null; mapsHref: string | null;
    hours: string | null;
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

function track(slug: string, kind: BioClientEvent, extra: { blockId?: string; target?: BioFixedTarget } = {}) {
  const body = JSON.stringify({ slug, kind, ...extra, ...origin() });
  try {
    if (navigator.sendBeacon?.("/api/pagina/evento", body)) return;
  } catch { /* cai no fetch */ }
  fetch("/api/pagina/evento", { method: "POST", body, keepalive: true }).catch(() => {});
}

// ─── Ícones de rede ──────────────────────────────────────────────────────────
// Marcas com o logo oficial na cor da marca (WhatsApp verde, Instagram rosa…):
// o visitante reconhece de bate-olho. E-mail, telefone e site seguem no lucide.

function NetworkIcon({ network, className }: { network: string | null; className?: string }) {
  const key = (network ?? "").toLowerCase();
  const brand = BRAND_ICONS[key];
  if (brand) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill={brand.hex} aria-hidden>
        <path d={brand.path} />
      </svg>
    );
  }
  switch (key) {
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

/**
 * `preview`: dentro do editor. Não registra evento nem envia contato, e o
 * detalhe do serviço abre dentro da moldura em vez de cobrir a tela toda.
 */
export default function BioPageView({ data, preview = false }: { data: BioViewData; preview?: boolean }) {
  const { slug, accent, quiz, booking, contact } = data;
  // --on-accent: texto legível sobre a cor da página (cor clara pede texto escuro).
  const accentStyle = { "--accent": accent, "--on-accent": bioOnAccent(accent) } as CSSProperties;

  const socials = data.blocks.filter((b) => b.type === "SOCIAL");
  const links = data.blocks.filter((b) => b.type === "LINK");
  const services = data.blocks.filter((b) => b.type === "SERVICE");
  const servicesHaveImages = services.some((b) => b.imageUrl);

  // Menu fixo: só as seções que a página tem (com pelo menos duas pra navegar).
  const sections = [
    { id: "inicio", label: "Início", Icon: House },
    ...(quiz ? [{ id: "comecar", label: "Começar", Icon: Sparkles }] : []),
    ...(links.length > 0 ? [{ id: "links", label: "Links", Icon: Link2 }] : []),
    ...(services.length > 0 ? [{ id: "servicos", label: "Serviços", Icon: Briefcase }] : []),
    ...(booking ? [{ id: "agenda", label: "Agenda", Icon: CalendarDays }] : []),
    ...(contact ? [{ id: "contato", label: "Contato", Icon: Phone }] : []),
  ];

  const [openService, setOpenService] = useState<BioViewBlock | null>(null);
  const quizRef = useRef<QuizHandle>(null);

  // Uma visita por aba — recarregar a página não infla o número.
  useEffect(() => {
    if (preview) return;
    const key = `gh_bio_view:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* sem storage: registra mesmo assim */ }
    track(slug, "VIEW");
  }, [slug, preview]);

  function clickBlock(b: BioViewBlock) {
    if (!preview) track(slug, "CLICK", { blockId: b.id });
  }

  function clickFixed(target: BioFixedTarget) {
    if (!preview) track(slug, "CLICK", { target });
  }

  function interestFromService() {
    setOpenService(null);
    quizRef.current?.start();
  }

  return (
    <div style={accentStyle} className={`relative bg-[#f4f5f7] text-slate-900 ${preview ? "min-h-full" : "min-h-screen"}`}>
      <div className="mx-auto w-full max-w-md px-4 pb-12">
        {/* ── Topo ── */}
        <header id="inicio" className="relative scroll-mt-4">
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
                <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-[var(--on-accent)]" style={{ background: accent }}>
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
        {quiz && (
          <div id="comecar" className="scroll-mt-4">
            <Quiz ref={quizRef} slug={slug} quiz={quiz} accent={accent} preview={preview} host={{ name: data.title, avatarUrl: data.avatarUrl }} />
          </div>
        )}

        {/* ── Links ── */}
        {links.length > 0 && (
          <nav id="links" className="mt-5 scroll-mt-4 space-y-3">
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
          <section id="servicos" className="mt-7 scroll-mt-4">
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
                        <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-[var(--on-accent)]" style={{ background: `${accent}cc` }}>
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
                    {/* Com imagem cadastrada, a lista ganha miniatura. Se só alguns têm,
                        os outros levam a inicial pra lista não ficar desalinhada. */}
                    {b.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.imageUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded-xl bg-slate-100 object-cover" />
                    ) : servicesHaveImages && (
                      <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl text-lg font-bold text-[var(--on-accent)]" style={{ background: `${accent}cc` }}>
                        {b.title.trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{b.title}</span>
                      {b.description && <span className="block truncate text-xs text-slate-500">{b.description}</span>}
                      {b.priceLabel && <span className="block text-xs font-medium text-[var(--accent)]">{b.priceLabel}</span>}
                    </span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Agenda (link externo do dono) ── */}
        {booking && (
          <section id="agenda" className="mt-7 scroll-mt-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Agenda</h2>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: `${accent}22` }}>
                  <CalendarDays className="h-5 w-5 text-[var(--accent)]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Agende seu horário</span>
                  <span className="block text-xs text-slate-500">{booking.text}</span>
                </span>
              </div>
              <a
                href={preview ? undefined : booking.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => clickFixed("agenda")}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
              >
                Ver horários disponíveis
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </section>
        )}

        {/* ── Contato ── */}
        {contact && (
          <section id="contato" className="mt-7 scroll-mt-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Contato</h2>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              {contact.address && (
                <ContactRow Icon={MapPin} href={contact.mapsHref} label="Endereço" preview={preview} onClick={() => clickFixed("mapa")}>
                  {contact.address}
                </ContactRow>
              )}
              {contact.phone && (
                <ContactRow Icon={Phone} href={contact.phoneHref} label="Telefone" preview={preview} onClick={() => clickFixed("telefone")}>
                  {contact.phone}
                </ContactRow>
              )}
              {contact.email && (
                <ContactRow Icon={Mail} href={contact.emailHref} label="E-mail" preview={preview} onClick={() => clickFixed("email")}>
                  {contact.email}
                </ContactRow>
              )}
              {contact.hours && (
                <ContactRow Icon={Clock} href={null} label="Horário de atendimento" preview={preview}>
                  <span className="whitespace-pre-line">{contact.hours}</span>
                </ContactRow>
              )}
            </div>
          </section>
        )}
      </div>

      {data.badge && (
        <footer className="pb-8 text-center">
          <a
            href={preview ? undefined : `/comecar?ref=${encodeURIComponent(slug)}&utm_source=pagina-negocio&utm_medium=selo`}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-800"
          >
            Feito com <strong className="text-slate-700">GoHub</strong> · Crie a sua grátis
          </a>
        </footer>
      )}

      {/* Reserva o espaço do menu fixo, pra ele não cobrir o fim da página (selo incluso). */}
      {sections.length > 1 && !preview && <div aria-hidden className="h-20" />}
      {sections.length > 1 && <SectionNav sections={sections} preview={preview} />}

      {openService && (
        <ServiceSheet
          block={openService}
          hasQuiz={!!quiz}
          preview={preview}
          onClose={() => setOpenService(null)}
          onInterest={interestFromService}
        />
      )}
    </div>
  );
}

// ─── Menu entre as seções ────────────────────────────────────────────────────

function ContactRow({
  Icon, href, label, preview, onClick, children,
}: {
  Icon: typeof House;
  href: string | null;
  label: string;
  preview: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  // Ícone e seta centralizados na linha, mesmo com texto em duas linhas.
  const body = (
    <>
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15">
        <Icon className="h-4 w-4 text-[var(--accent)]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-slate-400">{label}</span>
        <span className="block break-words text-sm leading-snug text-slate-800">{children}</span>
      </span>
      {href && <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden />}
    </>
  );
  if (!href) return <div className="flex items-center gap-3 px-4 py-3">{body}</div>;
  return (
    <a
      href={preview ? undefined : href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
    >
      {body}
    </a>
  );
}

function SectionNav({
  sections, preview,
}: {
  sections: { id: string; label: string; Icon: typeof House }[];
  preview: boolean;
}) {
  const [active, setActive] = useState(sections[0].id);

  // Marca a seção que está no meio da tela.
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    els.forEach((el) => io.observe(el));
    // No fim da página a última seção pode nunca chegar ao meio da tela.
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        setActive(sections[sections.length - 1].id);
      }
    };
    if (!preview) window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [sections, preview]);

  return (
    <nav
      aria-label="Seções da página"
      className={`${preview ? "sticky" : "fixed"} inset-x-0 bottom-3 z-40 flex justify-center px-4`}
    >
      <div className="flex min-w-0 max-w-full gap-0.5 rounded-full bg-white/90 p-1 shadow-lg ring-1 ring-slate-200 backdrop-blur sm:max-w-md sm:gap-1">
        {sections.map(({ id, label, Icon }) => {
          const on = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={label}
              onClick={() => {
                setActive(id);
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-semibold transition sm:px-3 ${
                on ? "min-w-0 bg-[var(--accent)] text-[var(--on-accent)]" : "flex-shrink-0 text-slate-600 hover:text-slate-900"
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {/* No celular, só o item ativo mostra o nome (e corta se faltar
                  espaço) — o menu nunca passa da largura da tela. */}
              <span className={on ? "truncate" : "hidden whitespace-nowrap sm:inline"}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Detalhe do serviço ──────────────────────────────────────────────────────

function ServiceSheet({
  block, hasQuiz, preview, onClose, onInterest,
}: {
  block: BioViewBlock;
  hasQuiz: boolean;
  preview: boolean;
  onClose: () => void;
  onInterest: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={`${preview ? "absolute" : "fixed"} inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center`} onClick={onClose}>
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
                className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
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
  ref, slug, quiz, accent, preview, host,
}: {
  ref: React.Ref<QuizHandle>;
  slug: string;
  quiz: NonNullable<BioViewData["quiz"]>;
  accent: string;
  preview: boolean;
  /** Quem "atende" no cartão de entrada: nome e foto da página. */
  host: { name: string; avatarUrl: string | null };
}) {
  const { questions } = quiz;
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const boxRef = useRef<HTMLDivElement>(null);

  function start() {
    if (step.kind === "intro" && !preview) track(slug, "QUIZ_START");
    if (step.kind !== "done") setStep(questions.length > 0 ? { kind: "question", index: 0 } : { kind: "form" });
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // "Tenho interesse" no detalhe do serviço abre as perguntas daqui.
  useImperativeHandle(ref, () => ({ start }));

  function next(index: number) {
    if (index + 1 < questions.length) {
      setStep({ kind: "question", index: index + 1 });
    } else {
      if (!preview) track(slug, "QUIZ_COMPLETE");
      setStep({ kind: "form" });
    }
  }

  /** Resposta única: marca e já avança. Várias: liga/desliga e espera o "Continuar". */
  function pick(q: (typeof questions)[number], option: string, index: number) {
    if (!q.multiple) {
      setAnswers((a) => ({ ...a, [q.id]: [option] }));
      next(index);
      return;
    }
    setAnswers((a) => {
      const cur = a[q.id] ?? [];
      return { ...a, [q.id]: cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option] };
    });
  }

  function back() {
    if (step.kind === "question" && step.index > 0) setStep({ kind: "question", index: step.index - 1 });
    else if (step.kind === "form" && questions.length > 0) setStep({ kind: "question", index: questions.length - 1 });
    else setStep({ kind: "intro" });
  }

  const total = questions.length + 1;
  const position = step.kind === "question" ? step.index + 1 : step.kind === "form" ? total : 0;
  // Depois do clique o cartão muda de cara (faixa na cor da página, fundo
  // tingido e contorno forte): fica claro que é ali que o contato acontece.
  const engaged = step.kind !== "intro";
  // Perguntas e formulário em "modo modal": o resto da página escurece e o
  // cartão fica por cima. Tocar fora ou no X volta pra entrada (respostas ficam).
  const focused = step.kind === "question" || step.kind === "form";

  return (
    <>
    {focused && (
      <div
        aria-hidden
        onClick={() => setStep({ kind: "intro" })}
        className={`${preview ? "absolute" : "fixed"} inset-0 z-[45] bg-slate-900/60 backdrop-blur-[2px]`}
      />
    )}
    <div
      ref={boxRef}
      role={focused ? "dialog" : undefined}
      aria-modal={focused || undefined}
      className={`relative mt-6 overflow-hidden rounded-3xl transition-shadow ${focused ? "z-50" : ""} ${engaged ? "shadow-2xl ring-2 ring-[var(--accent)]" : "bg-white shadow-sm ring-1 ring-slate-200"}`}
      style={engaged ? { background: `linear-gradient(${accent}1f, ${accent}1f), #ffffff` } : undefined}
    >
      {step.kind === "intro" && (
        // Porta de entrada em tom de atendimento: quem recebe é o próprio
        // negócio, com uma chamada e um botão — as perguntas vêm depois.
        <div className="p-5" style={{ background: `linear-gradient(180deg, ${accent}1a, #ffffff 70%)` }}>
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div className="h-11 w-11 overflow-hidden rounded-full bg-white ring-2 ring-white shadow-sm">
                {host.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={host.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-base font-bold text-[var(--on-accent)]" style={{ background: accent }}>
                    {host.name.trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm">
                <Sparkles className="h-3 w-3" style={{ color: accent }} />
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{host.name}</p>
              <p className="text-[11px] text-slate-500">Atendimento personalizado</p>
            </div>
          </div>

          <div className="mt-3 rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
            <p className="text-[15px] font-semibold leading-snug text-slate-900">{quiz.title}</p>
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-slate-500">
            {["Leva menos de 1 minuto", "Sem compromisso", "Resposta pra você"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1">
                <Check className="h-3 w-3" style={{ color: accent }} /> {t}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={start}
            className="group mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-[var(--on-accent)] shadow-sm transition hover:opacity-90"
          >
            {quiz.cta}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </button>
        </div>
      )}

      {(step.kind === "question" || step.kind === "form") && (
        <>
          <div className="bg-[var(--accent)] px-5 pb-3 pt-3.5 text-[var(--on-accent)]">
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{step.kind === "form" ? "Último passo: seu contato" : "Por onde começar"}</span>
              </p>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span className="text-xs font-medium opacity-80">{position} de {total}</span>
                <button
                  type="button"
                  aria-label="Fechar"
                  onClick={() => setStep({ kind: "intro" })}
                  className="-mr-1.5 rounded-full p-1 transition hover:bg-black/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-[var(--on-accent)] transition-all" style={{ width: `${(position / total) * 100}%` }} />
            </div>
          </div>
          <div className="p-5">
            <button type="button" onClick={back} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </button>

            {step.kind === "question" && (() => {
              const q = questions[step.index];
              const chosenList = answers[q.id] ?? [];
              return (
                <div>
                  <p className="text-base font-semibold leading-snug">{q.text}</p>
                  {q.multiple && <p className="mt-0.5 text-xs text-slate-500">Pode marcar mais de uma.</p>}
                  <div className="mt-4 space-y-2">
                    {q.options.map((opt) => {
                      const chosen = chosenList.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          aria-pressed={q.multiple ? chosen : undefined}
                          onClick={() => pick(q, opt, step.index)}
                          className={`flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium ring-1 transition ${
                            chosen ? "text-[var(--on-accent)] ring-transparent" : "bg-white text-slate-800 ring-slate-200 hover:ring-[var(--accent)]"
                          }`}
                          style={chosen ? { background: accent } : undefined}
                        >
                          {opt}
                          {q.multiple ? (
                            <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md ring-1 ${chosen ? "bg-white/25 ring-transparent" : "ring-slate-300"}`}>
                              {chosen && <Check className="h-3.5 w-3.5" />}
                            </span>
                          ) : (
                            chosen && <Check className="h-4 w-4" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {q.multiple && (
                    <button
                      type="button"
                      disabled={chosenList.length === 0}
                      onClick={() => next(step.index)}
                      className="mt-4 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:opacity-40"
                    >
                      Continuar
                    </button>
                  )}
                </div>
              );
            })()}

            {step.kind === "form" && (
              <ContactForm
                slug={slug}
                consent={quiz.consent}
                accent={accent}
                preview={preview}
                answers={questions.filter((q) => answers[q.id]?.length).map((q) => ({ questionId: q.id, answer: answers[q.id] }))}
                onDone={() => setStep({ kind: "done" })}
              />
            )}
          </div>
        </>
      )}

      {step.kind === "done" && (
        <div className="bg-white/60 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-[var(--on-accent)]" style={{ background: accent }}>
            <Check className="h-6 w-6" />
          </div>
          <p className="mt-3 whitespace-pre-line text-sm font-medium leading-relaxed text-slate-700">{quiz.thankYou}</p>
        </div>
      )}
    </div>
    </>
  );
}

function ContactForm({
  slug, consent, accent, preview, answers, onDone,
}: {
  slug: string;
  consent: string;
  accent: string;
  preview: boolean;
  answers: { questionId: string; answer: string[] }[];
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
    // Na prévia do editor o envio é de mentira — não cria lead.
    if (preview) return onDone();

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
        className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:opacity-60"
        style={{ background: accent }}
      >
        {sending && <Loader2 className="h-4 w-4 animate-spin" />}
        Enviar
      </button>
    </form>
  );
}
