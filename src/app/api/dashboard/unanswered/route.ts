import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";

// GET /api/dashboard/unanswered
// Retorna conversas aguardando resposta (última mensagem INBOUND + não resolvida)
//
// Regra de visibilidade:
//  - Grupos (@g.us) → todos os usuários da empresa veem, indiferente de instância.
//  - Conversas pessoais → só usuários com permissão na instância em que a mensagem
//    chegou (via setor.instances). Admin/SUPER_ADMIN veem tudo.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  const companyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = role === "SUPER_ADMIN";

  const perms = await getUserPermissions(session);
  // CLIENT sem setor → não vê nada
  if (perms?.noSetor) return NextResponse.json([]);

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
    isGroup: boolean; groupName: string | null;
  }> = [];

  for (const g of phoneGroups) {
    if (result.length >= 10) break;
    const isGroup = g.phone.includes("@g.us");

    // Busca última mensagem, lead e Conversation em paralelo. O Conversation
    // é a fonte de verdade do status: quando o usuário clica em "Finalizar"
    // na inbox, é Conversation.status que vira CLOSED. O Lead.attendanceStatus
    // é legado (sincronizado quando há Lead vinculado, mas pode ficar dessincronizado).
    const [lastMsg, lead, conversation, contact] = await Promise.all([
      prisma.message.findFirst({
        where: { phone: g.phone, companyId: g.companyId },
        orderBy: { receivedAt: "desc" },
        include: {
          instance: { select: { instanceName: true } },
          company: { select: { name: true } },
        },
      }),
      prisma.lead.findFirst({
        where: { phone: g.phone, companyId: g.companyId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, pipeline: true, pipelineStage: true, attendanceStatus: true },
      }),
      prisma.conversation.findUnique({
        where: { companyId_phone: { companyId: g.companyId, phone: g.phone } },
        select: { status: true },
      }),
      // Grupos têm nome em CompanyContact (isGroup=true); pessoais também podem ter
      prisma.companyContact.findUnique({
        where: { companyId_phone: { companyId: g.companyId, phone: g.phone } },
        select: { name: true },
      }),
    ]);

    if (!lastMsg) continue;
    if (lastMsg.direction !== "INBOUND") continue;

    // Visibilidade por instância: grupos passam pra todos; pessoais só pra
    // usuários com permissão na instância (admin/super_admin: perms.instanceIds=null → passa).
    if (!isGroup && !isSuperAdmin && perms && !perms.isAdmin) {
      const allowed = perms.instanceIds ?? [];
      if (!lastMsg.instanceId || !allowed.includes(lastMsg.instanceId)) continue;
    }

    // Status real vem da Conversation. Conversa CLOSED ou SCHEDULED não é
    // "não respondida" — foi atendida ou tem retorno marcado.
    const convStatus = conversation?.status;
    if (convStatus === "CLOSED" || convStatus === "SCHEDULED") continue;

    // Sem Conversation (telefones legados): cai pro attendanceStatus do Lead
    if (!conversation && lead?.attendanceStatus) {
      const at = lead.attendanceStatus;
      if (at === "RESOLVED" || at === "CLOSED" || at === "SCHEDULED") continue;
    }

    result.push({
      phone: g.phone,
      companyId: g.companyId,
      companyName: lastMsg.company?.name ?? null,
      leadName: lead?.name ?? contact?.name ?? null,
      leadId: lead?.id ?? null,
      pipeline: lead?.pipeline ?? null,
      pipelineStage: lead?.pipelineStage ?? null,
      attendanceStatus: convStatus ?? lead?.attendanceStatus ?? null,
      lastMsgBody: lastMsg.body,
      lastMsgAt: lastMsg.receivedAt.toISOString(),
      instanceName: lastMsg.instance?.instanceName ?? null,
      isGroup,
      groupName: isGroup ? contact?.name ?? null : null,
    });
  }

  return NextResponse.json(result);
}
