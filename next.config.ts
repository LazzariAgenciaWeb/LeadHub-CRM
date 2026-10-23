import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Não anunciar o framework no header (x-powered-by: Next.js) — só ajuda scanner.
  poweredByHeader: false,
  // Ferramenta interna: nada deve ser indexado por buscadores.
  // Header vale para TODAS as respostas (páginas, APIs, arquivos, imagens, PDFs).
  // Descoberta CalDAV (Lembretes do iPhone): o iOS procura /.well-known/caldav.
  // 308 mantém o método (PROPFIND).
  async redirects() {
    return [{ source: "/.well-known/caldav", destination: "/api/caldav", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" }],
      },
    ];
  },
};

export default nextConfig;
