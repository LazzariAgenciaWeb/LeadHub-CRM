/**
 * videos.ts — helpers do módulo Vídeos (biblioteca estilo Netflix).
 *
 * Escopo das trilhas (VideoCategory):
 *   GLOBAL  → biblioteca central do SUPER_ADMIN (companyId = null).
 *   COMPANY → trilha de uma agência (companyId = dona), pros clientes dela.
 *
 * "Liberar" = visibility ALL (todos os clientes elegíveis) ou SELECTED
 * (só empresas em VideoCategoryRelease). O cliente enxerga trilhas GLOBAL
 * liberadas + trilhas COMPANY da sua agência-pai liberadas.
 */

import type { Prisma } from "@/generated/prisma";

/**
 * Extrai o ID de 11 caracteres de um vídeo do YouTube a partir de uma URL
 * (watch, youtu.be, embed, shorts, live) ou de um ID puro colado direto.
 * Retorna null se não reconhecer.
 */
export function parseYouTubeId(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  // ID puro (11 chars válidos do alfabeto base64url do YouTube)
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,          // youtube.com/watch?v=ID
    /youtu\.be\/([A-Za-z0-9_-]{11})/,      // youtu.be/ID
    /\/embed\/([A-Za-z0-9_-]{11})/,        // youtube.com/embed/ID
    /\/shorts\/([A-Za-z0-9_-]{11})/,       // youtube.com/shorts/ID
    /\/live\/([A-Za-z0-9_-]{11})/,         // youtube.com/live/ID
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  return null;
}

/** URL da thumbnail padrão do YouTube (hqdefault sempre existe). */
export function youtubeThumb(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

/** URL de embed (com params seguros: sem sugestões de outros canais). */
export function youtubeEmbed(youtubeId: string): string {
  return `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`;
}

export type VideoActorScope =
  | { scope: "GLOBAL"; companyId: null }
  | { scope: "COMPANY"; companyId: string };

/**
 * Define em que escopo o usuário logado gerencia trilhas no cadastro:
 *   - SUPER_ADMIN real (não impersonando) → GLOBAL (biblioteca central).
 *   - ADMIN de empresa (ou super admin impersonando) → COMPANY (própria).
 * Retorna null se não houver companyId no caso COMPANY (não pode cadastrar).
 */
export function videoActorScope(session: any): VideoActorScope | null {
  const role = session?.user?.role as string | undefined;
  if (role === "SUPER_ADMIN") return { scope: "GLOBAL", companyId: null };
  const companyId = session?.user?.companyId as string | undefined;
  if (!companyId) return null;
  return { scope: "COMPANY", companyId };
}

/**
 * Quem pode editar/apagar uma trilha:
 *   GLOBAL  → só SUPER_ADMIN real (não impersonando; a impersonação vira ADMIN).
 *   COMPANY → só a empresa dona.
 */
export function canManageCategory(
  session: any,
  category: { scope: string; companyId: string | null },
): boolean {
  const role = session?.user?.role as string | undefined;
  if (category.scope === "GLOBAL") return role === "SUPER_ADMIN";
  return !!category.companyId && category.companyId === (session?.user?.companyId as string | undefined);
}

/**
 * Filtro Prisma das trilhas visíveis para um cliente (sub-empresa).
 * @param clientCompanyId  empresa do cliente logado
 * @param parentCompanyId  agência-pai do cliente (dona das trilhas COMPANY)
 */
export function visibleCategoriesWhere(
  clientCompanyId: string,
  parentCompanyId: string | null,
): Prisma.VideoCategoryWhereInput {
  const releasedToClient = { releases: { some: { companyId: clientCompanyId } } };
  return {
    active: true,
    OR: [
      // Biblioteca central (super admin): liberada pra todos ou pra este cliente.
      { scope: "GLOBAL", OR: [{ visibility: "ALL" }, releasedToClient] },
      // Trilha da agência-pai: liberada pra todos os clientes dela ou pra este.
      ...(parentCompanyId
        ? [{ scope: "COMPANY" as const, companyId: parentCompanyId, OR: [{ visibility: "ALL" as const }, releasedToClient] }]
        : []),
    ],
  };
}
