import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOpenAIConfig, chatCompletion } from "@/lib/openai";
import { assertModule } from "@/lib/billing";

// GET /api/ai/summarize?phone=&companyId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // fix A3 — gate de módulo + feature do plano
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const _aiRole = (session.user as any)?.role;
  const _aiPerms = (session.user as any)?.permissions;
  const _canUse = _aiRole === "SUPER_ADMIN" || _aiRole === "ADMIN" || _aiPerms?.canUseAI;
  if (!_canUse) return NextResponse.json({ error: "Sem permissão para usar IA" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const phone     = searchParams.get("phone");
  const companyId = searchParams.get("companyId");

  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  const config = await getOpenAIConfig();
  if (!config) {
    return NextResponse.json(
      { error: "OpenAI não configurada. Acesse Configurações → Integrações → OpenAI." },
      { status: 503 }
    );
  }

  // Mensagens das últimas 24 horas (max 60) — ordenadas do mais antigo ao mais recente
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const messages = await prisma.message.findMany({
    where: {
      phone,
      ...(companyId ? { companyId } : {}),
      receivedAt: { gte: since },
    },
    orderBy: { receivedAt: "asc" },
    take: 60,
    select: { body: true, direction: true, receivedAt: true },
  });

  if (!messages.length) {
    return NextResponse.json({
      summary: "Nenhuma mensagem encontrada nas últimas 24 horas.",
      intent: null,
    });
  }

  const chatLines = messages
    .map((m) => {
      const sender = m.direction === "OUTBOUND" ? "Atendente" : "Cliente";
      const time = new Date(m.receivedAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `[${time}] ${sender}: ${m.body}`;
    })
    .join("\n");

  const result = await chatCompletion(
    config,
    [
      {
        role: "system",
        content: `Você é um assistente de CRM especializado em resumir conversas de atendimento via WhatsApp.
Responda SEMPRE com um JSON válido no formato exato:
{"summary":"...","intent":"..."}
- summary: resumo em 2-4 frases descrevendo o que o cliente pediu e como o atendimento evoluiu
- intent: intenção principal do cliente em até 6 palavras (ex: "Solicitar orçamento de serviço", "Suporte técnico urgente")
Escreva em português brasileiro. Seja objetivo e profissional.`,
      },
      {
        role: "user",
        content: `Conversa com o contato ${phone}:\n\n${chatLines}`,
      },
    ],
    { maxTokens: 350, temperature: 0.3 }
  );

  if (!result) {
    return NextResponse.json({ error: "A IA não retornou resposta." }, { status: 502 });
  }

  try {
    // Remove markdown code fences if present
    const clean = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json({
      summary: parsed.summary ?? result,
      intent:  parsed.intent  ?? null,
    });
  } catch {
    // Fallback: return raw text as summary
    return NextResponse.json({ summary: result, intent: null });
  }
}
