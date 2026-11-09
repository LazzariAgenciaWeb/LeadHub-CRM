import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { bioJsonLd, bioMetadata, buildBioView, loadPublicBioPageByHost } from "@/lib/bio-page-render";
import BioPageView from "@/app/p/[slug]/BioPageView";

/**
 * A Página do Negócio no DOMÍNIO DO CLIENTE (plano com site próprio).
 *
 * O `src/proxy.ts` manda pra cá tudo que chega num Host que não é do sistema; a
 * página se acha pelo próprio Host. É a mesma tela de /p/{slug} — o que muda é
 * que aqui ela abre na raiz, pede indexação no Google e leva os dados
 * estruturados do negócio.
 *
 * Host sem domínio ativo cadastrado dá 404: é o que acontece quando alguém
 * aponta um domínio e desiste, ou quando o apontamento chega antes da liberação.
 */

export const dynamic = "force-dynamic";

async function hostAtual(): Promise<string | null> {
  return (await headers()).get("host");
}

export async function generateMetadata(): Promise<Metadata> {
  const page = await loadPublicBioPageByHost(await hostAtual());
  if (!page) return { title: "Site não encontrado" };
  return bioMetadata(page);
}

export default async function SiteProprioPage() {
  const page = await loadPublicBioPageByHost(await hostAtual());
  if (!page) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        // Conteúdo gerado em bioJsonLd: JSON serializado, com "<" escapado.
        dangerouslySetInnerHTML={{ __html: bioJsonLd(page) }}
      />
      <BioPageView data={buildBioView(page)} />
    </>
  );
}
