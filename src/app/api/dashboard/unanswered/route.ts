import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/dashboard/unanswered
// Retorna conversas aguardando resposta (última mensagem INBOUND + não resolvida)
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const where = isSuperAdmin ? {} : { companyId };

  // Agrupa por phone+companyId ordenado pela mensagem mais recente
  const phoneGroups = await prisma.message.groupBy({
    by: ["phone", "companyId"],
    where,
    _max: { receivedAt: true },
    orderBy: { _max: { receivedAt: "desc" } },
    take: 100,
  });

  const result: Array<{
    phone: string; companyId: string; companyName: string | null;
    leadName: string | null; leadId: string | null;
    pipeline: string | null; pipelineStage: string | null; attendanceStatus: string | null;
    lastMsgBody: string; lastMsgAt: string; instanceName: string | null;
  }> = [];

  for (const g of phoneGroups) {
    if (result.length >= 10) break;
    const isGroup = g.phone.includes("@g.us");
    if (isGroup) continue;

    const lastMsg = await prisma.message.findFirst({
      where: { phone: g.phone, companyId: g.companyId },
      orderBy: { receivedAt: "desc" },
      include: {
        instance: { select: { instanceName: true } },
        lead: { select: { id: true, name: true, pipeline: true, pipelineStage: true, attendanceStatus: true } },
        company: { select: { name: true } },
      },
    });

    if (!lastMsg) continue;
    if (lastMsg.direction !== "INBOUND") continue;

    const atStatus = lastMsg.lead?.attendanceStatus;
    const resolved = atStatus === "RESOLVED" || atStatus === "CLOSED";
    if (resolved) continue;

    result.push({
      phone: g.phone,
      companyId: g.companyId,
      companyName: lastMsg.company?.name ?? null,
      leadName: lastMsg.lead?.name ?? null,
      leadId: lastMsg.lead?.id ?? null,
      pipeline: lastMsg.lead?.pipeline ?? null,
      pipelineStage: lastMsg.lead?.pipelineStage ?? null,
      attendanceStatus: atStatus ?? null,
      lastMsgBody: lastMsg.body,
      lastMsgAt: lastMsg.receivedAt.toISOString(),
      instanceName: lastMsg.instance?.instanceName ?? null,
    });
  }

  return NextResponse.json(result);
}
