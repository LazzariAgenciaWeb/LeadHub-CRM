// Montagem de UTM dos links de rastreio (/r/CODE).
//
// Regras, em ordem de precedência:
//   utm_source   = override do link → origem do link → origem da campanha → slug da empresa
//   utm_medium   = override do link → sugestão pela origem → "campanha"/"organico" (legado)
//   utm_campaign = override do link → slug da campanha → label do link → "bio"
//   utm_content  = SEMPRE o code do link (não é configurável: o pixel casa o
//                  clique interno por utm_content — src/app/pixel/[companyId])
//   utm_term     = override do link, quando preenchido
//
// Link antigo (sem origem e sem override) continua saindo exatamente como antes:
// utm_source = slug da empresa e utm_medium = "campanha"/"organico".
//
// Função pura, sem Prisma: serve ao redirect no servidor e à prévia no formulário.
import { campaignSourceToLeadSource, defaultUtmMedium, normalizeLeadSource } from "./sources";

export interface UtmLinkInput {
  code: string;
  destination: string;
  label?: string | null;
  source?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  campaign?: { slug?: string | null; source?: string | null } | null;
  companySlug?: string | null;
}

export function isWhatsappDestination(destination: string) {
  return destination.includes("wa.me") || destination.includes("api.whatsapp.com");
}

/** Origem efetiva do link: a dele, senão a da campanha. null = indefinida. */
export function resolveLinkSource(link: UtmLinkInput): string | null {
  return (
    normalizeLeadSource(link.source) ??
    campaignSourceToLeadSource(link.campaign?.source) ??
    null
  );
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** UTMs que o /r/CODE vai colar no destino. */
export function resolveUtms(link: UtmLinkInput): Record<string, string> {
  const source = resolveLinkSource(link);
  const utm: Record<string, string> = {
    utm_source:
      normalizeLeadSource(link.utmSource) ??
      source ??
      link.companySlug ??
      "leadhub",
    utm_medium:
      normalizeLeadSource(link.utmMedium) ??
      defaultUtmMedium(source) ??
      (link.campaign ? "campanha" : "organico"),
    utm_campaign:
      link.utmCampaign?.trim() ||
      link.campaign?.slug ||
      (link.label ? slugify(link.label) : "") ||
      "bio",
    utm_content: link.code,
  };
  const term = link.utmTerm?.trim();
  if (term) utm.utm_term = term;
  return utm;
}

/**
 * Destino final do /r/CODE. Só mexe em URL http(s): destino de WhatsApp volta
 * intacto (wa.me ignora query extra e qualquer parâmetro quebraria o ?text=).
 */
export function buildTrackedUrl(link: UtmLinkInput, opts?: { fbclid?: string }): string {
  const dest = link.destination;
  if (isWhatsappDestination(dest)) return dest;

  try {
    const url = new URL(dest);
    for (const [key, value] of Object.entries(resolveUtms(link))) {
      // Parâmetro já escrito à mão no destino manda — não sobrescreve.
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    // Repassa o fbclid pra landing — o Pixel do Meta lá converte em cookie _fbc,
    // que depois volta no webhook e turbina o match do Conversions API.
    if (opts?.fbclid && !url.searchParams.has("fbclid"))
      url.searchParams.set("fbclid", opts.fbclid);
    return url.toString();
  } catch {
    return dest;
  }
}
