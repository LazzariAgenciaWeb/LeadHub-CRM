import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// GET /api/whatsapp/messages?phone=&companyId=&limit=50&before=ISO
//
// Pagina mensagens da conversa (mais recentes primeiro). Retorna:
//   { messages: Message[] (ordenadas asc por receivedAt), hasMore: boolean }
//
// - Sem `before`: retorna as N mensagens mais recentes
// - Com `before`: retorna as N mensagens anteriores ao timestamp informado
//
// Para compat com chamadas antigas (sem `limit` nem `before`), se NENHUM
// dos dois for passado retornamos array puro com TODAS as mensagens (legacy).
// Quando `limit` ou `before` aparece, retornamos o objeto { messages, hasMore }.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { searchParams } = new URL(req.url);
  const phone     = searchParams.get("phone");
  const companyId = searchParams.get("companyId");
  const limitRaw  = searchParams.get("limit");
  const before    = searchParams.get("before");
  // since/until: janela [gte, lte] em receivedAt. Usado pelo detalhe do
  // chamado pra mostrar só mensagens trocadas entre abertura e fechamento.
  const since     = searchParams.get("since");
  const until     = searchParams.get("until");

  if (!phone) return NextResponse.json({ error: "phone é obrigatório" }, { status: 400 });

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;
  const paginated = limitRaw !== null || before !== null;

  // Visibilidade: não serve mensagens de conversa de instância privada de outro
  // dono nem de conversa bloqueada (esconde o histórico até desbloquear).
  if (effectiveCompanyId) {
    const conv = await prisma.conversation.findUnique({
      where: { companyId_phone: { companyId: effectiveCompanyId, phone } },
      select: { instanceId: true, syncBlocked: true },
    });
    if (conv) {
      const { canUserSeeConversation } = await import("@/lib/whatsapp-visibility");
      if (!(await canUserSeeConversation(session, conv))) {
        return NextResponse.json(paginated ? { messages: [], hasMore: false } : []);
      }
    }
  }

  const where: any = { phone };
  if (effectiveCompanyId) where.companyId = effectiveCompanyId;

  const receivedAtFilter: { gte?: Date; lte?: Date } = {};
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) receivedAtFilter.gte = d;
  }
  if (until) {
    const d = new Date(until);
    if (!Number.isNaN(d.getTime())) receivedAtFilter.lte = d;
  }
  if (receivedAtFilter.gte || receivedAtFilter.lte) {
    where.receivedAt = receivedAtFilter;
  }

  // ATENÇÃO: NUNCA incluir `mediaBase64` nem `rawPayload` nesta listagem.
  // Em conversas com 50+ imagens isso vira 20MB+ de JSON por request — derruba
  // memória do Node e torra largura de banda. A UI consome `hasMedia` aqui pra
  // saber se renderiza placeholder, e busca o binário sob demanda em
  // /api/whatsapp/messages/[id]/media (com cache de browser).
  const messageSelect = {
    id:                true,
    externalId:        true,
    phone:             true,
    participantPhone:  true,
    participantName:   true,
    body:              true,
    direction:         true,
    identifiedAs:      true,
    processed:         true,
    receivedAt:        true,
    ack:               true,
    quotedId:          true,
    quotedBody:        true,
    mediaType:         true, // tipo MIME — UI usa pra decidir entre img/audio/etc.
    companyId:         true,
    instanceId:        true,
    campaignId:        true,
    leadId:            true,
    conversationId:    true,
    sentByUserId:      true,
    instance: { select: { instanceName: true } },
    campaign: { select: { id: true, name: true } },
    sentBy:   { select: { id: true, name: true } },
  } as const;

  // Modo legacy: nenhum parâmetro de paginação → retorna tudo, ordenado asc
  if (!paginated) {
    const rows = await prisma.message.findMany({
      where,
      orderBy: { receivedAt: "asc" },
      select: messageSelect,
    });
    // hasMedia derivado de mediaType (proxy seguro: ingestão da Evolution seta
    // os dois juntos). UI usa /api/whatsapp/messages/[id]/media pra baixar.
    const messages = rows.map((rest) => ({
      ...rest,
      hasMedia: !!rest.mediaType,
    }));
    return NextResponse.json(messages);
  }

  // Modo paginado
  const limit = Math.min(Math.max(parseInt(limitRaw || "50", 10) || 50, 1), 200);
  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) {
      where.receivedAt = { ...(where.receivedAt ?? {}), lt: beforeDate };
    }
  }

  // Pega `limit + 1` em ordem desc pra detectar hasMore sem count extra.
  // Depois revertemos pra ordem asc (cronológica) na resposta.
  const rows = await prisma.message.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: limit + 1,
    select: messageSelect,
  });

  const hasMore = rows.length > limit;
  const trimmed = (hasMore ? rows.slice(0, limit) : rows).reverse();
  const messages = trimmed.map((rest) => ({
    ...rest,
    hasMedia: !!rest.mediaType,
  }));

  return NextResponse.json({ messages, hasMore });
}
