import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { revertScore } from "@/lib/gamification";
import { getUserPermissions } from "@/lib/user-permissions";
import { applyLeadUpdate } from "@/lib/leads/update-lead";

// GET /api/leads/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      messages: { orderBy: { receivedAt: "asc" }, take: 50 },
    },
  });

  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  return NextResponse.json(lead);
}

// PATCH /api/leads/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && existing.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const perms = await getUserPermissions(session);
  if (!perms) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string | undefined;

  const body = await req.json();

  // Atendente (CLIENT) sem canViewLeads PODE atualizar campos de atendimento
  // — agendar retorno, mudar attendanceStatus, anotar — desde que pertença
  // a algum setor (atende a conversa). O bloqueio de canViewLeads se aplica
  // só a alterações comerciais (pipeline, value, etc.). Antes o usuário
  // agendava no UI mas o backend devolvia 403 silencioso e nada persistia.
  const onlyAttendanceFields = (() => {
    const touchedKeys = Object.keys(body);
    const ATTENDANCE_KEYS = new Set(["attendanceStatus", "expectedReturnAt", "notes"]);
    return touchedKeys.length > 0 && touchedKeys.every((k) => ATTENDANCE_KEYS.has(k));
  })();
  const canAttend = !perms.noSetor; // tem ao menos um setor = pode atender
  if (!perms.isAdmin && !perms.canViewLeads && !(onlyAttendanceFields && canAttend)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const lead = await applyLeadUpdate(existing, body, { id: userId, name: session.user?.name ?? null });
  return NextResponse.json(lead);
}

// DELETE /api/leads/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  // fix C2 — exclusão é destrutiva: só admin da empresa ou quem tem
  // canManageUsers (gerente/líder com permissão administrativa).
  const perms = await getUserPermissions(session);
  if (!perms) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!perms.isAdmin && !perms.canManageUsers) {
    return NextResponse.json({ error: "Sem permissão para excluir leads" }, { status: 403 });
  }

  // Desvincula as mensagens antes de deletar o lead
  await prisma.message.updateMany({ where: { leadId: id }, data: { leadId: null } });

  // Reverte pontuação atrelada ao lead — busca todos os usuários que pontuaram
  const orphanedEvents = await prisma.scoreEvent.findMany({
    where:  { companyId: lead.companyId, referenceId: id },
    select: { userId: true },
    distinct: ["userId"],
  });

  await prisma.lead.delete({ where: { id } });

  for (const ev of orphanedEvents) {
    await revertScore(ev.userId, lead.companyId, id).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
