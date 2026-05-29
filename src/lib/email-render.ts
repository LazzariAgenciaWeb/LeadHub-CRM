/**
 * Renderização de templates de email.
 *
 * Sintaxe simples (substituição de variáveis, sem if/loops):
 *   "Olá {{nome}}, sua proposta da {{empresa}} vence em {{vencimento}}."
 *
 * Variáveis disponíveis vêm de `EmailRecipient.vars` (snapshot no momento de
 * materializar os recipients). Garantem que mesmo se o lead mudar depois, a
 * versão enviada é a que foi vista no preview.
 *
 * Variáveis padrão que sempre tentamos preencher do Lead:
 *   - nome    (lead.name ?? lead.phone)
 *   - email   (lead.email)
 *   - phone   (lead.phone)
 *   - empresa (companyName, se super_admin)
 *
 * Tracking (pixel + reescrita de link + unsubscribe footer) vem no Dia 3 — esta
 * função entrega só o HTML/texto com substituição feita. Quem chama injeta o
 * resto antes de mandar pro SMTP.
 */

export interface RenderVars {
  [key: string]: string | number | null | undefined;
}

const VAR_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplateString(template: string, vars: RenderVars): string {
  return template.replace(VAR_REGEX, (_match, key) => {
    const v = vars[key];
    if (v === null || v === undefined) return "";
    return String(v);
  });
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renderiza um template inteiro. Se `text` não foi fornecido no template,
 * gera um fallback ingênuo strippando tags HTML — quase nenhum cliente moderno
 * precisa, mas alguns spamfilters bonificam emails com versão texto.
 */
export function renderTemplate(
  template: { subject: string; html: string; text?: string | null },
  vars: RenderVars
): RenderedEmail {
  const subject = renderTemplateString(template.subject, vars);
  const html = renderTemplateString(template.html, vars);
  const text = template.text
    ? renderTemplateString(template.text, vars)
    : html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return { subject, html, text };
}

/** Constrói o vars padrão a partir do lead. Quem chama pode mesclar customs. */
export function defaultVarsFromLead(lead: {
  name?: string | null;
  email?: string | null;
  phone?: string;
  company?: { name?: string | null } | null;
}): RenderVars {
  return {
    nome: lead.name ?? "",
    primeiroNome: (lead.name ?? "").split(" ")[0] ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    empresa: lead.company?.name ?? "",
  };
}
