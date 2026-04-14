import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
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

  const msgWhere: any = {};
  if (companyId) msgWhere.companyId = companyId;

  // Instâncias (só para poder enviar resposta com a instância conectada)
  const instances = await prisma.whatsappInstance.findMany({
    where: companyId ? { companyId } : {},
    select: {
      id: true,
      instanceName: true,
      status: true,
      company: { select: { id: true, name: true } },
    },
  });

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
          include: { instance: { select: { instanceName: true } } },
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
        // Verifica se este telefone é contato de alguma empresa cadastrada
        prisma.companyContact.findFirst({
          where: { phone: p.phone },
          select: {
            id: true, name: true, role: true, hasAccess: true,
            company: { select: { id: true, name: true } },
          },
        }),
      ]);
      return { phone: p.phone, companyId: p.companyId, lastMsg, lead, totalMessages: p._count, inboundCount, outboundCount, companyContact };
    })
  );

  return (
    <WhatsappManager
      instances={instances as any}
      isSuperAdmin={isSuperAdmin}
      defaultCompanyId={companyId}
      conversations={conversations as any}
      defaultPhone={defaultPhone}
    />
  );
}
