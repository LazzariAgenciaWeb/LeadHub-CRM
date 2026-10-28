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

/** Hostname do referrer ("l.instagram.com" → "instagram.com"); vazio = acesso direto. */
export function referrerLabel(ref: string | null): string {
  if (!ref) return "Direto / app";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    // l.instagram.com, lm.facebook.com → domínio principal
    return parts.length > 2 && !host.endsWith(".com.br") ? parts.slice(-2).join(".") : host;
  } catch {
    return "Outro";
  }
}

/**
 * Selo "Feito com GoHub" no rodapé: aparece em quem não paga (Página grátis,
 * Free do GoHub, trial e sem assinatura). Tirar o selo é benefício de plano pago.
 */
export function bioShowsBadge(plan: string | null | undefined): boolean {
  return !plan || plan === "PAGINA" || plan === "FREE" || plan === "TRIAL";
}

/** Eventos que o navegador pode registrar. LEAD só nasce no servidor, junto do envio. */
export const BIO_CLIENT_EVENTS = ["VIEW", "CLICK", "QUIZ_START", "QUIZ_COMPLETE"] as const;
export type BioClientEvent = (typeof BIO_CLIENT_EVENTS)[number];

export function isBioClientEvent(v: unknown): v is BioClientEvent {
  return typeof v === "string" && (BIO_CLIENT_EVENTS as readonly string[]).includes(v);
}

export const BIO_DEFAULT_QUIZ_TITLE = "Responda rapidinho e a gente te indica o melhor caminho";
export const BIO_DEFAULT_QUIZ_CTA = "Descobrir o melhor caminho";
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

