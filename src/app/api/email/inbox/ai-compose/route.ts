import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { runAssistant } from "@/lib/assistant";

// POST /api/email/inbox/ai-compose
// { instructions, to?, subject?, replyToId? }
// Assistente de escrita: recebe as instruções do usuário ("cobra o fulano
// pelo boleto vencido, tom cordial") e devolve { subject, body } prontos.
// Em resposta (replyToId), a IA recebe o email original como contexto.
// Consome 1 interação da cota de IA da empresa.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const instructions = String(body?.instructions ?? "").trim();
  if (!instructions) return NextResponse.json({ error: "Descreva o que o email deve dizer" }, { status: 400 });

  // Contexto de resposta: email original (assunto, remetente e trecho).
  let replyContext = "";
  if (body?.replyToId) {
    const original = await prisma.inboxEmail.findFirst({
      where: { id: String(body.replyToId), companyId },
      select: { fromName: true, fromEmail: true, subject: true, textBody: true, snippet: true },
    });
    if (original) {
      const excerpt = (original.textBody || original.snippet || "").replace(/\s+/g, " ").slice(0, 1500);
      replyContext = `\n\nEMAIL SENDO RESPONDIDO:\nDe: ${original.fromName ?? ""} <${original.fromEmail}>\nAssunto: ${original.subject}\nConteúdo: ${excerpt}`;
    }
  }

  const userName = session.user?.name ?? "";
  const result = await runAssistant({
    companyId,
    endpoint: "email-compose",
    userId: (session.user as any).id ?? null,
    temperature: 0.5,
    maxTokens: 900,
    messages: [
      {
        role: "system",
        content: `Você escreve emails comerciais em português brasileiro pra ${userName || "o usuário"}. Regras:
- Tom profissional e cordial, direto ao ponto; parágrafos curtos.
- NÃO invente informações (valores, datas, nomes) que não estejam nas instruções ou no email respondido.
- NÃO inclua assinatura nem despedida com nome (a assinatura é adicionada automaticamente) — termine com uma frase de fechamento simples ("Fico à disposição." etc).
- Responda APENAS com JSON válido, sem markdown: {"subject":"assunto sugerido","body":"corpo do email em texto puro com \\n entre parágrafos"}`,
      },
      {
        role: "user",
        content: `Instruções do usuário: ${instructions}${body?.to ? `\nDestinatário: ${body.to}` : ""}${body?.subject ? `\nAssunto atual (manter se fizer sentido): ${body.subject}` : ""}${replyContext}`,
      },
    ],
  });

  if (!result.ok) {
    const status = result.code === "QUOTA" ? 402 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  try {
    const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(raw);
    return NextResponse.json({
      subject: String(parsed.subject ?? "").slice(0, 200),
      body: String(parsed.body ?? ""),
    });
  } catch {
    // Fallback: usa o texto cru como corpo.
    return NextResponse.json({ subject: null, body: result.text });
  }
}
