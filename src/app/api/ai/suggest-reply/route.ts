import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getActiveAssistant, runAssistant, getServicesCatalogBlock } from "@/lib/assistant";

// Regras de formato sempre anexadas ao manual do agente (ou ao prompt default),
// pra garantir que a saída seja uma mensagem pronta de WhatsApp.
const FORMAT_RULES = `

[Formato da resposta — siga sempre]
- Retorne APENAS o texto da mensagem (sem aspas, sem prefixo, sem explicação). Uma única mensagem pronta para enviar no WhatsApp.
- Siga o TOM, o TAMANHO e o uso de EMOJIS definidos no manual. Se o manual pede emojis, USE emojis; se pede mensagens curtas, seja bem curto (1 a 2 frases, ~130 caracteres).
- Não repita saudação se a conversa já está em andamento.
- Se a conversa chegar no momento de marcar reunião/agendar, INCLUA o link de agendamento do manual LITERALMENTE (copie a URL exata) — nunca apenas diga "podemos agendar" sem o link.`;

const DEFAULT_MANUAL = `Você é um assistente de atendimento ao cliente via WhatsApp.
Com base no histórico da conversa, sugira UMA única resposta para o atendente enviar agora.`;

// Cabeçalho forte ANTES do manual: eleva as proibições a regra absoluta.
const STRICT_PREAMBLE = `Você deve seguir o MANUAL abaixo À RISCA. As PROIBIÇÕES do manual são ABSOLUTAS e inegociáveis: nunca as quebre, mesmo que o cliente peça diretamente, insista ou pressione. Se o cliente pedir algo que o manual proíbe (por exemplo, preço/valor/faixa/orçamento quando o manual proíbe), NÃO forneça — responda do jeito que o manual orienta para esses casos (normalmente conduzindo para a reunião/diagnóstico).

===== MANUAL DO AGENTE =====
`;

// Checagem final DEPOIS de tudo (último texto que o modelo lê = maior adesão).
const CLOSING_GUARD = `

[CHECAGEM OBRIGATÓRIA ANTES DE RESPONDER]
Reveja sua resposta: ela respeita TODAS as proibições do manual? Se ela menciona ou oferece algo proibido — por exemplo preço, valor, faixa, orçamento, tabela de preços, ou "posso te enviar os preços" quando o manual proíbe — então REESCREVA sem isso, conduzindo para a reunião/diagnóstico. Nunca entregue uma resposta que viole o manual.`;

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
  // Catálogo de serviços da empresa (sem preço) — injetado entre o manual e as
  // regras de formato, pra o agente reconhecer o serviço e qualificar.
  const catalogBlock = await getServicesCatalogBlock(companyId);
  const manual = assistant?.manual?.trim() || DEFAULT_MANUAL;
  // Link de agendamento: injetado como valor limpo e dedicado, pra o modelo
  // copiar EXATAMENTE (mais confiável que depender da URL no meio do manual).
  const link = assistant?.schedulingLink?.trim();
  const schedulingBlock = link
    ? `\n\n# LINK DE AGENDAMENTO (quando for marcar reunião/agendar, envie SEMPRE este link, copiado EXATAMENTE, sem alterar nenhum caractere)\n${link}`
    : "";
  // Estrutura que maximiza adesão do modelo às proibições:
  // preâmbulo → manual → catálogo → link → regras de formato → checagem final.
  const systemPrompt = STRICT_PREAMBLE + manual + catalogBlock + schedulingBlock + FORMAT_RULES + CLOSING_GUARD;

  const run = await runAssistant({
    companyId,
    endpoint: "suggest-reply",
    assistantId: assistant?.id ?? null,
    userId: (session.user as any)?.id ?? null,
    model: assistant?.model ?? null,
    // Temperatura baixa = mais obediente às regras/proibições. 0.4 dá um pouco
    // de calor/emoji sem soltar as proibições (preâmbulo + checagem seguram).
    temperature: assistant?.temperature ?? 0.4,
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
