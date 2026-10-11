import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Ferramenta interna: nada deve ser indexado por buscadores.
  // Header vale para TODAS as respostas (páginas, APIs, arquivos, imagens, PDFs).
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
