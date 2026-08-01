import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { runAssistant } from "@/lib/assistant";

/** Quantos emails da Entrada entram na análise (1 chamada de IA pra todos). */
const MAX_EMAILS = 20;
/** Corpo enviado pra IA por email (chars) — o assunto costuma bastar. */
const BODY_CHARS = 400;

const IMPORTANCE = new Set(["ALTA", "NORMAL", "BAIXA"]);

// POST /api/email/inbox/ai-triage
// Analisa a Entrada (+ Importantes) numa única interação de IA da cota da
// empresa: classifica a importância de cada email, gera resumo de 1 linha
// por email e um resumo geral do que precisa de atenção.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const role = (session.user as any).role as string;
  const companyId = role === "SUPER_ADMIN"
    ? (body?.companyId ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const emails = await prisma.inboxEmail.findMany({
    where: { companyId, direction: "IN", folder: { in: ["INBOX", "IMPORTANT"] } },
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
    return NextResponse.json({ digest: "Caixa de entrada vazia — nada pra analisar.", analyzed: 0 });
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
    userId: (session.user as any).id ?? null,
    temperature: 0.2,
    maxTokens: 1400,
    messages: [
      {
        role: "system",
        content: `Você é o assistente de triagem de emails de uma empresa brasileira. Classifique cada email:
- ALTA: exige ação/resposta — cliente ou lead escrevendo, proposta, pagamento, prazo, problema, oportunidade de negócio.
- NORMAL: relevante mas sem urgência.
- BAIXA: newsletter, propaganda, notificação automática, spam que passou.

Responda APENAS com JSON válido, sem markdown, neste formato:
{"digest":"resumo geral em 3-6 frases: o que precisa de atenção primeiro e o que pode ignorar","emails":[{"id":"...","importance":"ALTA|NORMAL|BAIXA","summary":"resumo de 1 linha em português"}]}`,
      },
      { role: "user", content: `Emails da caixa de entrada (mais recentes primeiro):\n\n${list}` },
    ],
  });

  if (!result.ok) {
    const status = result.code === "QUOTA" ? 402 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  // Parse tolerante: modelo pode embrulhar em ```json ... ```
  let parsed: { digest?: string; emails?: { id: string; importance: string; summary: string }[] };
  try {
    const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "A IA retornou um formato inesperado. Tente de novo." }, { status: 400 });
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

  return NextResponse.json({
    digest: parsed.digest ?? "Análise concluída.",
    analyzed: updated,
  });
}
