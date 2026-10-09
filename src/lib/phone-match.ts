// Variantes de um telefone pra casar com `Lead.phone` por igualdade exata.
//
// O telefone do lead pode ter sido salvo com ou sem o DDI 55 e com ou sem o
// 9º dígito (depende de quem cadastrou: webhook do WhatsApp, import, mão).
// Em vez de normalizar a base inteira, geramos as formas possíveis do número
// que estamos procurando e usamos `phone: { in: variants }` — bate índice e
// não precisa de migration.
export function phoneMatchVariants(raws: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of raws) {
    const d = String(raw ?? "").replace(/\D/g, "");
    if (d.length < 8 || d.includes("@")) continue;
    out.add(d);

    // Forma local (DDD + número), com e sem o DDI.
    let local = d;
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
      local = d.slice(2);
      out.add(local);
    } else if (d.length === 10 || d.length === 11) {
      out.add(`55${d}`);
    }

    // Com/sem o 9º dígito do celular brasileiro (DDD 9 XXXX-XXXX ↔ DDD XXXX-XXXX).
    if (local.length === 11 && local[2] === "9") {
      const sem9 = local.slice(0, 2) + local.slice(3);
      out.add(sem9);
      out.add(`55${sem9}`);
    } else if (local.length === 10) {
      const com9 = local.slice(0, 2) + "9" + local.slice(2);
      out.add(com9);
      out.add(`55${com9}`);
    }
  }
  return [...out];
}
