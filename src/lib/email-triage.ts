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
      suspicious: true,
      tags: { select: { name: true } },
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
      e.suspicious ? "⚠️ HEURÍSTICA JÁ MARCOU COMO SUSPEITO" : null,
      e.seen ? null : "não lido",
      e.tags.length ? `tags atuais: ${e.tags.map((t) => t.name).join(", ")}` : null,
      e.lead ? `vinculado ao lead ${e.lead.name ?? ""}` : null,
      e.ticket ? `vinculado ao chamado "${e.ticket.title}"` : null,
    ].filter(Boolean).join(", ");
    return `${i + 1}. [id=${e.id}] De: ${e.fromName ?? ""} <${e.fromEmail}> | Assunto: ${e.subject || "(sem assunto)"}${flags ? ` | ${flags}` : ""}\n   ${bodyText}`;
  }).join("\n");

  // Contexto de tags: as tags da empresa + exemplos reais de como o usuário
  // tagueou (a IA imita o padrão — NUNCA inventa tag nova).
  const companyTags = await prisma.inboxEmailTag.findMany({
    where: { companyId },
    select: { id: true, name: true },
  });
  let tagsBlock = "";
  if (companyTags.length) {
    const taggedExamples = await prisma.inboxEmail.findMany({
      where: { companyId, tags: { some: {} } },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { fromEmail: true, subject: true, tags: { select: { name: true } } },
    });
    const examples = taggedExamples
      .map((e) => `- ${e.fromEmail} | "${e.subject.slice(0, 80)}" → ${e.tags.map((t) => t.name).join(", ")}`)
      .join("\n");
    tagsBlock = `\n\nTAGS DISPONÍVEIS (use APENAS estes nomes, exatamente como escritos): ${companyTags.map((t) => t.name).join(" | ")}
${examples ? `\nComo o usuário tagueou emails anteriores (imite este padrão pra emails semelhantes — mesmo tipo de conteúdo, mesma tag; ex: boleto/fatura de fornecedor novo ganha a mesma tag dos outros boletos):\n${examples}` : ""}
No JSON, inclua "tags": ["Nome"] por email SOMENTE quando tiver confiança clara pelo padrão acima; sem certeza, mande "tags": []. Não sugira tag pra email que já tem "tags atuais".`;
  }

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

DETECÇÃO DE GOLPE (phishing): marque "suspicious": true quando houver sinais como:
- Nome de exibição se passando por órgão público/banco/cartório mas o DOMÍNIO do email não bate (órgão real usa .gov.br/.jus.br; banco usa o domínio oficial). Ex.: "Departamento de Licenciamento PALOTINA" <x@servidory01l46.picaq.org> = GOLPE.
- Domínio com letras e números aleatórios ou sem relação com quem diz ser.
- Urgência + ameaça (multa, suspensão, bloqueio) + pedido de pagamento/boleto/clique.
- Cobrança de serviço que a empresa não contratou.
Email suspeito NUNCA é ALTA — classifique BAIXA com resumo começando por "⚠️ Possível golpe:".

O "digest" é um BRIEFING EXECUTIVO em texto puro (use \\n pra quebras de linha), neste formato — omita seções sem conteúdo:

📬 E-MAILS IMPORTANTES (últimas 24h)
🔴 Urgente
* Remetente/assunto — resumo do problema. → Ação: o que fazer.
🟡 Importante
* ... (ou "Nenhum nas últimas 24h.")
🟢 Informativo: N email(s) sem ação necessária (uma linha explicando).

🚨 SUSPEITA DE GOLPE  ← só se houver
* Remetente <endereço> — por que parece golpe. → Ação: NÃO clicar nem pagar; bloquear @dominio nas Regras.

🌐 VENCIMENTO DE DOMÍNIOS  ← só se houver emails de registro/renovação de domínio
* dominio.com.br — situação (expirado/congelado/a vencer em X dias) — registrador → Ação: ...

💳 COBRANÇAS E PAGAMENTOS  ← só se houver faturas/cobranças
* Fornecedor — valor/descrição — vencimento → status (a vencer/vencida/confirmar)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 RESUMO: X urgente(s) | Y importante(s) | Z informativos | (domínios/cobranças se houver)

Agrupe emails do mesmo assunto/chamado numa linha só. Seja específico: nomes, números de chamado, datas, valores.

Responda APENAS com JSON válido, sem markdown, neste formato:
{"digest":"o briefing acima","emails":[{"id":"...","importance":"ALTA|NORMAL|BAIXA","summary":"resumo de 1 linha em português","suspicious":false,"tags":["Nome da tag existente"]}]}${tagsBlock}`,
      },
      { role: "user", content: `Data/hora atual: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}\n\nEmails da caixa de entrada (mais recentes primeiro):\n\n${list}` },
    ],
  });

  if (!result.ok) return { ok: false, code: result.code as "QUOTA" | "NO_CONFIG" | "AI_ERROR", error: result.error };

  // Parse tolerante: modelo pode embrulhar em ```json ... ```
  let parsed: { digest?: string; emails?: { id: string; importance: string; summary: string; suspicious?: boolean; tags?: string[] }[] };
  try {
    const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "AI_ERROR", error: "A IA retornou um formato inesperado. Tente de novo." };
  }

  // Mapa nome→id das tags reais (case-insensitive) — a IA só aplica existentes.
  const tagByName = new Map(companyTags.map((t) => [t.name.toLowerCase(), t.id]));
  const alreadyTagged = new Set(emails.filter((e) => e.tags.length).map((e) => e.id));

  const validIds = new Set(emails.map((e) => e.id));
  let updated = 0;
  for (const item of parsed.emails ?? []) {
    if (!validIds.has(item.id)) continue;
    const importance = String(item.importance ?? "").toUpperCase();

    const tagIds = alreadyTagged.has(item.id)
      ? []
      : (item.tags ?? [])
          .map((name) => tagByName.get(String(name).trim().toLowerCase()))
          .filter((id): id is string => !!id);

    await prisma.inboxEmail.update({
      where: { id: item.id },
      data: {
        aiImportance: IMPORTANCE.has(importance) ? importance : "NORMAL",
        aiSummary: String(item.summary ?? "").slice(0, 500) || null,
        // Suspeita só LIGA (heurística ou IA) — nunca desliga sozinha.
        ...(item.suspicious === true ? { suspicious: true } : {}),
        ...(tagIds.length ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
      },
    }).catch(() => null);
    updated++;
  }

  return { ok: true, digest: parsed.digest ?? "Análise concluída.", analyzed: updated };
}
