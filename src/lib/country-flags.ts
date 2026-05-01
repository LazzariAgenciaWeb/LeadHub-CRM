/**
 * Helpers de emoji de bandeira a partir de código ISO 3166-1 alpha-2.
 * "BR" → 🇧🇷, "US" → 🇺🇸, etc.
 */

export function flagFromCountryCode(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "🌐";
  const upper = code.toUpperCase();
  // Caracteres regional indicator: A=0x1F1E6 (127462), e por aí vai
  const codePoints = [
    0x1f1e6 + (upper.charCodeAt(0) - 65),
    0x1f1e6 + (upper.charCodeAt(1) - 65),
  ];
  if (codePoints.some((c) => isNaN(c) || c < 0x1f1e6 || c > 0x1f1ff)) return "🌐";
  return String.fromCodePoint(...codePoints);
}

/** Tradução básica de nomes de país pra português (fallback ao nome cru se não estiver listado). */
export function ptCountryName(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  const map: Record<string, string> = {
    BR: "Brasil",          US: "Estados Unidos", PT: "Portugal",
    AR: "Argentina",       CL: "Chile",          UY: "Uruguai",
    PY: "Paraguai",        BO: "Bolívia",        PE: "Peru",
    CO: "Colômbia",        VE: "Venezuela",      MX: "México",
    CA: "Canadá",          GB: "Reino Unido",    DE: "Alemanha",
    FR: "França",          IT: "Itália",         ES: "Espanha",
    NL: "Holanda",         BE: "Bélgica",        CH: "Suíça",
    AT: "Áustria",         IE: "Irlanda",        SE: "Suécia",
    NO: "Noruega",         DK: "Dinamarca",      FI: "Finlândia",
    PL: "Polônia",         CZ: "Tchéquia",       RU: "Rússia",
    UA: "Ucrânia",         CN: "China",          JP: "Japão",
    KR: "Coreia do Sul",   IN: "Índia",          ID: "Indonésia",
    AU: "Austrália",       NZ: "Nova Zelândia",  ZA: "África do Sul",
    EG: "Egito",           NG: "Nigéria",        MA: "Marrocos",
    AE: "Emirados Árabes", SA: "Arábia Saudita", TR: "Turquia",
    IL: "Israel",          IR: "Irã",            TH: "Tailândia",
    PH: "Filipinas",       VN: "Vietnã",         MY: "Malásia",
    SG: "Cingapura",       HK: "Hong Kong",      TW: "Taiwan",
  };
  return map[code.toUpperCase()] || fallback;
}
