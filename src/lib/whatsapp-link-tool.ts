// Gerador de link do WhatsApp (ferramenta pública / isca de leads).
// Normalização de telefone compartilhada entre a página e a API: o visitante
// digita do jeito que quiser ("(51) 99999-0001", "+55 51 ...") e o link wa.me
// precisa do número só com dígitos, com DDI na frente.

export const WA_TOOL_SOURCE = "gerador-link-whatsapp";
export const WA_TOOL_MAX_MESSAGE = 1000;

/** Só dígitos; número brasileiro sem DDI (10 ou 11 dígitos) ganha o 55. */
export function normalizeWaPhone(raw: string): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  // "0" de operadora/longa distância antes do DDD (051 9...) atrapalha o wa.me
  if (digits.length === 11 || digits.length === 12) {
    if (digits.startsWith("0") && !digits.startsWith("00")) digits = digits.slice(1);
  }
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

/** Aceita de 10 a 15 dígitos já normalizados (padrão E.164 sem o "+"). */
export function isValidWaPhone(digits: string): boolean {
  return /^\d{10,15}$/.test(digits);
}

export function buildWaLink(digits: string, message: string): string {
  const base = `https://wa.me/${digits}`;
  const text = message.trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
