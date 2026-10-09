/**
 * Sugestão de destinatário: leitura dos endereços e ordem das sugestões.
 *
 * Fica fora da rota porque é a parte que erra fácil — lista com "Nome
 * <email>", vírgula dentro do nome, endereço repetido em maiúsculas.
 */

export const JANELA_HISTORICO = 300;
export const LIMITE_SUGESTOES = 8;

export type OrigemContato = "enviado" | "cliente" | "lead" | "recebido";

/** Quem você escreve vale mais que quem te escreveu. */
const PESO: Record<OrigemContato, number> = { enviado: 100, cliente: 60, lead: 40, recebido: 20 };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 'Fulano <a@b.com>, c@d.com' → [{ email, name }] */
export function splitAddresses(raw: string | null | undefined): { email: string; name: string | null }[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((parte) => {
      const t = parte.trim();
      if (!t) return null;
      const comNome = t.match(/^(.*?)<([^>]+)>$/);
      const email = (comNome ? comNome[2] : t).trim().toLowerCase();
      const name = comNome ? comNome[1].trim().replace(/^["']|["']$/g, "") : "";
      return EMAIL_RE.test(email) ? { email, name: name || null } : null;
    })
    .filter((x): x is { email: string; name: string | null } => !!x);
}

export interface ContatoSugerido {
  email: string;
  name: string | null;
  source: OrigemContato;
}

/** Junta as origens, pontua e devolve as melhores sugestões. */
export function mergeContacts(
  fontes: {
    enviados: { toEmail: string | null; ccEmail: string | null }[];
    recebidos: { fromEmail: string; fromName: string | null }[];
    clientes: { name: string; email: string | null }[];
    leads: { name: string | null; email: string | null }[];
  },
  q = "",
  limite = LIMITE_SUGESTOES
): ContatoSugerido[] {
  const porEmail = new Map<string, { email: string; name: string | null; origem: OrigemContato; score: number }>();

  function add(email: string, name: string | null, origem: OrigemContato) {
    const chave = email.trim().toLowerCase();
    if (!EMAIL_RE.test(chave)) return;
    const atual = porEmail.get(chave);
    if (!atual) {
      porEmail.set(chave, { email: chave, name: name || null, origem, score: PESO[origem] });
      return;
    }
    // Repetição conta como uso: quem você mais escreve sobe na lista.
    atual.score += Math.min(PESO[origem], 25);
    if (!atual.name && name) atual.name = name;
    if (PESO[origem] > PESO[atual.origem]) atual.origem = origem;
  }

  for (const e of fontes.enviados) {
    for (const a of [...splitAddresses(e.toEmail), ...splitAddresses(e.ccEmail)]) add(a.email, a.name, "enviado");
  }
  for (const c of fontes.clientes) if (c.email) add(c.email, c.name, "cliente");
  for (const l of fontes.leads) if (l.email) add(l.email, l.name, "lead");
  for (const r of fontes.recebidos) add(r.fromEmail, r.fromName, "recebido");

  // O filtro do banco olha o campo inteiro ("a@x.com, b@y.com") — aqui
  // conferimos endereço por endereço.
  const termo = q.trim().toLowerCase();
  return [...porEmail.values()]
    .filter((c) => !termo || c.email.includes(termo) || (c.name ?? "").toLowerCase().includes(termo))
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
    .slice(0, limite)
    .map(({ email, name, origem }) => ({ email, name, source: origem }));
}
