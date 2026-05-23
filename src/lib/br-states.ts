/**
 * Helpers pra mapear nomes de estado retornados pelo GA4 → UF (sigla 2 letras).
 *
 * GA4 retorna `region` com nomes em formato variável:
 *  - "São Paulo" (PT-BR completo)
 *  - "Sao Paulo" (sem acento)
 *  - "State of São Paulo" (formato inglês internacional)
 *  - "SP" (sigla, raro)
 *
 * Esta função normaliza e tenta achar a UF correspondente.
 */

export const BR_STATES: { uf: string; name: string }[] = [
  { uf: "AC", name: "Acre" },
  { uf: "AL", name: "Alagoas" },
  { uf: "AP", name: "Amapá" },
  { uf: "AM", name: "Amazonas" },
  { uf: "BA", name: "Bahia" },
  { uf: "CE", name: "Ceará" },
  { uf: "DF", name: "Distrito Federal" },
  { uf: "ES", name: "Espírito Santo" },
  { uf: "GO", name: "Goiás" },
  { uf: "MA", name: "Maranhão" },
  { uf: "MT", name: "Mato Grosso" },
  { uf: "MS", name: "Mato Grosso do Sul" },
  { uf: "MG", name: "Minas Gerais" },
  { uf: "PA", name: "Pará" },
  { uf: "PB", name: "Paraíba" },
  { uf: "PR", name: "Paraná" },
  { uf: "PE", name: "Pernambuco" },
  { uf: "PI", name: "Piauí" },
  { uf: "RJ", name: "Rio de Janeiro" },
  { uf: "RN", name: "Rio Grande do Norte" },
  { uf: "RS", name: "Rio Grande do Sul" },
  { uf: "RO", name: "Rondônia" },
  { uf: "RR", name: "Roraima" },
  { uf: "SC", name: "Santa Catarina" },
  { uf: "SP", name: "São Paulo" },
  { uf: "SE", name: "Sergipe" },
  { uf: "TO", name: "Tocantins" },
];

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Mapa: nome normalizado → UF. Inclui variantes do GA4 ("State of X"). */
const NAME_TO_UF: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const { uf, name } of BR_STATES) {
    m[norm(name)] = uf;
    m[norm(`state of ${name}`)] = uf;
    m[norm(`estado de ${name}`)] = uf;
    m[norm(`estado do ${name}`)] = uf;
    m[uf.toLowerCase()] = uf;
  }
  // Aliases comuns
  m[norm("Federal District")] = "DF";
  return m;
})();

/** Resolve nome de estado (em qualquer formato) pra UF. Retorna null se não bater. */
export function resolveUf(region: string | null | undefined): string | null {
  if (!region) return null;
  return NAME_TO_UF[norm(region)] ?? null;
}

/** Nome PT-BR a partir da UF. */
export function ufName(uf: string): string {
  return BR_STATES.find((s) => s.uf === uf)?.name ?? uf;
}
