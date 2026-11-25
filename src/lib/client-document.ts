import { prisma } from "@/lib/prisma";

/**
 * CNPJ/CPF do cliente (Company.document) como chave de busca — é por ele que
 * o GoHub casa cliente com o Bling e com o financeiro externo.
 *
 * O cadastro grava só dígitos, mas linha antiga pode ter máscara; por isso a
 * comparação limpa os dois lados no banco em vez de confiar no formato.
 */

export function documentDigits(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Parece documento (≥ 8 dígitos e nada além de dígitos e pontuação)? */
export function looksLikeDocument(q: string): boolean {
  const t = q.trim();
  return /^[\d.\-/\s]+$/.test(t) && documentDigits(t).length >= 8;
}

export function formatDocument(doc: string | null | undefined): string | null {
  const d = documentDigits(doc);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc ?? null;
}

/**
 * Ids dos clientes da agência cujo documento contém os dígitos informados
 * (documento inteiro ou trecho — ex.: a raiz do CNPJ acha matriz e filiais).
 */
export async function clientIdsByDocument(agencyId: string, raw: string): Promise<string[]> {
  const digits = documentDigits(raw);
  if (digits.length < 5) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Company"
    WHERE "parentCompanyId" = ${agencyId}
      AND "document" IS NOT NULL
      AND regexp_replace("document", '\\D', '', 'g') LIKE ${`%${digits}%`}
    LIMIT 50`;
  return rows.map((r) => r.id);
}
