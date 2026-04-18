import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOpenAIConfig, chatCompletion } from "@/lib/openai";

// GET /api/ai/suggest-reply?phone=&companyId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

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

  // Últimas 25 mensagens para contexto da conversa (do mais antigo ao mais recente)
  const messages = await prisma.message.findMany({
    where: {
      phone,
      ...(companyId ? { companyId } : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: 25,
    select: { body: true, direction: true, receivedAt: true },
  });
  messages.reverse(); // mais antigo primeiro

  if (!messages.length) {
    return NextResponse.json({ reply: "Olá! Como posso ajudar?" });
  }

  // Última mensagem do cliente para dar contexto imediato
  const lastClientMsg = [...messages].reverse().find((m) => m.direction === "INBOUND");

  const chatLines = messages
    .map((m) => {
      const sender = m.direction === "OUTBOUND" ? "Atendente" : "Cliente";
      return `${sender}: ${m.body}`;
    })
    .join("\n");

  const result = await chatCompletion(
    config,
    [
      {
        role: "system",
        content: `Você é um assistente de atendimento ao cliente via WhatsApp.
Com base no histórico da conversa, sugira UMA única resposta para o atendente enviar agora.
Regras:
- Escreva em português brasileiro informal mas profissional (como se fosse uma mensagem de WhatsApp real)
- Seja direto, empático e objetivo
- NÃO inclua saudações desnecessárias se a conversa já está em andamento
- NÃO use aspas, prefixos ou explicações — retorne APENAS o texto da mensagem
- Máximo 3 frases`,
      },
      {
        role: "user",
        content: `Histórico da conversa:\n${chatLines}${lastClientMsg ? `\n\nÚltima mensagem do cliente: "${lastClientMsg.body}"` : ""}\n\nSugira a próxima resposta do atendente:`,
      },
    ],
    { maxTokens: 180, temperature: 0.7 }
  );

  return NextResponse.json({ reply: result ?? "Como posso ajudar?" });
}
