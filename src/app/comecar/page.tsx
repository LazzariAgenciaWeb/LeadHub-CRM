import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BIO_SEGMENTS, bioSlugProblem } from "@/lib/bio-page";
import ComecarForm from "./ComecarForm";

// Cadastro público do plano grátis da Página do Negócio.
// ?ref=slug = veio pelo selo "Feito com GoHub" de outra página.

export const metadata: Metadata = {
  title: "Crie sua Página do Negócio grátis",
  description: "Link na bio com vitrine e perguntas que transformam visita em contato. Grátis, sem cartão.",
};

export default async function ComecarPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  if (session) redirect("/");

  const { ref } = await searchParams;
  const refSlug = typeof ref === "string" ? ref.trim().toLowerCase() : "";
  // Só mostra "indicado por" se a página existe e está no ar.
  const referrer = refSlug && !bioSlugProblem(refSlug)
    ? await prisma.bioPage.findFirst({ where: { slug: refSlug, published: true }, select: { slug: true, title: true } })
    : null;

  return (
    <ComecarForm
      segments={[...BIO_SEGMENTS]}
      refSlug={referrer?.slug ?? null}
      refTitle={referrer?.title ?? null}
    />
  );
}
