import { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildTrackedUrl } from "@/lib/tracking-utm";
import RedirectClient from "./RedirectClient";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

async function getLink(code: string) {
  return prisma.trackingLink.findUnique({
    where: { code },
    include: {
      campaign: {
        select: {
          id: true,
          slug: true,
          name: true,
          source: true,
          company: { select: { slug: true, name: true } },
        },
      },
      company: { select: { slug: true, name: true } },
    },
  });
}

function buildDestUrl(link: Awaited<ReturnType<typeof getLink>>, fbclid?: string) {
  if (!link) return "/";
  return buildTrackedUrl(
    {
      code:        link.code,
      destination: link.destination,
      label:       link.label,
      source:      link.source,
      utmSource:   link.utmSource,
      utmMedium:   link.utmMedium,
      utmCampaign: link.utmCampaign,
      utmTerm:     link.utmTerm,
      campaign:    link.campaign ? { slug: link.campaign.slug, source: link.campaign.source } : null,
      companySlug: link.campaign?.company?.slug ?? link.company?.slug ?? null,
    },
    { fbclid },
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ fbclid?: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const { fbclid } = await searchParams;
  const link = await getLink(code);
  if (!link) return {};

  // Link pausado: sem meta refresh + título neutro pra preview no WhatsApp
  // não mostrar nada da proposta original.
  if (!link.isActive) {
    return {
      title:       "Proposta encerrada",
      description: "O conteúdo deste link não está mais disponível.",
      robots:      { index: false, follow: false },
    };
  }

  const title =
    link.ogTitle ??
    link.label ??
    link.campaign?.company?.name ??
    link.company?.name ??
    "GoHub";

  const description =
    link.ogDescription ??
    (link.campaign
      ? `Saiba mais sobre ${link.campaign.name}`
      : "Clique para saber mais");

  const image = link.ogImage ?? `${BASE_URL}/og-default.png`;
  const dest = buildDestUrl(link, fbclid);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: image, width: 1200, height: 630 }],
      url: `${BASE_URL}/r/${code}`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
    // Meta refresh fallback para bots que seguem redirects mas não executam JS
    other: {
      refresh: `0;url=${dest}`,
    },
  };
}

export default async function RedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ fbclid?: string }>;
}) {
  const { code } = await params;
  const { fbclid } = await searchParams;
  const link = await getLink(code);
  if (!link) notFound();

  const dest = buildDestUrl(link, fbclid);

  return <RedirectClient linkId={link.id} code={link.code} dest={dest} isActive={link.isActive} />;
}
