import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { loadPublicBioPageByHost } from "@/lib/bio-page-render";

/**
 * robots.txt do site do cliente (domínio próprio): libera tudo e aponta o
 * sitemap. Servido em https://dominio-do-cliente/robots.txt (ver src/proxy.ts).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const host = (await headers()).get("host");
  const page = await loadPublicBioPageByHost(host);
  if (!page) return new NextResponse("não encontrado", { status: 404 });

  const base = `https://${page.domain!.hostname}`;
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
