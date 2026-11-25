/**
 * Variações de um telefone PARA BUSCA.
 *
 * Deliberadamente mais solta que a `phoneVariants` de `whatsapp.ts`: aquela
 * decide "este número é uma instância nossa?" — afrouxar lá cria falso
 * positivo. Aqui o pior caso é aparecer uma conversa a mais no resultado.
 *
 * Cobre o que a pessoa realmente digita na caixa de busca:
 *   "(44) 99926-9664", "44 9926-9664", "99269664", "+55 44 99926-9664"
 * contra o que o WhatsApp gravou ("554499269664" ou "5544999269664"),
 * incluindo os dois lados do 9 extra de celular brasileiro.
 */
export function phoneSearchVariants(raw: string): string[] {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 4) return [];

  const out = new Set<string>([digits]);
  const semPais = digits.startsWith("55") ? digits.slice(2) : digits;
  out.add(semPais);
  if (semPais.length >= 10) out.add("55" + semPais);

  // DDD + 9 + 8 dígitos  →  também sem o 9
  if (semPais.length === 11 && semPais[2] === "9") {
    const sem9 = semPais.slice(0, 2) + semPais.slice(3);
    out.add(sem9);
    out.add("55" + sem9);
  }
  // DDD + 8 dígitos  →  também com o 9
  if (semPais.length === 10) {
    const com9 = semPais.slice(0, 2) + "9" + semPais.slice(2);
    out.add(com9);
    out.add("55" + com9);
  }
  // Número solto, sem DDD (8 ou 9 dígitos): o `contains` já resolve, mas
  // cobrimos o 9 na frente pra quem digita o celular sem o DDD.
  if (semPais.length === 9 && semPais[0] === "9") out.add(semPais.slice(1));
  if (semPais.length === 8) out.add("9" + semPais);

  return [...out].filter((d) => d.length >= 4);
}
