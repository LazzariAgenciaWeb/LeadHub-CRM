/**
 * Carregamento e montagem da Página do Negócio pública.
 *
 * Mora aqui porque a mesma página é servida por dois endereços: o do sistema
 * (`/p/{slug}`, que vale para todo mundo) e o domínio próprio do cliente (plano
 * com site próprio, resolvido pelo Host da requisição). O conteúdo é o mesmo; o
 * que muda é o endereço canônico que vai para o Google.
 */

import { cache } from "react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  BIO_DEFAULT_QUIZ_CTA,
  BIO_DEFAULT_QUIZ_TITLE,
  BIO_DEFAULT_THANK_YOU,
  bioAccent,
  bioDefaultConsent,
  bioFreeView,
  bioShowsBadge,
  bioViewExtras,
  pagePlanOf,
  safeBioHref,
} from "@/lib/bio-page";
import { bioPublicBase, bioPublicUrl } from "@/lib/bio-page-server";
import { cleanHost } from "@/lib/bio-host";
import type { BioViewData } from "@/app/p/[slug]/BioPageView";

const PUBLIC_INCLUDE = {
  company: {
    select: {
      name: true,
      tradeName: true,
      logoUrl: true,
      subscription: { select: { plan: true, pagePlan: true } },
    },
  },
  blocks: { where: { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
  questions: { where: { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
  domain: { select: { hostname: true, status: true } },
} satisfies Prisma.BioPageInclude;

export type PublicBioPage = NonNullable<Awaited<ReturnType<typeof loadPublicBioPage>>>;

/** Página publicada pelo endereço do sistema. Rascunho não abre. */
export const loadPublicBioPage = cache(async (slug: string) => {
  if (!slug) return null;
  return prisma.bioPage.findFirst({
    where: { slug: slug.toLowerCase(), published: true, company: { status: "ACTIVE" } },
    include: PUBLIC_INCLUDE,
  });
});

/** Página servida num domínio de cliente — só com o domínio já ativo. */
export const loadPublicBioPageByHost = cache(async (rawHost: string | null | undefined) => {
  const hostname = cleanHost(rawHost);
  if (!hostname) return null;
  return prisma.bioPage.findFirst({
    where: {
      published: true,
      company: { status: "ACTIVE" },
      domain: { hostname, status: "ACTIVE" },
    },
    include: PUBLIC_INCLUDE,
  });
});

/** Endereço oficial da página: o domínio do cliente, se estiver no ar; senão o do GoHub. */
export function bioCanonicalUrl(page: PublicBioPage): string {
  return page.domain && page.domain.status === "ACTIVE"
    ? `https://${page.domain.hostname}/`
    : bioPublicUrl(page.slug);
}

/** Página no ar em domínio próprio? É o que libera a indexação no Google. */
export function bioHasOwnSite(page: PublicBioPage): boolean {
  return !!page.domain && page.domain.status === "ACTIVE";
}

/**
 * Dados prontos para a tela. Tudo que vira atributo/href é saneado aqui, no
 * servidor: o navegador só recebe link http(s)/mailto/tel e cor #RRGGBB.
 */
export function buildBioView(page: PublicBioPage): BioViewData {
  const ownerName = page.company.tradeName ?? page.company.name;
  const plan = pagePlanOf(page.company.subscription);

  const blocks = page.blocks
    .map((b) => ({
      id: b.id,
      type: b.type,
      title: b.title,
      description: b.description,
      href: safeBioHref(b.url),
      imageUrl: safeBioHref(b.imageUrl),
      priceLabel: b.priceLabel,
      network: b.network,
    }))
    // Link e rede social sem endereço válido não têm o que fazer na tela.
    .filter((b) => b.type === "SERVICE" || b.href);

  const data: BioViewData = {
    slug: page.slug,
    template: page.template,
    title: page.title,
    headline: page.headline,
    about: page.about,
    avatarUrl: safeBioHref(page.avatarUrl ?? page.company.logoUrl),
    coverUrl: safeBioHref(page.coverUrl),
    accent: bioAccent(page.accentColor),
    badge: bioShowsBadge(plan),
    signupBase: bioPublicBase(),
    blocks,
    ...bioViewExtras(page),
    quiz: page.quizEnabled
      ? {
          title: page.quizTitle || BIO_DEFAULT_QUIZ_TITLE,
          cta: page.quizCta || BIO_DEFAULT_QUIZ_CTA,
          thankYou: page.thankYouMessage || BIO_DEFAULT_THANK_YOU,
          consent: page.consentText || bioDefaultConsent(ownerName),
          questions: page.questions
            .filter((q) => q.options.length > 0)
            .map((q) => ({ id: q.id, text: q.text, options: q.options, multiple: q.multiple })),
        }
      : null,
  };

  // Página salva no Grátis (e ainda no Grátis): mostra só o que o Grátis inclui.
  return page.freeLimits && bioShowsBadge(plan) ? bioFreeView(data) : data;
}

/**
 * Título, descrição e canônico. A página só pede indexação quando está em
 * domínio próprio — no endereço do GoHub o `X-Robots-Tag` do sistema manda, e
 * seria o mesmo conteúdo em dois endereços.
 */
export function bioMetadata(page: PublicBioPage): Metadata {
  const image = safeBioHref(page.avatarUrl ?? page.company.logoUrl);
  const url = bioCanonicalUrl(page);
  const description = page.headline ?? page.about?.slice(0, 160) ?? undefined;
  const ownSite = bioHasOwnSite(page);
  return {
    title: page.title,
    description,
    alternates: { canonical: url },
    robots: ownSite
      ? { index: true, follow: true, googleBot: { index: true, follow: true } }
      : undefined,
    openGraph: {
      type: "website",
      url,
      siteName: page.title,
      title: page.title,
      description,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: page.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

/**
 * Dados estruturados do negócio (JSON-LD). É o que o Google usa para entender
 * que a página é de uma empresa local — só vai no domínio próprio.
 */
export function bioJsonLd(page: PublicBioPage): string {
  const url = bioCanonicalUrl(page);
  const sameAs = page.blocks
    .filter((b) => b.type === "SOCIAL")
    .map((b) => safeBioHref(b.url))
    .filter((h): h is string => !!h);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: page.title,
    url,
    description: page.headline ?? page.about ?? undefined,
    image: safeBioHref(page.avatarUrl ?? page.company.logoUrl) ?? undefined,
    telephone: page.contactPhone ?? undefined,
    email: page.contactEmail ?? undefined,
    address: page.contactAddress ? { "@type": "PostalAddress", streetAddress: page.contactAddress } : undefined,
    openingHours: page.contactHours ?? undefined,
    sameAs: sameAs.length > 0 ? sameAs : undefined,
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  // Fecha a tag de script: conteúdo vindo do banco nunca sai do JSON.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
