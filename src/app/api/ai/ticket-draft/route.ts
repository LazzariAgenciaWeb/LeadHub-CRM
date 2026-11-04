import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOpenAIConfig, chatCompletion } from "@/lib/openai";
import { assertModule } from "@/lib/billing";

// GET /api/ai/ticket-draft?phone=&companyId=
// Lê a conversa recente (cliente + atendente) e devolve sugestão de título e
// descrição pro chamado — o atendente revisa antes de abrir.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const role  = (session.user as any)?.role;
  const perms = (session.user as any)?.permissions;
  if (!(role === "SUPER_ADMIN" || role === "ADMIN" || perms?.canUseAI)) {
    return NextResponse.json({ error: "Sem permissão para usar IA" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const phone     = searchParams.get("phone");
  const companyId = searchParams.get("companyId");
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  const config = await getOpenAIConfig();
  if (!config) {
    return NextResponse.json(
      { error: "OpenAI não configurada. Acesse Configurações → Integrações → OpenAI." },
      { status: 503 },
    );
  }

  // Últimos 7 dias (máx 80 mensagens) — chamado costuma nascer de algo recente,
  // mas a demanda pode ter sido pedida dias antes e só agora virar chamado.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const messages = await prisma.message.findMany({
    where: { phone, ...(companyId ? { companyId } : {}), receivedAt: { gte: since } },
    orderBy: { receivedAt: "desc" },
    take: 80,
    select: { body: true, direction: true, receivedAt: true, participantName: true },
  });
  if (messages.length === 0) {
    return NextResponse.json({ error: "Não há mensagens recentes nesta conversa pra IA ler." }, { status: 404 });
  }

  const chatLines = messages
    .reverse()
    .map((m) => {
      const quem = m.direction === "OUTBOUND" ? "Atendente" : (m.participantName || "Cliente");
      const quando = new Date(m.receivedAt).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
      return `[${quando}] ${quem}: ${m.body}`;
    })
    .join("\n");

  const result = await chatCompletion(
    config,
    [
      {
        role: "system",
        content: `Você ajuda uma agência a abrir chamados de suporte a partir de conversas de WhatsApp.
Leia a conversa e identifique O QUE O CLIENTE PEDIU e o que a equipe já respondeu/combinou.

Responda SEMPRE com JSON válido, sem markdown, no formato exato:
{"title":"...","description":"..."}

- title: assunto objetivo do chamado, até 70 caracteres, sem emoji e sem "Chamado:" na frente.
- description: o pedido escrito de forma clara pra quem vai executar, em português brasileiro.
  Use QUEBRAS DE LINHA reais (\\n) pra separar as partes. Estruture assim quando houver informação:
  "Solicitação: <o que o cliente quer>" / "Contexto: <detalhes relevantes ditos na conversa>" /
  "Combinado: <o que a equipe respondeu ou prometeu>" / "Pendências: <o que falta o cliente enviar>".
  Omita as seções que não tiverem informação na conversa. Não invente nada que não foi dito.
  Se houver itens (ex.: lista de e-mails a criar), liste um por linha começando com "- ".`,
      },
      { role: "user", content: `Conversa com ${phone}:\n\n${chatLines}` },
    ],
    { maxTokens: 700, temperature: 0.2 },
  );

  if (!result) return NextResponse.json({ error: "A IA não retornou resposta." }, { status: 502 });

  try {
    const clean = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    const title = String(parsed.title ?? "").trim().slice(0, 120);
    const description = String(parsed.description ?? "").trim();
    if (!title && !description) throw new Error("vazio");
    return NextResponse.json({ title, description });
  } catch {
    // Sem JSON válido: devolve o texto cru como descrição pro atendente ajustar.
    return NextResponse.json({ title: "", description: result.trim() });
  }
}
