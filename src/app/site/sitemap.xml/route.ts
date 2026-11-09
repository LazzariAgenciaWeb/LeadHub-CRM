import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { loadPublicBioPageByHost } from "@/lib/bio-page-render";

/**
 * Sitemap do site do cliente (domínio próprio). Uma página só — é o que o site
 * tem —, com a data da última edição, que é o sinal que o Google usa pra
 * revisitar depois de uma mudança.
 *
 * Servido em https://dominio-do-cliente/sitemap.xml (ver src/proxy.ts).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const host = (await headers()).get("host");
  const page = await loadPublicBioPageByHost(host);
  if (!page) return new NextResponse("não encontrado", { status: 404 });

  const url = `https://${page.domain!.hostname}/`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${url}</loc>
    <lastmod>${page.updatedAt.toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
