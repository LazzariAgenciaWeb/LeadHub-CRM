import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Não anunciar o framework no header (x-powered-by: Next.js) — só ajuda scanner.
  poweredByHeader: false,
  // Descoberta CalDAV (Lembretes do iPhone): o iOS procura /.well-known/caldav.
  // 308 mantém o método (PROPFIND).
  async redirects() {
    return [{ source: "/.well-known/caldav", destination: "/api/caldav", permanent: true }];
  },
  // O `X-Robots-Tag` saiu daqui e passou a ser decidido em src/proxy.ts: o
  // sistema continua inteiro como noindex, mas o site que o cliente publica no
  // domínio dele precisa ser indexável — e uma regra única aqui, valendo para
  // TODAS as respostas, impedia isso.
};

export default nextConfig;
