import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getUserPermissions } from "@/lib/user-permissions";
import WhatsappManager from "./WhatsappManager";

export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; abrir?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const companyId = isSuperAdmin ? (sp.companyId ?? "") : (userCompanyId ?? "");
  const defaultPhone = sp.abrir ?? "";

  // Permissões do usuário logado (filtra instâncias pelo setor)
  const perms = await getUserPermissions(session);

  const msgWhere: any = {};
  if (companyId) msgWhere.companyId = companyId;

  // Instâncias: filtra pelo setor do usuário (se não for admin)
  const instanceWhere: any = companyId ? { companyId } : {};
  if (perms && !perms.isAdmin && perms.instanceIds) {
    instanceWhere.id = { in: perms.instanceIds };
  }

  const instances = await prisma.whatsappInstance.findMany({
    where: instanceWhere,
    select: {
      id: true,
      instanceName: true,
      phone: true,
      status: true,
      company: { select: { id: true, name: true } },
    },
  });

  // Conversas: filtra apenas as instâncias que o usuário pode ver
  if (perms && !perms.isAdmin && perms.instanceIds && perms.instanceIds.length > 0) {
    msgWhere.instanceId = { in: perms.instanceIds };
  } else if (perms && !perms.isAdmin && perms.instanceIds?.length === 0) {
    // Sem nenhuma instância no setor → sem conversas
    msgWhere.id = "NOOP_NO_ACCESS";
  }

  // Conversas agrupadas por telefone
  const phones = await prisma.message.groupBy({
    by: ["phone", "companyId"],
    where: msgWhere,
    _max: { receivedAt: true },
    _count: true,
    orderBy: { _max: { receivedAt: "desc" } },
    take: 100,
  });

  const conversations = await Promise.all(
    phones.map(async (p) => {
      const [lastMsg, lead, inboundCount, outboundCount, companyContact] = await Promise.all([
        prisma.message.findFirst({
          where: { phone: p.phone, companyId: p.companyId },
          orderBy: { receivedAt: "desc" },
          select: {
            body: true,
            direction: true,
            receivedAt: true,
            participantPhone: true,
            instance: { select: { instanceName: true } },
          },
        }),
        prisma.lead.findFirst({
          where: { phone: p.phone, companyId: p.companyId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, status: true, notes: true,
            pipeline: true, pipelineStage: true,
            attendanceStatus: true, expectedReturnAt: true,
          },
        }),
        prisma.message.count({ where: { phone: p.phone, companyId: p.companyId, direction: "INBOUND" } }),
        prisma.message.count({ where: { phone: p.phone, companyId: p.companyId, direction: "OUTBOUND" } }),
        prisma.companyContact.findFirst({
          where: { phone: p.phone, companyId: p.companyId },
          select: {
            id: true, name: true, role: true, hasAccess: true,
            company: { select: { id: true, name: true } },
          },
        }),
      ]);
      return { phone: p.phone, companyId: p.companyId, lastMsg, lead, totalMessages: p._count, inboundCount, outboundCount, companyContact };
    })
  );

  const finalStageConfigs = await prisma.pipelineStageConfig.findMany({
    where: { isFinal: true, ...(companyId ? { companyId } : {}) },
    select: { name: true },
  });
  const finalStageNames = [...new Set(finalStageConfigs.map((s) => s.name))];

  // Busca assinatura e nome do usuário logado direto do banco (evita JWT stale)
  const currentUser = session?.user as any;
  const userId: string | undefined = currentUser?.id;
  const dbUser = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, whatsappSignature: true },
      })
    : null;

  return (
    <WhatsappManager
      instances={instances as any}
      isSuperAdmin={isSuperAdmin}
      defaultCompanyId={companyId}
      conversations={conversations as any}
      defaultPhone={defaultPhone}
      finalStageNames={finalStageNames}
      userSignature={dbUser?.whatsappSignature ?? ""}
      userName={dbUser?.name ?? currentUser?.name ?? ""}
    />
  );
}
