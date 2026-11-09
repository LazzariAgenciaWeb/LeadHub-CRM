import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bioMetadata, buildBioView, loadPublicBioPage } from "@/lib/bio-page-render";
import BioPageView from "./BioPageView";

// Página do Negócio — pública (sem auth). Link na bio + vitrine + perguntas que
// viram lead (ver /api/pagina/contato). Só abre publicada; rascunho é 404.
//
// Este é o endereço do sistema (gohub.com.br/p/slug), que toda página tem. Quem
// está no plano com site próprio também abre no domínio dele — ver src/proxy.ts
// e a rota /site.

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPublicBioPage(slug);
  if (!page) return { title: "Página não encontrada" };
  return bioMetadata(page);
}

export default async function BioPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await loadPublicBioPage(slug);
  if (!page) notFound();

  // Com domínio próprio no ar, este endereço continua funcionando (é o link que
  // já está na bio e nos anúncios) — quem diz ao Google qual é o endereço de
  // verdade é o canônico, em bioMetadata.
  return <BioPageView data={buildBioView(page)} />;
}
