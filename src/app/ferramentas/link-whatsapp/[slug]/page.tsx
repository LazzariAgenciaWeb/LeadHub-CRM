import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import LinkWhatsappTool from "./LinkWhatsappTool";

// Ferramenta pública (sem auth): gerador de link do WhatsApp.
// Cada empresa tem a sua em /ferramentas/link-whatsapp/[slug]. Quem usa a
// página e copia o link vira lead da empresa (ver /api/ferramentas/link-whatsapp).

export const dynamic = "force-dynamic";

async function loadCompany(slug: string) {
  if (!slug) return null;
  return prisma.company.findFirst({
    where: { slug, status: "ACTIVE" },
    select: {
      name: true, tradeName: true, logoUrl: true, website: true,
      // @ da conta conectada no Inbox Social → CTA "siga no Instagram"
      instagramAccounts: {
        where: { status: "ACTIVE", username: { not: null } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { username: true },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const company = await loadCompany(slug);
  const owner = company?.tradeName ?? company?.name;
  return {
    title: owner
      ? `Gerador de link do WhatsApp — ${owner}`
      : "Gerador de link do WhatsApp",
    description:
      "Crie seu link do WhatsApp com mensagem pronta e cole na bio, no site ou nos anúncios. Grátis.",
  };
}

export default async function LinkWhatsappPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const company = await loadCompany(slug);
  if (!company) notFound();

  return (
    <LinkWhatsappTool
      slug={slug}
      ownerName={company.tradeName ?? company.name}
      ownerLogoUrl={company.logoUrl}
      ownerWebsite={company.website}
      ownerInstagram={company.instagramAccounts[0]?.username ?? null}
    />
  );
}
