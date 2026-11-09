import { NextResponse, type NextRequest } from "next/server";
import { customHostCandidate } from "@/lib/bio-host";

/**
 * Domínio do cliente → Página do Negócio, e a regra de indexação do sistema.
 *
 * 1) O cliente do plano com site próprio aponta o domínio dele para cá. Quando a
 *    requisição chega com um Host que não é do sistema, ela é servida pela rota
 *    `/site`, que descobre a página pelo Host e responde na raiz — sem /p/slug
 *    na barra de endereços.
 *
 *    Aqui não se consulta banco (o proxy roda em toda requisição): a rota
 *    `/site` é que resolve o Host. Host desconhecido não acha página e dá 404.
 *
 *    No domínio do cliente só existe o site: painel, login e o resto da API
 *    ficam fora do ar. Passa o necessário pra página funcionar — os arquivos do
 *    Next e os endpoints públicos de visita, respostas e contato.
 *
 * 2) `X-Robots-Tag`: o sistema é ferramenta interna e não deve ser indexado,
 *    inclusive em /p/slug (o mesmo site no endereço do GoHub seria conteúdo
 *    repetido, e aparecer no Google é benefício do plano com site próprio). O
 *    site no domínio do cliente é o contrário: é PRA indexar. Este header
 *    morava no next.config, valendo para todas as respostas — por isso nenhuma
 *    página de cliente podia entrar no Google.
 */

/** Endpoints públicos da página — é por eles que visita, clique e contato contam. */
const API_PUBLICA = ["/api/pagina/evento", "/api/pagina/progresso", "/api/pagina/contato"];

const NOINDEX = "noindex, nofollow, noarchive, nosnippet, noimageindex";

export function proxy(req: NextRequest) {
  const host = customHostCandidate(req.headers.get("host"));
  const { pathname } = req.nextUrl;

  // ── Endereços do sistema: segue o fluxo normal, sem indexar ──
  if (!host) return marcar(NextResponse.next(), false);

  // ── Domínio de cliente ──

  // Arquivos do próprio Next e ícones: passam como estão.
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    if (API_PUBLICA.includes(pathname)) return NextResponse.next();
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }

  // A raiz é a página. robots.txt e sitemap.xml são do domínio do cliente.
  if (pathname === "/" || pathname === "") return marcar(rewrite(req, "/site"), true);
  if (pathname === "/robots.txt") return marcar(rewrite(req, "/site/robots.txt"), true);
  if (pathname === "/sitemap.xml") return marcar(rewrite(req, "/site/sitemap.xml"), true);

  // Site de uma página só: qualquer outro endereço volta pra raiz. Vale também
  // para /login e /dashboard — painel não abre no domínio do cliente.
  const home = new URL("/", req.url);
  home.search = req.nextUrl.search;
  return NextResponse.redirect(home, 308);
}

function rewrite(req: NextRequest, destino: string) {
  const url = new URL(destino, req.url);
  url.search = req.nextUrl.search;
  return NextResponse.rewrite(url);
}

function marcar(res: NextResponse, indexar: boolean) {
  res.headers.set("X-Robots-Tag", indexar ? "all" : NOINDEX);
  return res;
}

export const config = {
  // Fora: arquivos estáticos e imagens otimizadas (não há o que decidir neles).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
