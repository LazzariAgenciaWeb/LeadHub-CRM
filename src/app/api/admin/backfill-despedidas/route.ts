import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTerminalMessage } from "@/lib/whatsapp";

/**
 * Backfill idempotente (2026-10-22): conversas que ficaram como "esperando
 * resposta" só porque o cliente agradeceu/se despediu DEPOIS da nossa resposta.
 *
 * A máquina de estados (decideConversationUpdate) passou a manter
 * WAITING_CUSTOMER nesse caso; isto corrige a base existente no boot do
 * container (start.sh). Só mexe quando TODAS as mensagens do cliente depois
 * da nossa última resposta são cortesia — "obrigado" depois de uma pergunta
 * ainda sem resposta continua aberta.
 *
 * Protegido por CRON_SECRET, igual aos demais jobs internos.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const candidates = await prisma.conversation.findMany({
    where: { status: { in: ["OPEN", "PENDING", "IN_PROGRESS"] }, lastMessageDirection: "INBOUND" },
    select: { id: true, phone: true, companyId: true, lastMessageBody: true },
  });
  const terminal = candidates.filter((c) => isTerminalMessage(c.lastMessageBody ?? ""));

  let ajustadas = 0;
  for (const c of terminal) {
    const recent = await prisma.message.findMany({
      where: { phone: c.phone, companyId: c.companyId },
      orderBy: { receivedAt: "desc" }, take: 8,
      select: { direction: true, body: true },
    });
    const firstOut = recent.findIndex((m) => m.direction === "OUTBOUND");
    if (firstOut <= 0) continue; // nunca respondemos (ou a última é nossa)
    if (!recent.slice(0, firstOut).every((m) => isTerminalMessage(m.body ?? ""))) continue;
    await prisma.conversation.update({ where: { id: c.id }, data: { status: "WAITING_CUSTOMER", statusUpdatedAt: new Date() } });
    ajustadas++;
  }

  return NextResponse.json({ ok: true, candidatas: terminal.length, ajustadas });
}
