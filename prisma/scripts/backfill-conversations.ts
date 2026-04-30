/**
 * Sprint 1 — Backfill de Conversation
 *
 * Varre todas as Mensagens existentes, agrupa por (companyId, phone),
 * cria uma Conversation para cada grupo, e vincula:
 *   - Message.conversationId  → conversation.id
 *   - Lead.conversationId     → conversation.id (quando o telefone bate)
 *
 * Status inicial é inferido a partir da última mensagem:
 *   - última INBOUND nas últimas 72h  → OPEN
 *   - última OUTBOUND nas últimas 72h → WAITING_CUSTOMER
 *   - mais antigo                     → CLOSED (vai para arquivada)
 *
 * Script idempotente: pode rodar múltiplas vezes sem duplicar.
 *
 * Como rodar:
 *   npx tsx prisma/scripts/backfill-conversations.ts
 *   ou
 *   npx ts-node --transpile-only prisma/scripts/backfill-conversations.ts
 */

import { PrismaClient, ConversationStatus, MessageDir } from "../../src/generated/prisma";

const prisma = new PrismaClient();

const STALE_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 72h

interface PhoneAggregate {
  companyId: string;
  phone: string;
  lastMessageAt: Date;
  lastBody: string;
  lastDirection: MessageDir;
  isGroup: boolean;
  primaryInstanceId: string | null;
}

async function main() {
  console.log("🔄 Iniciando backfill de Conversation...\n");

  // 1. Pega todas as mensagens, agrupadas por (companyId, phone)
  // Tem que iterar em chunks pra não estourar memória se houver milhões.
  console.log("📊 Coletando agregados de mensagens...");
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
        id: true,
        companyId: true,
        phone: true,
        body: true,
        direction: true,
        receivedAt: true,
        instanceId: true,
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
    process.stdout.write(`  scanned ${totalScanned} messages…\r`);

    if (batch.length < PAGE_SIZE) break;
  }
  console.log(`\n✓ ${totalScanned} mensagens analisadas, ${aggregates.size} conversas únicas\n`);

  // 2. Para cada agregado, cria/atualiza Conversation e seta setor (do primary instance)
  console.log("📝 Criando/atualizando Conversations...");
  let created = 0;
  let updated = 0;
  let conversationByKey = new Map<string, string>(); // (companyId:phone) → conversationId

  for (const agg of aggregates.values()) {
    const status = inferInitialStatus(agg.lastMessageAt, agg.lastDirection);

    // Setor: primeiro instance que recebeu → setor associado (via SetorInstance)
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
        // Só atualiza campos derivados; status já existente NÃO é sobrescrito
        // (idempotência: re-rodar não mexe em conversas já gerenciadas)
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
  console.log(`✓ ${created} criadas, ${updated} atualizadas\n`);

  // 3. Vincula Messages às Conversations criadas
  console.log("🔗 Vinculando Messages → Conversation...");
  let totalLinked = 0;
  for (const [key, conversationId] of conversationByKey) {
    const [companyId, phone] = key.split(":", 2);
    const result = await prisma.message.updateMany({
      where: {
        companyId,
        phone,
        conversationId: null, // só atualiza onde está null (idempotente)
      },
      data: { conversationId },
    });
    totalLinked += result.count;
  }
  console.log(`✓ ${totalLinked} mensagens vinculadas\n`);

  // 4. Vincula Leads às Conversations
  console.log("🔗 Vinculando Leads → Conversation...");
  let leadsLinked = 0;
  for (const [key, conversationId] of conversationByKey) {
    const [companyId, phone] = key.split(":", 2);
    const result = await prisma.lead.updateMany({
      where: {
        companyId,
        phone,
        conversationId: null,
      },
      data: { conversationId },
    });
    leadsLinked += result.count;
  }
  console.log(`✓ ${leadsLinked} leads vinculados\n`);

  // 5. Atualiza unreadCount baseado em mensagens INBOUND não lidas (ack < 3 não conta — é mensagem nossa)
  // Para inbound, "unread" = recebida depois do statusUpdatedAt da conversa OU sem leitura registrada
  // Simplificação: marca como 0 (zera contador). Sprint 2 vai gerenciar isso em real-time.
  console.log("📊 Resetando unreadCount (será gerenciado pelo Sprint 2)...");
  const reset = await prisma.conversation.updateMany({
    where: {},
    data: { unreadCount: 0 },
  });
  console.log(`✓ ${reset.count} conversas\n`);

  console.log("✅ Backfill concluído.\n");

  // Resumo final
  const summary = await prisma.conversation.groupBy({
    by: ["status"],
    _count: true,
  });
  console.log("📈 Distribuição de status:");
  for (const row of summary) {
    console.log(`  ${row.status.padEnd(20)} ${row._count}`);
  }
}

function inferInitialStatus(lastMessageAt: Date, lastDirection: MessageDir): ConversationStatus {
  const ageMs = Date.now() - lastMessageAt.getTime();
  const isStale = ageMs > STALE_THRESHOLD_MS;
  if (isStale) return "CLOSED";
  // Última INBOUND e ainda recente → cliente aguardando resposta
  if (lastDirection === "INBOUND") return "OPEN";
  // Última OUTBOUND e ainda recente → respondemos, esperando cliente
  return "WAITING_CUSTOMER";
}

main()
  .catch((err) => {
    console.error("❌ Erro:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
