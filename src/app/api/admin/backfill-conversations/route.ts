import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ConversationStatus, MessageDir } from "@/generated/prisma";

/**
 * POST /api/admin/backfill-conversations
 *
 * Versão HTTP do script prisma/scripts/backfill-conversations.ts.
 * Use quando não der pra rodar `tsx` diretamente no container (runtime
 * standalone do Next não inclui devDependencies).
 *
 * Proteção: aceita Bearer ${CRON_SECRET} ou ${BACKFILL_SECRET} no header
 * Authorization. Se nenhuma env var estiver setada, aceita qualquer chamada
 * (modo dev). Em produção, configure CRON_SECRET ou BACKFILL_SECRET.
 *
 * Idempotente: pode rodar várias vezes sem duplicar.
 */

const STALE_THRESHOLD_MS = 72 * 60 * 60 * 1000;

interface PhoneAggregate {
  companyId: string;
  phone: string;
  lastMessageAt: Date;
  lastBody: string;
  lastDirection: MessageDir;
  isGroup: boolean;
  primaryInstanceId: string | null;
}

function inferInitialStatus(lastMessageAt: Date, lastDirection: MessageDir): ConversationStatus {
  const ageMs = Date.now() - lastMessageAt.getTime();
  if (ageMs > STALE_THRESHOLD_MS) return "CLOSED";
  if (lastDirection === "INBOUND") return "OPEN";
  return "WAITING_CUSTOMER";
}

async function handle(req: NextRequest) {
  // Proteção
  const expected = process.env.CRON_SECRET ?? process.env.BACKFILL_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const log: string[] = [];
  const t0 = Date.now();

  // 1. Coletar agregados de mensagens em lotes
  const aggregates = new Map<string, PhoneAggregate>();
  const PAGE_SIZE = 5000;
  let cursor: string | undefined;
  let totalScanned = 0;

  while (true) {
    const batch = await prisma.message.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true, companyId: true, phone: true, body: true,
        direction: true, receivedAt: true, instanceId: true,
      },
    });
    if (batch.length === 0) break;

    for (const msg of batch) {
      const key = `${msg.companyId}:${msg.phone}`;
      const existing = aggregates.get(key);
      const isGroup = msg.phone.includes("@g.us") || msg.phone.includes("@lid");
      if (!existing || msg.receivedAt > existing.lastMessageAt) {
        aggregates.set(key, {
          companyId: msg.companyId,
          phone: msg.phone,
          lastMessageAt: msg.receivedAt,
          lastBody: msg.body.slice(0, 200),
          lastDirection: msg.direction,
          isGroup,
          primaryInstanceId: msg.instanceId,
        });
      }
    }

    totalScanned += batch.length;
    cursor = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }
  log.push(`scanned ${totalScanned} messages → ${aggregates.size} conversas únicas`);

  // 2. Criar/atualizar Conversations
  let created = 0;
  let updated = 0;
  const conversationByKey = new Map<string, string>();

  for (const agg of aggregates.values()) {
    const status = inferInitialStatus(agg.lastMessageAt, agg.lastDirection);

    let setorId: string | null = null;
    if (agg.primaryInstanceId) {
      const setorInstance = await prisma.setorInstance.findFirst({
        where: { instanceId: agg.primaryInstanceId },
        select: { setorId: true },
      });
      setorId = setorInstance?.setorId ?? null;
    }

    const conv = await prisma.conversation.upsert({
      where: { companyId_phone: { companyId: agg.companyId, phone: agg.phone } },
      create: {
        companyId:            agg.companyId,
        phone:                agg.phone,
        isGroup:              agg.isGroup,
        status,
        statusUpdatedAt:      agg.lastMessageAt,
        lastMessageAt:        agg.lastMessageAt,
        lastMessageBody:      agg.lastBody,
        lastMessageDirection: agg.lastDirection,
        setorId:              setorId ?? undefined,
        closedAt:             status === "CLOSED" ? agg.lastMessageAt : null,
      },
      update: {
        lastMessageAt:        agg.lastMessageAt,
        lastMessageBody:      agg.lastBody,
        lastMessageDirection: agg.lastDirection,
      },
    });

    const key = `${agg.companyId}:${agg.phone}`;
    conversationByKey.set(key, conv.id);
    if (conv.createdAt.getTime() > Date.now() - 5000) created++;
    else updated++;
  }
  log.push(`${created} criadas, ${updated} já existiam`);

  // 3. Vincular Messages → Conversation
  let totalLinked = 0;
  for (const [key, conversationId] of conversationByKey) {
    const [companyId, phone] = key.split(":", 2);
    const result = await prisma.message.updateMany({
      where: { companyId, phone, conversationId: null },
      data:  { conversationId },
    });
    totalLinked += result.count;
  }
  log.push(`${totalLinked} mensagens vinculadas`);

  // 4. Vincular Leads → Conversation
  let leadsLinked = 0;
  for (const [key, conversationId] of conversationByKey) {
    const [companyId, phone] = key.split(":", 2);
    const result = await prisma.lead.updateMany({
      where: { companyId, phone, conversationId: null },
      data:  { conversationId },
    });
    leadsLinked += result.count;
  }
  log.push(`${leadsLinked} leads vinculados`);

  // 5. Reset unreadCount
  const reset = await prisma.conversation.updateMany({
    where: {},
    data:  { unreadCount: 0 },
  });
  log.push(`unreadCount zerado em ${reset.count} conversas`);

  // Distribuição final
  const summary = await prisma.conversation.groupBy({
    by: ["status"],
    _count: true,
  });
  const statusBreakdown: Record<string, number> = {};
  for (const row of summary) statusBreakdown[row.status] = row._count;

  const elapsedMs = Date.now() - t0;
  return NextResponse.json({
    ok: true,
    elapsedMs,
    log,
    stats: {
      messagesScanned:     totalScanned,
      conversationsCreated: created,
      conversationsUpdated: updated,
      messagesLinked:      totalLinked,
      leadsLinked,
      statusBreakdown,
    },
  });
}

export const GET  = handle;
export const POST = handle;

// Aumenta timeout para o caso de bases grandes (Vercel/Next padrão = 10s)
export const maxDuration = 300; // segundos