/** Cor do texto sobre a cor da página: escuro em cor clara (verde-água, amarelo), branco no resto. */
export function bioOnAccent(accent: string): string {
  const hex = bioAccent(accent).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contraste com branco < ~3:1 → texto escuro lê melhor.
  return luminance > 0.3 ? "#0f172a" : "#ffffff";
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

export const BIO_NETWORKS = ["instagram", "facebook", "youtube", "tiktok", "linkedin", "whatsapp", "google", "email", "telefone", "site"] as const;

export const BIO_LIMITS = {
  title: 80, headline: 140, about: 600,
  blockTitle: 80, blockDescription: 500, priceLabel: 40,
  links: 20, services: 12, socials: 8,
  questions: 5, questionText: 140, optionsMin: 2, optionsMax: 6, optionText: 60,
  quizTitle: 140, quizCta: 40, thankYou: 400, consent: 600,
  bookingText: 140, contactPhone: 30, contactEmail: 120, contactAddress: 200, contactHours: 200,
} as const;

export const BIO_DEFAULT_BOOKING_TEXT = "Escolha o melhor dia e horário pra você.";

/** E-mail com cara de e-mail — o resto é com o dono da página. */
export function bioEmailOk(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Link de agenda: só http(s) (Calendly, Google Agenda, sistema próprio…). */
export function bioBookingOk(v: string | null | undefined): boolean {
  return !(v ?? "").trim() || !!safeBioHref(v)?.startsWith("http");
}

/** Telefone digitado livre → link tel: (só dígitos, com DDI do Brasil se faltar). */
export function bioTelHref(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  return `tel:+${d.length <= 11 ? `55${d}` : d}`;
}

/** Endereço → busca no Google Maps (abre o app no celular). */
export function bioMapsHref(address: string | null | undefined): string | null {
  const a = (address ?? "").trim();
  return a ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}` : null;
}

type BioExtrasFields = {
  bookingUrl: string | null; bookingText: string | null;
  contactPhone: string | null; contactEmail: string | null;
  contactAddress: string | null; contactHours: string | null;
};

/** Agenda e contato já prontos pra tela (links saneados). Usado na página e na prévia. */
export function bioViewExtras(p: BioExtrasFields) {
  const bookingHref = bioBookingOk(p.bookingUrl) ? safeBioHref(p.bookingUrl) : null;
  const email = p.contactEmail?.trim() && bioEmailOk(p.contactEmail) ? p.contactEmail.trim() : null;
  const contact = {
    phone: p.contactPhone?.trim() || null,
    phoneHref: bioTelHref(p.contactPhone),
    email,
    emailHref: email ? `mailto:${email}` : null,
    address: p.contactAddress?.trim() || null,
    mapsHref: bioMapsHref(p.contactAddress),
    hours: p.contactHours?.trim() || null,
  };
  return {
    booking: bookingHref ? { href: bookingHref, text: p.bookingText?.trim() || BIO_DEFAULT_BOOKING_TEXT } : null,
    contact: contact.phone || contact.email || contact.address || contact.hours ? contact : null,
  };
}

/**
 * Cliques que não são bloco (agenda e contato do rodapé). O navegador manda a
 * chave; o rótulo gravado vem daqui, nunca do navegador.
 */
export const BIO_FIXED_TARGETS = {
  agenda: "Agenda",
  telefone: "Contato: telefone",
  email: "Contato: e-mail",
  mapa: "Contato: endereço",
} as const;
export type BioFixedTarget = keyof typeof BIO_FIXED_TARGETS;

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
  /** Visitante pode marcar mais de uma resposta. */
  multiple: boolean;
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
  bookingUrl: string | null;
  bookingText: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactAddress: string | null;
  contactHours: string | null;
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

  const bookingUrl = text(b.bookingUrl, 1000);
  if (!bioBookingOk(bookingUrl)) return { ok: false, error: "Link da agenda inválido." };
  const contactEmail = text(b.contactEmail, L.contactEmail);
  if (!bioEmailOk(contactEmail)) return { ok: false, error: "E-mail de contato inválido." };

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
      multiple: r.multiple === true,
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
      bookingUrl,
      bookingText: text(b.bookingText, L.bookingText),
      contactPhone: text(b.contactPhone, L.contactPhone),
      contactEmail,
      contactAddress: text(b.contactAddress, L.contactAddress),
      contactHours: text(b.contactHours, L.contactHours),
      blocks,
      questions,
    },
  };
}

/** O que falta num item pra ele poder ser salvo (null = está completo). */
function blockProblem(b: BioEditorBlock): string | null {
  const title = b.title.trim();
  const kind = b.type === "SERVICE" ? "Serviço" : b.type === "SOCIAL" ? "Rede social" : "Link";
  if (!title) return `${kind} sem nome`;
  const url = (b.url ?? "").trim();
  if (url && !safeBioHref(url)) return `"${title}": link inválido`;
  if (b.type !== "SERVICE" && !url) return `"${title}": falta o link`;
  const img = (b.imageUrl ?? "").trim();
  if (img && !safeBioHref(img)?.startsWith("http")) return `"${title}": imagem inválida`;
  return null;
}

function questionProblem(q: BioEditorQuestion): string | null {
  const t = q.text.trim();
  if (!t) return "Pergunta sem texto";
  const n = new Set(q.options.map((o) => o.trim()).filter(Boolean)).size;
  if (n < BIO_LIMITS.optionsMin) return `"${t}": faltam respostas`;
  return null;
}

const imageOk = (v: string | null) => !(v ?? "").trim() || !!safeBioHref(v)?.startsWith("http");

/**
 * Salvamento automático do editor: monta, a partir do rascunho, o que já dá
 * pra gravar sem travar no que está pela metade. Item incompleto que já
 * existe fica como está salvo (não é apagado); item novo incompleto espera.
 * Endereço e publicação nunca vão no automático — trocar o link público ou
 * tirar a página do ar é decisão do botão. `pending` diz o que ficou de fora.
 */
type EditorDoc<B, Q> = Omit<BioEditorInput, "blocks" | "questions"> & { blocks: B[]; questions: Q[] };

export function bioAutosaveInput<B extends BioEditorBlock, Q extends BioEditorQuestion, D extends EditorDoc<B, Q>>(
  draft: D,
  saved: D,
): { input: D; pending: string[] } {
  const pending: string[] = [];
  const savedBlocks = new Map(saved.blocks.filter((b) => b.id).map((b) => [b.id, b]));
  const savedQuestions = new Map(saved.questions.filter((q) => q.id).map((q) => [q.id, q]));

  const blocks: B[] = [];
  for (const b of draft.blocks) {
    const problem = blockProblem(b);
    if (!problem) { blocks.push(b); continue; }
    pending.push(problem);
    const prev = b.id ? savedBlocks.get(b.id) : undefined;
    if (prev) blocks.push(prev);
  }
  const questions: Q[] = [];
  for (const q of draft.questions) {
    const problem = questionProblem(q);
    if (!problem) { questions.push(q); continue; }
    pending.push(problem);
    const prev = q.id ? savedQuestions.get(q.id) : undefined;
    if (prev) questions.push(prev);
  }

  if (!draft.title.trim()) pending.push("Falta o nome da página");
  if (!imageOk(draft.avatarUrl)) pending.push("Link da foto inválido");
  if (!imageOk(draft.coverUrl)) pending.push("Link da capa inválido");
  if (!bioBookingOk(draft.bookingUrl)) pending.push("Link da agenda inválido");
  if (!bioEmailOk(draft.contactEmail)) pending.push("E-mail de contato inválido");
  if (draft.slug !== saved.slug) pending.push("Endereço novo: clique em Salvar para trocar");

  return {
    input: {
      ...draft,
      slug: saved.slug,
      published: saved.published,
      title: draft.title.trim() ? draft.title : saved.title,
      avatarUrl: imageOk(draft.avatarUrl) ? draft.avatarUrl : saved.avatarUrl,
      coverUrl: imageOk(draft.coverUrl) ? draft.coverUrl : saved.coverUrl,
      bookingUrl: bioBookingOk(draft.bookingUrl) ? draft.bookingUrl : saved.bookingUrl,
      contactEmail: bioEmailOk(draft.contactEmail) ? draft.contactEmail : saved.contactEmail,
      blocks,
      questions,
    },
    pending,
  };
}

// ─── Cadastro público (/comecar) ─────────────────────────────────────────────

export const BIO_SIGNUP_SOURCE = "pagina-negocio-cadastro";
export const BIO_PASSWORD_MIN = 8;

/** Ramos comuns de PME de serviço local — "Outro" abre campo livre. */
export const BIO_SEGMENTS = [
  "Saúde e bem-estar", "Odontologia", "Beleza e estética", "Pet", "Alimentação",
  "Educação", "Advocacia e contabilidade", "Construção e reformas", "Automotivo",
  "Imobiliária", "Moda e varejo", "Eventos e fotografia",
] as const;

export interface BioSignupInput {
  businessName: string;
  segment: string;
  city: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  ref: string | null;
}

/** `phone` sai normalizado (só dígitos com DDI). Telefone é validado por quem chama. */
export function parseBioSignup(body: unknown, normalizePhone: (raw: string) => string):
  { ok: true; data: BioSignupInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const businessName = text(b.businessName, 80);
  if (!businessName || businessName.length < 2) return { ok: false, error: "Informe o nome do seu negócio." };
  const segment = text(b.segment, 60);
  if (!segment) return { ok: false, error: "Escolha o ramo do negócio." };
  const city = text(b.city, 60);
  if (!city || city.length < 2) return { ok: false, error: "Informe a cidade." };
  const name = text(b.name, 80);
  if (!name || name.length < 2) return { ok: false, error: "Informe seu nome." };
  const email = (text(b.email, 200) ?? "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "E-mail inválido." };
  const phone = normalizePhone(String(b.phone ?? ""));
  if (!/^\d{12,15}$/.test(phone)) return { ok: false, error: "Informe o WhatsApp com DDD." };
  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < BIO_PASSWORD_MIN) return { ok: false, error: `A senha precisa de pelo menos ${BIO_PASSWORD_MIN} caracteres.` };
  if (password.length > 200) return { ok: false, error: "Senha longa demais." };
  if (b.acceptTerms !== true) return { ok: false, error: "É preciso aceitar os termos para criar a conta." };
  const refRaw = typeof b.ref === "string" ? b.ref.trim().toLowerCase() : "";
  const ref = refRaw && !bioSlugProblem(refRaw) ? refRaw : null;
  return { ok: true, data: { businessName, segment, city, name, email, phone, password, ref } };
}
