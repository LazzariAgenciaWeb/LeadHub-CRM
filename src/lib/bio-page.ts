// Página do Negócio (link na bio + vitrine em /p/[slug]).
// Regras compartilhadas entre editor, página pública e API: endereço da página,
// origem do lead e o que o cliente do plano grátis enxerga.

export const BIO_LEAD_SOURCE = "pagina-negocio";

/** Caminho público da página. */
export const BIO_PUBLIC_PATH = "/p";

export const BIO_SLUG_MIN = 3;
export const BIO_SLUG_MAX = 40;

// Endereços que colidem com rotas do sistema ou confundem o visitante.
export const BIO_RESERVED_SLUGS = new Set([
  "admin", "api", "app", "p", "r", "c", "d", "login", "logout", "cadastro",
  "comecar", "precos", "planos", "ajuda", "suporte", "termos", "privacidade",
  "gohub", "leadhub", "azz", "lazzari", "www", "mail", "email", "blog", "site",
  "pagina", "paginas", "meu-espaco", "ferramentas", "static", "assets",
]);

/**
 * "Clínica São João!" → "clinica-sao-joao". Minúsculas, sem acento, só letras,
 * números e hífen simples, cortado no tamanho máximo.
 */
export function slugifyBio(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BIO_SLUG_MAX)
    .replace(/-+$/g, "");
}

export type BioSlugProblem = "curto" | "longo" | "formato" | "reservado";

/** null = endereço válido. Não checa se já está em uso (isso é do banco). */
export function bioSlugProblem(slug: string): BioSlugProblem | null {
  if (slug.length < BIO_SLUG_MIN) return "curto";
  if (slug.length > BIO_SLUG_MAX) return "longo";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "formato";
  if (BIO_RESERVED_SLUGS.has(slug)) return "reservado";
  return null;
}

/**
 * Quantos contatos do mês o cliente enxerga (nome + telefone). Os demais são
 * capturados do mesmo jeito — a página nunca para —, mas aparecem só como
 * "+X contatos" com o convite pro Starter. -1 = ilimitado.
 */
export function visibleLeadCount(total: number, limit: number): { visible: number; hidden: number } {
  if (limit < 0 || total <= limit) return { visible: total, hidden: 0 };
  return { visible: limit, hidden: total - limit };
}
