// Página do Negócio (link na bio + vitrine em /p/[slug]).
// Regras compartilhadas entre editor, página pública e API: endereço da página,
// origem do lead e o que o cliente do plano grátis enxerga.

export const BIO_LEAD_SOURCE = "pagina-negocio";

/** Caminho público da página. */
export const BIO_PUBLIC_PATH = "/p";

export const BIO_SLUG_MIN = 3;
export const BIO_SLUG_MAX = 40;

// Endereços que colidem com rotas do sistema ou confundem o visitante.
export const BIO_RESERVED_SLUGS = new Set([
  "admin", "api", "app", "p", "r", "c", "d", "login", "logout", "cadastro",
  "comecar", "precos", "planos", "ajuda", "suporte", "termos", "privacidade",
  "gohub", "leadhub", "azz", "lazzari", "www", "mail", "email", "blog", "site",
  "pagina", "paginas", "meu-espaco", "ferramentas", "static", "assets",
]);

/**
 * "Clínica São João!" → "clinica-sao-joao". Minúsculas, sem acento, só letras,
 * números e hífen simples, cortado no tamanho máximo.
 */
export function slugifyBio(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BIO_SLUG_MAX)
    .replace(/-+$/g, "");
}

export type BioSlugProblem = "curto" | "longo" | "formato" | "reservado";

/** null = endereço válido. Não checa se já está em uso (isso é do banco). */
export function bioSlugProblem(slug: string): BioSlugProblem | null {
  if (slug.length < BIO_SLUG_MIN) return "curto";
  if (slug.length > BIO_SLUG_MAX) return "longo";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "formato";
  if (BIO_RESERVED_SLUGS.has(slug)) return "reservado";
  return null;
}

/**
 * Quantos contatos do mês o cliente enxerga (nome + telefone). Os demais são
 * capturados do mesmo jeito — a página nunca para —, mas aparecem só como
 * "+X contatos" com o convite pro Starter. -1 = ilimitado.
 */
export function visibleLeadCount(total: number, limit: number): { visible: number; hidden: number } {
  if (limit < 0 || total <= limit) return { visible: total, hidden: 0 };
  return { visible: limit, hidden: total - limit };
}

/** Eventos que o navegador pode registrar. LEAD só nasce no servidor, junto do envio. */
export const BIO_CLIENT_EVENTS = ["VIEW", "CLICK", "QUIZ_START", "QUIZ_COMPLETE"] as const;
export type BioClientEvent = (typeof BIO_CLIENT_EVENTS)[number];

export function isBioClientEvent(v: unknown): v is BioClientEvent {
  return typeof v === "string" && (BIO_CLIENT_EVENTS as readonly string[]).includes(v);
}

export const BIO_DEFAULT_QUIZ_TITLE = "Responda rapidinho e a gente te indica o melhor caminho";
export const BIO_DEFAULT_QUIZ_CTA = "Começar";
export const BIO_DEFAULT_THANK_YOU = "Recebemos seu contato! Em breve a gente fala com você.";

export function bioDefaultConsent(ownerName: string): string {
  return `Ao enviar, você concorda que ${ownerName} guarde seus dados e entre em contato para falar sobre o que você respondeu. Seus dados não são compartilhados com mais ninguém.`;
}

/**
 * Link que o dono da página cadastrou → href seguro. Só http(s), mailto e tel;
 * "javascript:", "data:" e afins viram null (o botão nem aparece). Sem esquema
 * ("meusite.com.br") ganha https://.
 */
