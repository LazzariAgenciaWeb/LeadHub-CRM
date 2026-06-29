import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// GET /api/conversations/search?q=...
// Procura conversas em todo o histórico (não só nas 100 mais recentes que a
// listagem inicial carrega). Casa por:
//   - Conversation.phone (dígitos OU JID @g.us / @lid)
//   - Lead.name / Lead.phone
//   - CompanyContact.name
//
// Retorna objetos enriquecidos no mesmo formato da listagem inicial
// (lastMsg, lead, contagens, companyContact) pra UI mesclar direto.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const userRole = (session.user as any)?.role;
  const userCompanyId = (session.user as any)?.companyId as string | undefined;
  const isSuperAdmin = userRole === "SUPER_ADMIN";

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ conversations: [] });

  // Escopo: super admin pode passar ?companyId=, demais ficam na própria
  const queryCompanyId = searchParams.get("companyId") ?? "";
  const effectiveCompanyId = isSuperAdmin ? queryCompanyId : userCompanyId;

  // Termo só com dígitos (telefone) — busca também em phones sem máscara
  const qDigits = q.replace(/\D/g, "");

  // 1) Phones que casam por nome (via Lead OU CompanyContact)
  //    → dois selects pequenos pra coletar phones, depois um único findMany
  //    em Conversation com `IN`.
  const phoneSet = new Set<string>();

  // 1a. Match direto na Conversation por phone (substring)
  const directConvWhere: any = {
    OR: [
      { phone: { contains: q,       mode: "insensitive" } },
      ...(qDigits.length >= 4 ? [{ phone: { contains: qDigits } }] : []),
    ],
  };
  if (effectiveCompanyId) directConvWhere.companyId = effectiveCompanyId;
  const directConvs = await prisma.conversation.findMany({
    where: directConvWhere,
    select: { phone: true },
    take: 100,
  });
  for (const c of directConvs) phoneSet.add(c.phone);

  // 1b. Lead — name OU phone
  const leadWhere: any = {
    OR: [
      { name:  { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      ...(qDigits.length >= 4 ? [{ phone: { contains: qDigits } }] : []),
    ],
  };
  if (effectiveCompanyId) leadWhere.companyId = effectiveCompanyId;
  const leadHits = await prisma.lead.findMany({
    where:  leadWhere,
    select: { phone: true },
    take:   100,
  });
  for (const l of leadHits) phoneSet.add(l.phone);

  // 1c. CompanyContact — name OU phone
  const contactWhere: any = {
    OR: [
      { name:  { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      ...(qDigits.length >= 4 ? [{ phone: { contains: qDigits } }] : []),
    ],
  };
  if (effectiveCompanyId) contactWhere.companyId = effectiveCompanyId;
  const contactHits = await prisma.companyContact.findMany({
    where:  contactWhere,
    select: { phone: true },
    take:   100,
  });
  for (const c of contactHits) phoneSet.add(c.phone);

  if (phoneSet.size === 0) return NextResponse.json({ conversations: [] });

  // 2) Busca as Conversations correspondentes (com escopo de empresa)
  const convWhere: any = { phone: { in: [...phoneSet] } };
  if (effectiveCompanyId) convWhere.companyId = effectiveCompanyId;
  const convRecords = await prisma.conversation.findMany({
    where:   convWhere,
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take:    50, // cap pra não enriquecer mil registros
    select: {
      id: true, phone: true, companyId: true,
      status: true, statusUpdatedAt: true, unreadCount: true,
      lastMessageAt: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true } },
      setorId:  true,
      setor:    { select: { id: true, name: true } },
      excludeFromGamification: true,
    },
  });

  // 3) Enriquece (mesmo formato da listagem inicial em whatsapp/page.tsx)
  const conversations = await Promise.all(
    convRecords.map(async (conv) => {
      const [lastMsg, lead, companyContact] = await Promise.all([
        prisma.message.findFirst({
          where:   { conversationId: conv.id },
          orderBy: { receivedAt: "desc" },
          select: {
            body: true, direction: true, receivedAt: true,
            participantPhone: true,
            instance: { select: { instanceName: true } },
          },
        }),
        prisma.lead.findFirst({
          where:   { OR: [{ conversationId: conv.id }, { phone: conv.phone, companyId: conv.companyId }] },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, status: true, notes: true,
            pipeline: true, pipelineStage: true,
            attendanceStatus: true, expectedReturnAt: true,
          },
        }),
        prisma.companyContact.findFirst({
          where: {
            phone: conv.phone,
            OR: [
              { companyId: conv.companyId },
              { company: { parentCompanyId: conv.companyId } },
            ],
          },
          select: {
            id: true, name: true, role: true, hasAccess: true,
            company: { select: { id: true, name: true } },
          },
        }),
      ]);
      return {
        phone:     conv.phone,
        companyId: conv.companyId,
        lastMsg,
        lead: lead ? {
          ...lead,
          expectedReturnAt: lead.expectedReturnAt ? lead.expectedReturnAt.toISOString() : null,
        } : null,
        companyContact,
        conversation: {
          id:                      conv.id,
          status:                  conv.status,
          statusUpdatedAt:         conv.statusUpdatedAt?.toISOString(),
          unreadCount:             conv.unreadCount,
          assigneeId:              conv.assigneeId,
          assignee:                conv.assignee,
          setorId:                 conv.setorId,
          setor:                   conv.setor,
          excludeFromGamification: conv.excludeFromGamification,
        },
      };
    })
  );

  return NextResponse.json({ conversations });
}
