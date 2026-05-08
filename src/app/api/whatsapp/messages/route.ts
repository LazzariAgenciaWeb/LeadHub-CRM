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

  if (!phone) return NextResponse.json({ error: "phone é obrigatório" }, { status: 400 });

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;
  const paginated = limitRaw !== null || before !== null;

  const where: any = { phone };
  if (effectiveCompanyId) where.companyId = effectiveCompanyId;

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
      select: { ...messageSelect, mediaBase64: true },
    });
    const messages = rows.map(({ mediaBase64, ...rest }) => ({
      ...rest,
      hasMedia: !!mediaBase64,
    }));
    return NextResponse.json(messages);
  }

  // Modo paginado
  const limit = Math.min(Math.max(parseInt(limitRaw || "50", 10) || 50, 1), 200);
  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) {
      where.receivedAt = { lt: beforeDate };
    }
  }

  // Pega `limit + 1` em ordem desc pra detectar hasMore sem count extra.
  // Depois revertemos pra ordem asc (cronológica) na resposta.
  const rows = await prisma.message.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: limit + 1,
    select: { ...messageSelect, mediaBase64: true },
  });

  const hasMore = rows.length > limit;
  const trimmed = (hasMore ? rows.slice(0, limit) : rows).reverse();
  const messages = trimmed.map(({ mediaBase64, ...rest }) => ({
    ...rest,
    hasMedia: !!mediaBase64,
  }));

  return NextResponse.json({ messages, hasMore });
}