export function safeBioHref(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^(mailto|tel):/i.test(v)) return v;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** #RRGGBB válido ou a cor padrão. Evita CSS arbitrário vindo do banco. */
export function bioAccent(color: string | null | undefined, fallback = "#4f46e5"): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function clip(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

/** Campos de origem que o navegador manda junto de evento e envio (todos opcionais). */
export function bioTrackingFields(body: Record<string, unknown>) {
  return {
    visitorId: clip(body.visitorId, 64),
    referrer: clip(body.referrer, 1000),
    utmSource: clip(body.utmSource, 120),
    utmMedium: clip(body.utmMedium, 120),
    utmCampaign: clip(body.utmCampaign, 200),
  };
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export const BIO_NETWORKS = ["instagram", "facebook", "youtube", "tiktok", "linkedin", "whatsapp", "email", "telefone", "site"] as const;

export const BIO_LIMITS = {
  title: 80, headline: 140, about: 600,
  blockTitle: 80, blockDescription: 500, priceLabel: 40,
  links: 20, services: 12, socials: 8,
  questions: 5, questionText: 140, optionsMin: 2, optionsMax: 6, optionText: 60,
  quizTitle: 140, quizCta: 40, thankYou: 400, consent: 600,
} as const;

/** Perguntas que toda página nova já traz — o dono edita ou apaga. */
export const BIO_DEFAULT_QUESTIONS = [
  { text: "Como podemos te ajudar?", options: ["Quero um orçamento", "Quero agendar", "Tenho uma dúvida"] },
  { text: "Para quando você precisa?", options: ["Hoje ou amanhã", "Nesta semana", "Só estou pesquisando"] },
];

export interface BioEditorBlock {
  id?: string;
  type: "LINK" | "SERVICE" | "SOCIAL";
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  priceLabel: string | null;
  network: string | null;
  active: boolean;
}

export interface BioEditorQuestion {
  id?: string;
  text: string;
  options: string[];
  active: boolean;
}

export interface BioEditorInput {
  slug: string;
  template: "CARTAO" | "VITRINE";
  title: string;
  headline: string | null;
  about: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  accentColor: string | null;
  published: boolean;
  quizEnabled: boolean;
  quizTitle: string | null;
  quizCta: string | null;
  thankYouMessage: string | null;
  consentText: string | null;
  blocks: BioEditorBlock[];
  questions: BioEditorQuestion[];
}

type Parsed = { ok: true; data: BioEditorInput } | { ok: false; error: string };

function text(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

/**
 * Valida o que o editor manda salvar. Regra de link: guardamos o que o dono
 * digitou, mas só aceitamos o que `safeBioHref` consegue transformar em link
 * seguro — erro claro no editor em vez de botão sumindo na página pública.
 */
export function parseBioEditorInput(body: unknown): Parsed {
  const b = (body ?? {}) as Record<string, unknown>;
  const L = BIO_LIMITS;

  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : "";
  const slugErr = bioSlugProblem(slug);
  if (slugErr) {
    const msg = {
      curto: `O endereço precisa de pelo menos ${BIO_SLUG_MIN} letras.`,
      longo: `O endereço pode ter no máximo ${BIO_SLUG_MAX} letras.`,
      formato: "Use só letras minúsculas, números e hífen no endereço.",
      reservado: "Esse endereço é reservado. Escolha outro.",
    }[slugErr];
    return { ok: false, error: msg };
  }

  const title = text(b.title, L.title);
  if (!title) return { ok: false, error: "Dê um nome para a página." };

  const template = b.template === "VITRINE" ? "VITRINE" : "CARTAO";
  const accentColor = typeof b.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(b.accentColor) ? b.accentColor : null;

  const image = (v: unknown, label: string): { ok: true; url: string | null } | { ok: false; error: string } => {
    const raw = text(v, 1000);
    if (!raw) return { ok: true, url: null };
    const href = safeBioHref(raw);
    return href && href.startsWith("http") ? { ok: true, url: href } : { ok: false, error: `Link da ${label} inválido.` };
  };
  const avatar = image(b.avatarUrl, "foto");
  if (!avatar.ok) return avatar;
  const cover = image(b.coverUrl, "capa");
  if (!cover.ok) return cover;

  const blocks: BioEditorBlock[] = [];
  const count = { LINK: 0, SERVICE: 0, SOCIAL: 0 };
  for (const [i, raw] of (Array.isArray(b.blocks) ? b.blocks : []).entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const type = r.type === "SERVICE" || r.type === "SOCIAL" ? r.type : "LINK";
    const where = `Item ${i + 1}`;
    const title = text(r.title, L.blockTitle);
    if (!title) return { ok: false, error: `${where}: falta o título.` };
    const urlRaw = text(r.url, 1000);
    const url = urlRaw ? safeBioHref(urlRaw) : null;
    if (urlRaw && !url) return { ok: false, error: `"${title}": link inválido.` };
    if (type !== "SERVICE" && !url) return { ok: false, error: `"${title}": falta o link.` };
    const img = image(r.imageUrl, `imagem de "${title}"`);
    if (!img.ok) return img;
    const network = typeof r.network === "string" && (BIO_NETWORKS as readonly string[]).includes(r.network) ? r.network : null;
    count[type]++;
    blocks.push({
      id: typeof r.id === "string" && r.id ? r.id : undefined,
      type,
      title,
      description: text(r.description, L.blockDescription),
      url: urlRaw,
      imageUrl: img.url,
      priceLabel: type === "SERVICE" ? text(r.priceLabel, L.priceLabel) : null,
      network: type === "SERVICE" ? null : network,
      active: r.active !== false,
    });
  }
  if (count.LINK > L.links) return { ok: false, error: `No máximo ${L.links} links.` };
  if (count.SERVICE > L.services) return { ok: false, error: `No máximo ${L.services} serviços.` };
  if (count.SOCIAL > L.socials) return { ok: false, error: `No máximo ${L.socials} redes sociais.` };

  const questions: BioEditorQuestion[] = [];
  for (const [i, raw] of (Array.isArray(b.questions) ? b.questions : []).entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const qText = text(r.text, L.questionText);
    if (!qText) return { ok: false, error: `Pergunta ${i + 1}: escreva a pergunta.` };
    const options = Array.from(new Set(
      (Array.isArray(r.options) ? r.options : [])
        .map((o) => text(o, L.optionText))
        .filter((o): o is string => !!o),
    ));
    if (options.length < L.optionsMin) return { ok: false, error: `"${qText}": precisa de pelo menos ${L.optionsMin} respostas.` };
    if (options.length > L.optionsMax) return { ok: false, error: `"${qText}": no máximo ${L.optionsMax} respostas.` };
    questions.push({
      id: typeof r.id === "string" && r.id ? r.id : undefined,
      text: qText,
      options,
      active: r.active !== false,
    });
  }
  if (questions.length > L.questions) return { ok: false, error: `No máximo ${L.questions} perguntas.` };

  return {
    ok: true,
    data: {
      slug,
      template,
      title,
      headline: text(b.headline, L.headline),
      about: text(b.about, L.about),
      avatarUrl: avatar.url,
      coverUrl: cover.url,
      accentColor,
      published: b.published === true,
      quizEnabled: b.quizEnabled !== false,
      quizTitle: text(b.quizTitle, L.quizTitle),
      quizCta: text(b.quizCta, L.quizCta),
      thankYouMessage: text(b.thankYouMessage, L.thankYou),
      consentText: text(b.consentText, L.consent),
      blocks,
      questions,
    },
  };
}
