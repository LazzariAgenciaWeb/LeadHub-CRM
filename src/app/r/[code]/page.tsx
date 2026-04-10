import { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
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
          company: { select: { slug: true, name: true } },
        },
      },
      company: { select: { slug: true, name: true } },
    },
  });
}

function buildDestUrl(link: Awaited<ReturnType<typeof getLink>>) {
  if (!link) return "/";
  let dest = link.destination;
  const isWhatsapp = dest.includes("wa.me") || dest.includes("api.whatsapp.com");
  if (isWhatsapp) return dest;

  try {
    const url = new URL(dest);
    const companySlug =
      link.campaign?.company?.slug ?? link.company?.slug ?? "leadhub";
    if (!url.searchParams.has("utm_source"))
      url.searchParams.set("utm_source", companySlug);
    if (!url.searchParams.has("utm_medium"))
      url.searchParams.set(
        "utm_medium",
        link.campaign ? "campanha" : "organico"
      );
    if (!url.searchParams.has("utm_campaign"))
      url.searchParams.set(
        "utm_campaign",
        link.campaign?.slug ??
          link.label?.toLowerCase().replace(/\s+/g, "-") ??
          "bio"
      );
    if (!url.searchParams.has("utm_content"))
      url.searchParams.set("utm_content", link.code);
    return url.toString();
  } catch {
    return dest;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const link = await getLink(code);
  if (!link) return {};

  const title =
    link.ogTitle ??
    link.label ??
    link.campaign?.company?.name ??
    link.company?.name ??
    "LeadHub";

  const description =
    link.ogDescription ??
    (link.campaign
      ? `Saiba mais sobre ${link.campaign.name}`
      : "Clique para saber mais");

  const image = link.ogImage ?? `${BASE_URL}/og-default.png`;
  const dest = buildDestUrl(link);

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
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const link = await getLink(code);
  if (!link) notFound();

  const dest = buildDestUrl(link);

  return <RedirectClient linkId={link.id} dest={dest} />;
}
