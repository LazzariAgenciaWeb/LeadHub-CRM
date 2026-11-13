/**
 * Enriquecimento da lista de conversas do WhatsApp (última mensagem, lead,
 * contato da empresa e "quem falou por último foi a IA").
 *
 * Antes cada tela fazia 4 queries POR conversa (50 conversas = 200 queries) e a
 * caixa de entrada repete isso a cada 5s por aba aberta — com poucas abas o
 * pool de conexões do Prisma já ficava em fila e o sistema inteiro arrastava.
 * Aqui o mesmo resultado sai em 3 queries, seja qual for o tamanho da página.
 *
 * Usado por whatsapp/page.tsx, /api/conversations/list e /search — os três
 * precisam devolver exatamente o mesmo formato.
 */

import { Prisma } from "@/generated/prisma";
import { prisma } from "./prisma";

type ConvRef = { id: string; phone: string; companyId: string };

export type ConversationExtras = {
  lastMsg: {
    body: string;
    direction: "INBOUND" | "OUTBOUND";
    receivedAt: Date;
    participantPhone: string | null;
    instance: { instanceName: string } | null;
  } | null;
  lead: {
    id: string;
    name: string | null;
    status: string;
    notes: string | null;
    pipeline: string | null;
    pipelineStage: string | null;
    attendanceStatus: string | null;
    expectedReturnAt: Date | null;
  } | null;
  companyContact: {
    id: string;
    name: string | null;
    role: string | null;
    hasAccess: boolean;
    company: { id: string; name: string };
  } | null;
  /** Última mensagem NOSSA saiu do agente de IA (rawPayload.autoAgent). */
  lastOutboundByAI: boolean;
};

type LastRow = {
  conversationId: string;
  body: string | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  receivedAt: Date | null;
  participantPhone: string | null;
  instanceId: string | null;
  instanceName: string | null;
  autoAgent: unknown;
};

const VAZIO: ConversationExtras = { lastMsg: null, lead: null, companyContact: null, lastOutboundByAI: false };

export async function enrichConversations(convs: ConvRef[]): Promise<Map<string, ConversationExtras>> {
  const out = new Map<string, ConversationExtras>();
  if (convs.length === 0) return out;

  const ids = convs.map((c) => c.id);
  const phones = [...new Set(convs.map((c) => c.phone))];
  const companyIds = [...new Set(convs.map((c) => c.companyId))];

  const [lastRows, leads, contacts] = await Promise.all([
    // Última mensagem + última OUTBOUND de cada conversa numa ida só. LATERAL
    // com LIMIT 1 usa o índice (conversationId, receivedAt) por conversa — não
    // varre o histórico. Do rawPayload só sai a chave autoAgent (o payload
    // inteiro é pesado e era trafegado 50x a cada atualização).
    prisma.$queryRaw<LastRow[]>(Prisma.sql`
      SELECT c.id AS "conversationId",
             m.body, m.direction::text AS direction, m."receivedAt", m."participantPhone",
             m."instanceId", i."instanceName",
             o.auto AS "autoAgent"
      FROM unnest(${ids}::text[]) AS c(id)
      LEFT JOIN LATERAL (
        SELECT body, direction, "receivedAt", "participantPhone", "instanceId"
        FROM "Message"
        WHERE "conversationId" = c.id
        ORDER BY "receivedAt" DESC
        LIMIT 1
      ) m ON true
      LEFT JOIN "WhatsappInstance" i ON i.id = m."instanceId"
      LEFT JOIN LATERAL (
        SELECT "rawPayload"->'autoAgent' AS auto
        FROM "Message"
        WHERE "conversationId" = c.id AND direction = 'OUTBOUND'
        ORDER BY "receivedAt" DESC
        LIMIT 1
      ) o ON true
    `),
    prisma.lead.findMany({
      where: {
        OR: [
          { conversationId: { in: ids } },
          { phone: { in: phones }, companyId: { in: companyIds } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, status: true, notes: true,
        pipeline: true, pipelineStage: true,
        attendanceStatus: true, expectedReturnAt: true,
        conversationId: true, phone: true, companyId: true,
      },
    }),
    prisma.companyContact.findMany({
      where: {
        phone: { in: phones },
        OR: [
          { companyId: { in: companyIds } },
          { company: { parentCompanyId: { in: companyIds } } },
        ],
      },
      select: {
        id: true, name: true, role: true, hasAccess: true,
        phone: true, companyId: true,
        company: { select: { id: true, name: true, parentCompanyId: true } },
      },
    }),
  ]);

  const lastById = new Map(lastRows.map((r) => [r.conversationId, r]));

  for (const conv of convs) {
    const row = lastById.get(conv.id);

    // Leads já vêm do mais novo pro mais antigo → o primeiro que casa é o mesmo
    // que o findFirst(orderBy createdAt desc) antigo devolvia.
    const leadRow = leads.find(
      (l) => l.conversationId === conv.id || (l.phone === conv.phone && l.companyId === conv.companyId),
    );
    const lead = leadRow
      ? (({ conversationId: _c, phone: _p, companyId: _e, ...rest }) => rest)(leadRow)
      : null;

    // Contato: o da própria empresa ganha do de uma sub-empresa.
    const doTelefone = contacts.filter((c) => c.phone === conv.phone);
    const contactRow =
      doTelefone.find((c) => c.companyId === conv.companyId) ??
      doTelefone.find((c) => c.company.parentCompanyId === conv.companyId);

    out.set(conv.id, {
      lastMsg: row?.receivedAt
        ? {
            body: row.body ?? "",
            direction: row.direction ?? "INBOUND",
            receivedAt: row.receivedAt,
            participantPhone: row.participantPhone,
            instance: row.instanceId && row.instanceName != null ? { instanceName: row.instanceName } : null,
          }
        : null,
      lead: lead as ConversationExtras["lead"],
      companyContact: contactRow
        ? {
            id: contactRow.id,
            name: contactRow.name,
            role: contactRow.role,
            hasAccess: contactRow.hasAccess,
            company: { id: contactRow.company.id, name: contactRow.company.name },
          }
        : null,
      lastOutboundByAI: !!row?.autoAgent,
    });
  }

  return out;
}

export function extrasOf(map: Map<string, ConversationExtras>, id: string): ConversationExtras {
  return map.get(id) ?? VAZIO;
}
