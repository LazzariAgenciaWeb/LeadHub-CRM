/**
 * Gavetas de triagem da caixa de email — o "o que eu faço com isso?" da tela.
 *
 * NÃO é campo no banco: deriva de (aiImportance, suspicious), que a triagem IA
 * já preenche com exatamente essa semântica — ALTA = exige ação, NORMAL =
 * relevante sem ação, BAIXA = newsletter/propaganda/spam que passou. Derivar
 * em vez de persistir classifica todo o histórico já triado sem backfill nem
 * nova chamada de IA, e mantém uma fonte da verdade só.
 *
 * DESCARTE inclui o `suspicious` (golpe/phishing pego pela heurística do
 * ingest), então email de golpe cai na gaveta certa mesmo sem ter passado pela IA.
 */
import type { Prisma } from "@/generated/prisma";

export type EmailBucket = "RESOLVER" | "INFO" | "DESCARTE";
/** "NONE" = ainda não passou pela triagem (usado como filtro, não é gaveta). */
export type EmailBucketFilter = EmailBucket | "NONE";

export const EMAIL_BUCKETS: EmailBucket[] = ["RESOLVER", "INFO", "DESCARTE"];

export function isEmailBucketFilter(v: string | null | undefined): v is EmailBucketFilter {
  return v === "RESOLVER" || v === "INFO" || v === "DESCARTE" || v === "NONE";
}

/**
 * Filtro Prisma da gaveta. Usar em `where.AND` — `where.OR` é da busca por
 * texto e um sobrescreveria o outro.
 */
export function bucketWhere(bucket: EmailBucketFilter): Prisma.InboxEmailWhereInput {
  switch (bucket) {
    case "RESOLVER":
      return { suspicious: false, aiImportance: "ALTA" };
    case "INFO":
      return { suspicious: false, aiImportance: "NORMAL" };
    case "DESCARTE":
      return { OR: [{ suspicious: true }, { aiImportance: "BAIXA" }] };
    case "NONE":
      return { suspicious: false, aiImportance: null };
  }
}

/** Gaveta de um email. null = ainda sem triagem. */
export function bucketOf(email: {
  aiImportance?: string | null;
  suspicious?: boolean | null;
}): EmailBucket | null {
  if (email.suspicious) return "DESCARTE";
  if (email.aiImportance === "ALTA") return "RESOLVER";
  if (email.aiImportance === "NORMAL") return "INFO";
  if (email.aiImportance === "BAIXA") return "DESCARTE";
  return null;
}
