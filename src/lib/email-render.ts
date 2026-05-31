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

/** Item de uma seção do diagnóstico IA (gerado em /api/prospeccao/diagnose). */
interface DiagPoint { title: string; detail?: string; }
interface DiagnosisData {
  summary?: string;
  positives?: DiagPoint[];
  opportunities?: DiagPoint[];
  criticals?: DiagPoint[];
}

/** Escape básico de HTML pra texto vindo de IA/usuário (proteção contra HTML quebrado). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

/**
 * Renderiza uma seção do diagnóstico como HTML com estilos inline (boa
 * portabilidade entre clientes de email).
 *
 * Se `linkUrl` é passado, cada item vira clicável apontando pra `linkUrl#anchor`.
 */
function diagSectionHtml(
  items: DiagPoint[] | undefined,
  opts: { color: string; titleText: string; icon: string; linkUrl?: string; anchor?: string }
): string {
  if (!items || items.length === 0) return "";
  const target = opts.linkUrl ? `${opts.linkUrl}${opts.anchor ? `#${opts.anchor}` : ""}` : "";
  const lis = items.map((it) => {
    const detail = it.detail ? `<div style="color:#666;margin-top:4px;font-size:13px;">${esc(it.detail)}</div>` : "";
    const titleEl = target
      ? `<a href="${target}" style="color:${opts.color};text-decoration:none;font-weight:bold;">${esc(it.title)}</a>`
      : `<strong style="color:#111;">${esc(it.title)}</strong>`;
    return `<li style="margin-bottom:10px;color:#333;line-height:1.5;">${titleEl}${detail}</li>`;
  }).join("");
  return `
<div style="background:#f9fafb;border-left:4px solid ${opts.color};padding:14px 18px;border-radius:6px;margin:14px 0;">
  <div style="font-size:12px;font-weight:bold;color:${opts.color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">
    ${opts.icon} ${esc(opts.titleText)}
  </div>
  <ul style="padding-left:20px;margin:0;">${lis}</ul>
</div>`.trim();
}

/**
 * Constrói o link WhatsApp wa.me com mensagem pré-preenchida E tag de
 * referência (ref:TOKEN) que o webhook do WhatsApp reconhece pra linkar
 * automaticamente a conversa de volta ao lead que recebeu o email.
 *
 * Quando o recipient clica → wa.me abre → digita Enviar → mensagem chega no
 * Evolution → webhook detecta "(ref: TOKEN)" → encontra o lead por
 * diagnosisToken e vincula. Bypass do match por phone que pode falhar
 * (recipient usa um número diferente do que está no Lead.phone).
 */
function buildWhatsappCta(
  companyPhone: string | null | undefined,
  empresaName: string,
  diagnosisToken: string | null | undefined
): string {
  if (!companyPhone) return "";
  const number = companyPhone.replace(/\D/g, "");
  if (!number) return "";
  const refTag = diagnosisToken ? `\n\n(ref: ${diagnosisToken})` : "";
  const msg = `Olá! Acabei de ver o diagnóstico que vocês prepararam para ${empresaName} e gostaria de solicitar a avaliação completa.${refTag}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(msg)}`;
}

function ctaButtonsHtml(diagnosticoUrl: string, whatsappUrl: string): string {
  if (!diagnosticoUrl && !whatsappUrl) return "";
  const verDiagBtn = diagnosticoUrl
    ? `<a href="${diagnosticoUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:6px 4px;font-size:14px;">📊 Ver diagnóstico</a>`
    : "";
  const waBtn = whatsappUrl
    ? `<a href="${whatsappUrl}" style="display:inline-block;background:#10b981;color:#fff;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:6px 4px;font-size:14px;">💬 Solicitar via WhatsApp</a>`
    : "";
  return `
<div style="text-align:center;margin:28px 0;">
  ${verDiagBtn}
  ${waBtn}
</div>`.trim();
}

/** Constrói o vars padrão a partir do lead. Quem chama pode mesclar customs. */
export function defaultVarsFromLead(lead: {
  name?: string | null;
  email?: string | null;
  phone?: string;
  company?: { name?: string | null; phone?: string | null } | null;
  diagnosis?: unknown;
  diagnosisToken?: string | null;
}, opts?: { baseUrl?: string }): RenderVars {
  const base = (
    opts?.baseUrl
    ?? process.env.NEXT_PUBLIC_BASE_URL
    ?? process.env.NEXTAUTH_URL
    ?? ""
  ).replace(/\/$/, "");
  const token = lead.diagnosisToken ?? null;
  const diagnosticoUrl = token && base ? `${base}/d/${encodeURIComponent(token)}` : "";
  const empresaName = lead.company?.name ?? "sua empresa";
  const whatsappAvaliacaoUrl = buildWhatsappCta(lead.company?.phone, empresaName, token);
  const diag = (lead.diagnosis ?? {}) as DiagnosisData;
  const ctaDuplo = ctaButtonsHtml(diagnosticoUrl, whatsappAvaliacaoUrl);

  return {
    nome: lead.name ?? "",
    primeiroNome: (lead.name ?? "").split(" ")[0] ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    empresa: lead.company?.name ?? "",
    // ── Diagnóstico (Prospecta IA) ─────────────────────────────────────────
    diagnosticoUrl,
    whatsappAvaliacaoUrl,
    diagnosticoSummary: diag.summary ?? "",
    diagnosticoPontosFortes: diagSectionHtml(diag.positives, {
      color: "#10b981", titleText: "Pontos fortes", icon: "✅",
      linkUrl: diagnosticoUrl, anchor: "positives",
    }),
    diagnosticoOportunidades: diagSectionHtml(diag.opportunities, {
      color: "#f59e0b", titleText: "Oportunidades", icon: "⚠️",
      linkUrl: diagnosticoUrl, anchor: "opportunities",
    }),
    diagnosticoQuickWins: diagSectionHtml(diag.criticals, {
      color: "#ef4444", titleText: "Quick wins (solução rápida)", icon: "🔴",
      linkUrl: diagnosticoUrl, anchor: "criticals",
    }),
    // 2 botões side-by-side: Ver diagnóstico + Solicitar via WhatsApp
    diagnosticoCtaDuplo: ctaDuplo,
    // "Tudo junto" — resumo + 3 seções + 2 botões
    diagnosticoCompleto: [
      diag.summary ? `<p style="color:#374151;line-height:1.6;margin:14px 0;">${esc(diag.summary)}</p>` : "",
      diagSectionHtml(diag.positives, { color: "#10b981", titleText: "Pontos fortes", icon: "✅", linkUrl: diagnosticoUrl, anchor: "positives" }),
      diagSectionHtml(diag.opportunities, { color: "#f59e0b", titleText: "Oportunidades", icon: "⚠️", linkUrl: diagnosticoUrl, anchor: "opportunities" }),
      diagSectionHtml(diag.criticals, { color: "#ef4444", titleText: "Quick wins (solução rápida)", icon: "🔴", linkUrl: diagnosticoUrl, anchor: "criticals" }),
      ctaDuplo,
    ].filter(Boolean).join("\n"),
  };
}
