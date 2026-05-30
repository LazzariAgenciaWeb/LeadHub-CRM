// Scraper compartilhado entre /api/prospeccao/import, /enrich e /diagnose.
// Versão expandida — além do email/social, extrai sinais de qualidade do site
// que alimentam o diagnóstico IA.

export type ScrapedSite = {
  ok: boolean;
  url: string;
  // Contatos
  email: string | null;
  instagram: string | null;
  facebook: string | null;
  hasWhatsappLink: boolean;
  // Sinais de qualidade pra diagnóstico
  title: string | null;
  metaDescription: string | null;
  firstH1: string | null;
  hasViewport: boolean;
  hasFavicon: boolean;
  hasSchemaOrg: boolean;
  hasOpenGraph: boolean;
  imageCount: number;
  imagesWithoutAlt: number;
  // Heurísticas
  hasContactSection: boolean; // tem "contato"/"contact" no copy?
  hasPhoneVisible: boolean;
  bodyTextSample: string | null; // primeiros 800 chars do <body> (sem tags) — alimenta IA
  language: string | null;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const INSTAGRAM_RE = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/i;
const FACEBOOK_RE = /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9_.\-]+)/i;
const WHATSAPP_RE = /https?:\/\/(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/[^\s"'<>]+/i;
const EMAIL_BLOCKLIST = /@(sentry\.io|wixpress\.com|wix\.com|cloudflare|googleapis|gstatic|example\.com|sentry-next\.wixpress)/i;
const PHONE_VISIBLE_RE = /\(?\b\d{2}\)?\s*9?\d{4}[-\s]?\d{4}\b/; // celular/fixo BR
const CONTACT_KEYWORDS = /\b(contato|contact|fale\s+conosco|atendimento)\b/i;

const EMPTY: ScrapedSite = {
  ok: false,
  url: "",
  email: null,
  instagram: null,
  facebook: null,
  hasWhatsappLink: false,
  title: null,
  metaDescription: null,
  firstH1: null,
  hasViewport: false,
  hasFavicon: false,
  hasSchemaOrg: false,
  hasOpenGraph: false,
  imageCount: 0,
  imagesWithoutAlt: 0,
  hasContactSection: false,
  hasPhoneVisible: false,
  bodyTextSample: null,
  language: null,
};

function extractTagContent(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : null;
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function scrapeSiteEnhanced(url: string, timeoutMs = 8000): Promise<ScrapedSite> {
  const result: ScrapedSite = { ...EMPTY, url };
  if (!url || !/^https?:\/\//i.test(url)) return result;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LeadHubProspector/1.0; +https://leadhub.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return result;

    const fullHtml = await res.text();
    const html = fullHtml.slice(0, 500_000); // bound memory

    // ── Contatos ────────────────────────────────────────────────────────
    const emailMatches = html.match(EMAIL_RE) ?? [];
    const email = emailMatches.find((e) => !EMAIL_BLOCKLIST.test(e)) ?? null;
    const ig = html.match(INSTAGRAM_RE);
    const fb = html.match(FACEBOOK_RE);
    const wa = html.match(WHATSAPP_RE);

    result.ok = true;
    result.email = email?.toLowerCase() ?? null;
    result.instagram = ig ? `https://instagram.com/${ig[1]}` : null;
    result.facebook = fb ? `https://facebook.com/${fb[1]}` : null;
    result.hasWhatsappLink = !!wa;

    // ── SEO básico ──────────────────────────────────────────────────────
    result.title = extractTagContent(html, "title")?.slice(0, 200) ?? null;
    result.metaDescription =
      extractMeta(html, "description")?.slice(0, 300) ??
      extractMeta(html, "og:description")?.slice(0, 300) ??
      null;
    result.firstH1 = extractTagContent(html, "h1")?.slice(0, 200) ?? null;

    // ── Sinais técnicos ─────────────────────────────────────────────────
    result.hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html);
    result.hasFavicon = /<link[^>]+rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["']/i.test(html);
    result.hasSchemaOrg = /(application\/ld\+json|itemtype\s*=\s*["']https?:\/\/schema\.org)/i.test(html);
    result.hasOpenGraph = /<meta[^>]+property\s*=\s*["']og:/i.test(html);

    // ── Imagens ─────────────────────────────────────────────────────────
    const imgMatches = html.match(/<img\b[^>]*>/gi) ?? [];
    result.imageCount = imgMatches.length;
    result.imagesWithoutAlt = imgMatches.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length;

    // ── Idioma ──────────────────────────────────────────────────────────
    const langMatch = html.match(/<html[^>]+lang\s*=\s*["']([^"']+)["']/i);
    result.language = langMatch ? langMatch[1] : null;

    // ── Conteúdo textual pra IA ─────────────────────────────────────────
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyText = bodyMatch ? stripTags(bodyMatch[1]) : stripTags(html);
    result.bodyTextSample = bodyText.slice(0, 800);
    result.hasContactSection = CONTACT_KEYWORDS.test(bodyText);
    result.hasPhoneVisible = PHONE_VISIBLE_RE.test(bodyText);

    return result;
  } catch {
    clearTimeout(timer);
    return result;
  }
}
