/**
 * Triagem IA da caixa de email — compartilhada entre o botão "Resumo IA"
 * (manual, analisa os emails do dia) e o poller imap-sync (automática,
 * só emails ainda não triados). Uma interação da cota de IA por chamada,
 * independente da quantidade de emails analisados.
 */
import { prisma } from "./prisma";
import { runAssistant } from "./assistant";

/** Teto de segurança de emails por análise (dia muito cheio). */
const MAX_EMAILS = 100;
/** Corpo enviado pra IA por email (chars) — o assunto costuma bastar. */
const BODY_CHARS = 400;

const IMPORTANCE = new Set(["ALTA", "NORMAL", "BAIXA"]);

export type TriageResult =
  | { ok: true; digest: string; analyzed: number }
  | { ok: false; code: "QUOTA" | "NO_CONFIG" | "AI_ERROR" | "EMPTY"; error: string };

/**
 * Roda a triagem. `scope`:
 *  - "today": emails das últimas 24h (recebidos, Entrada + Importantes) — botão manual.
 *  - "untriaged": só os sem aiImportance — poller automático (não retria nem
 *    gasta cota à toa quando não há novidade).
 */
export async function runEmailTriage(
  companyId: string,
  scope: "today" | "untriaged",
  userId?: string | null
): Promise<TriageResult> {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const emails = await prisma.inboxEmail.findMany({
    where: {
      companyId,
      direction: "IN",
      folder: { in: ["INBOX", "IMPORTANT"] },
      ...(scope === "today" ? { sentAt: { gte: last24h } } : { aiImportance: null }),
    },
    orderBy: { sentAt: "desc" },
    take: MAX_EMAILS,
    select: {
      id: true, fromEmail: true, fromName: true, subject: true,
      snippet: true, textBody: true, seen: true, sentAt: true,
      lead: { select: { name: true } },
      ticket: { select: { title: true } },
    },
  });
  if (!emails.length) {
    return {
      ok: false,
      code: "EMPTY",
      error: scope === "today"
        ? "Nenhum email recebido nas últimas 24h na Entrada — nada pra analisar."
        : "Nenhum email novo pra analisar.",
    };
  }

  const list = emails.map((e, i) => {
    const bodyText = (e.textBody || e.snippet || "").replace(/\s+/g, " ").slice(0, BODY_CHARS);
    const flags = [
      e.seen ? null : "não lido",
      e.lead ? `vinculado ao lead ${e.lead.name ?? ""}` : null,
      e.ticket ? `vinculado ao chamado "${e.ticket.title}"` : null,
    ].filter(Boolean).join(", ");
    return `${i + 1}. [id=${e.id}] De: ${e.fromName ?? ""} <${e.fromEmail}> | Assunto: ${e.subject || "(sem assunto)"}${flags ? ` | ${flags}` : ""}\n   ${bodyText}`;
  }).join("\n");

  const result = await runAssistant({
    companyId,
    endpoint: "email-triage",
    userId: userId ?? null,
    temperature: 0.2,
    maxTokens: 4000,
    messages: [
      {
        role: "system",
        content: `Você é o assistente de triagem de emails de uma empresa brasileira de marketing digital/web (gerencia sites, domínios e hospedagens de clientes). Classifique cada email:
- ALTA: exige ação/resposta — cliente ou lead escrevendo, proposta, pagamento, prazo, problema técnico (site fora do ar, invasão, suspensão), oportunidade de negócio.
- NORMAL: relevante mas sem urgência.
- BAIXA: newsletter, propaganda, notificação automática, spam que passou.

O "digest" é um BRIEFING EXECUTIVO em texto puro (use \\n pra quebras de linha), neste formato — omita seções sem conteúdo:

📬 E-MAILS IMPORTANTES (últimas 24h)
🔴 Urgente
* Remetente/assunto — resumo do problema. → Ação: o que fazer.
🟡 Importante
* ... (ou "Nenhum nas últimas 24h.")
🟢 Informativo: N email(s) sem ação necessária (uma linha explicando).

🌐 VENCIMENTO DE DOMÍNIOS  ← só se houver emails de registro/renovação de domínio
* dominio.com.br — situação (expirado/congelado/a vencer em X dias) — registrador → Ação: ...

💳 COBRANÇAS E PAGAMENTOS  ← só se houver faturas/cobranças
* Fornecedor — valor/descrição — vencimento → status (a vencer/vencida/confirmar)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 RESUMO: X urgente(s) | Y importante(s) | Z informativos | (domínios/cobranças se houver)

Agrupe emails do mesmo assunto/chamado numa linha só. Seja específico: nomes, números de chamado, datas, valores.

Responda APENAS com JSON válido, sem markdown, neste formato:
{"digest":"o briefing acima","emails":[{"id":"...","importance":"ALTA|NORMAL|BAIXA","summary":"resumo de 1 linha em português"}]}`,
      },
      { role: "user", content: `Data/hora atual: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}\n\nEmails da caixa de entrada (mais recentes primeiro):\n\n${list}` },
    ],
  });

  if (!result.ok) return { ok: false, code: result.code as "QUOTA" | "NO_CONFIG" | "AI_ERROR", error: result.error };

  // Parse tolerante: modelo pode embrulhar em ```json ... ```
  let parsed: { digest?: string; emails?: { id: string; importance: string; summary: string }[] };
  try {
    const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "AI_ERROR", error: "A IA retornou um formato inesperado. Tente de novo." };
  }

  const validIds = new Set(emails.map((e) => e.id));
  let updated = 0;
  for (const item of parsed.emails ?? []) {
    if (!validIds.has(item.id)) continue;
    const importance = String(item.importance ?? "").toUpperCase();
    await prisma.inboxEmail.update({
      where: { id: item.id },
      data: {
        aiImportance: IMPORTANCE.has(importance) ? importance : "NORMAL",
        aiSummary: String(item.summary ?? "").slice(0, 500) || null,
      },
    }).catch(() => null);
    updated++;
  }

  return { ok: true, digest: parsed.digest ?? "Análise concluída.", analyzed: updated };
}
