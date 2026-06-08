import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getActiveAssistant, runAssistant } from "@/lib/assistant";

// Regras de formato sempre anexadas ao manual do agente (ou ao prompt default),
// pra garantir que a saída seja uma mensagem pronta de WhatsApp.
const FORMAT_RULES = `

[Formato da resposta — siga sempre]
- Escreva em português brasileiro informal mas profissional (mensagem real de WhatsApp).
- Seja direto, empático e objetivo. Máximo 3 frases.
- NÃO inclua saudações desnecessárias se a conversa já está em andamento.
- NÃO use aspas, prefixos ou explicações — retorne APENAS o texto da mensagem.`;

const DEFAULT_MANUAL = `Você é um assistente de atendimento ao cliente via WhatsApp.
Com base no histórico da conversa, sugira UMA única resposta para o atendente enviar agora.`;

// GET /api/ai/suggest-reply?phone=&companyId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // fix A3 — gate de módulo + feature do plano (assistenteIA).
  // Antes só lia de session.modules, ignorando customFeatures da Subscription.
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  // Permissão por setor: módulo habilitado não significa que TODO atendente
  // pode usar — canUseAI controla isso.
  const _aiRole = (session.user as any)?.role;
  const _aiPerms = (session.user as any)?.permissions;
  const _canUse = _aiRole === "SUPER_ADMIN" || _aiRole === "ADMIN" || _aiPerms?.canUseAI;
  if (!_canUse) return NextResponse.json({ error: "Sem permissão para usar IA" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const phone     = searchParams.get("phone");
  const companyId = searchParams.get("companyId");

  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });
  if (!companyId) return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });

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

  // Carrega o agente VENDAS ativo da empresa. Se houver, o manual dele vira o
  // system prompt (a "persona"); senão, cai no manual default. Em ambos os casos
  // as regras de formato são anexadas para garantir uma mensagem pronta.
  const assistant = await getActiveAssistant(companyId, "VENDAS");
  const systemPrompt = (assistant?.manual?.trim() || DEFAULT_MANUAL) + FORMAT_RULES;

  const run = await runAssistant({
    companyId,
    endpoint: "suggest-reply",
    assistantId: assistant?.id ?? null,
    userId: (session.user as any)?.id ?? null,
    model: assistant?.model ?? null,
    temperature: assistant?.temperature ?? 0.7,
    maxTokens: 180,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Histórico da conversa:\n${chatLines}${lastClientMsg ? `\n\nÚltima mensagem do cliente: "${lastClientMsg.body}"` : ""}\n\nSugira a próxima resposta do atendente:`,
      },
    ],
  });

  if (!run.ok) {
    // QUOTA → 429 (cota esgotada/não liberada); NO_CONFIG → 503; AI_ERROR → 502
    const status = run.code === "QUOTA" ? 429 : run.code === "NO_CONFIG" ? 503 : 502;
    return NextResponse.json({ error: run.error, code: run.code }, { status });
  }

  return NextResponse.json({ reply: run.text, remaining: run.remaining });
}
