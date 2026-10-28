import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  BIO_DEFAULT_QUIZ_CTA,
  BIO_DEFAULT_QUIZ_TITLE,
  BIO_DEFAULT_THANK_YOU,
  bioAccent,
  bioDefaultConsent,
  bioShowsBadge,
  safeBioHref,
} from "@/lib/bio-page";
import BioPageView, { type BioViewData } from "./BioPageView";

// Página do Negócio — pública (sem auth). Link na bio + vitrine + perguntas que
// viram lead (ver /api/pagina/contato). Só abre publicada; rascunho é 404.

export const dynamic = "force-dynamic";

const loadPage = cache(async (slug: string) => {
  if (!slug) return null;
  return prisma.bioPage.findFirst({
    where: { slug: slug.toLowerCase(), published: true, company: { status: "ACTIVE" } },
    include: {
      company: { select: { name: true, tradeName: true, logoUrl: true, subscription: { select: { plan: true } } } },
      blocks: { where: { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      questions: { where: { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
    },
  });
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (!page) return { title: "Página não encontrada" };
  const image = page.avatarUrl ?? page.company.logoUrl;
  return {
    title: page.title,
    description: page.headline ?? undefined,
    openGraph: {
      title: page.title,
      description: page.headline ?? undefined,
      images: image ? [image] : undefined,
    },
  };
}

export default async function BioPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (!page) notFound();

  const ownerName = page.company.tradeName ?? page.company.name;

  // Tudo que vira atributo/href é saneado aqui, no servidor: o navegador só
  // recebe link http(s)/mailto/tel e cor #RRGGBB.
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
    badge: bioShowsBadge(page.company.subscription?.plan),
    blocks,
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

  return <BioPageView data={data} />;
}
