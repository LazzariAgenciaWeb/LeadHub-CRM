import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { listPrimaryEvents, type GoogleCalendarEvent } from "@/lib/google-calendar";
import { startOfTodayInSystemTZ, endOfTodayInSystemTZ } from "@/lib/datetime";
import { getCalendarData, resolveContactNames } from "@/lib/calendar-data";
import CalendarioBoard from "./CalendarioBoard";

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const realUserId = (session.user as any)?.id as string;
  const userRole   = (session.user as any)?.role as string;
  const companyId  = (session.user as any)?.companyId as string | undefined;
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const isManager   = isSuperAdmin || userRole === "ADMIN";

  // Visão de time: ADMIN/SUPER pode ver o "Meu Dia" de outro usuário via ?as=ID.
  // Quem NÃO é manager ignora silenciosamente o param (sem privilege escalation).
  const sp = await searchParams;
  let viewingAs: { id: string; name: string | null; email: string | null } | null = null;
  let userId = realUserId;
  if (isManager && sp.as && sp.as !== realUserId) {
    const target = await prisma.user.findFirst({
      where: { id: sp.as, ...(isSuperAdmin ? {} : { companyId: companyId ?? "" }) },
      select: { id: true, name: true, email: true },
    });
    if (target) {
      viewingAs = target;
      userId = target.id;
    }
  }

  // Lista de membros do time pra o picker — só pra manager.
  // Exclui SUPER_ADMIN (Lazzari) e o próprio user (já é o default).
  const teamMembers = isManager
    ? await prisma.user.findMany({
        where: {
          companyId: companyId ?? "",
          role: { not: "SUPER_ADMIN" },
          id: { not: realUserId },
        },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      })
    : [];

  // Setores do usuário-alvo (não do real). Quando manager olha agenda de
  // outro CLIENT, queremos ver os setores DELE (nesse caso, o filtro de
  // setor cai pra zero, porque manager não tem userSetorIds — mas como
  // isManager=true, o filtro de setor nem é aplicado). O caso que importa
  // é CLIENT olhando própria agenda → seus setores filtram corretamente.
  const userSetorIds = (await prisma.setorUser.findMany({
    where: { userId },
    select: { setorId: true },
  })).map((s) => s.setorId);

  const data = await getCalendarData({ companyId, userId, isManager, userSetorIds });

  const today    = startOfTodayInSystemTZ(new Date());
  const todayEnd = endOfTodayInSystemTZ(new Date());

  // ── Resolução de nomes (especialmente grupos do WhatsApp) ────────────────
  const contactNames = await resolveContactNames([
    ...data.scheduledConvs.map((c)   => ({ companyId: c.companyId, phone: c.phone })),
    ...data.unansweredConvs.map((c)  => ({ companyId: c.companyId, phone: c.phone })),
    ...data.inProgressConvs.map((c)  => ({ companyId: c.companyId, phone: c.phone })),
    ...data.leadsFollowUp.map((l)    => ({ companyId: l.companyId, phone: l.phone })),
    ...data.staleLeads.map((l)       => ({ companyId: l.companyId, phone: l.phone })),
  ]);

  // ── Conexão Google Calendar do usuário (per-user) ─────────────────────────
  const googleConn = await prisma.userGoogleConnection.findUnique({
    where: { userId_service: { userId, service: "calendar" } },
    select: { id: true, googleEmail: true, status: true },
  });

  // Busca eventos do Google só se houver conexão ativa.
  // Falhas aqui não devem quebrar a página — degradamos silenciosamente.
  let googleEvents: GoogleCalendarEvent[] = [];
  let googleError: string | null = null;
  if (googleConn && googleConn.status === "ACTIVE") {
    try {
      googleEvents = await listPrimaryEvents(googleConn.id, today, todayEnd, 30);
    } catch (e: any) {
      googleError = e?.message ?? "Erro ao carregar agenda do Google";
    }
  }

  return (
    <CalendarioBoard
      scheduledConvs={data.scheduledConvs as any}
      unansweredConvs={data.unansweredConvs as any}
      inProgressConvs={data.inProgressConvs as any}
      myTickets={data.myTickets as any}
      unassignedTickets={data.unassignedTickets as any}
      leadsFollowUp={data.leadsFollowUp as any}
      staleLeads={data.staleLeads as any}
      currentUserId={userId}
      isSuperAdmin={isSuperAdmin}
      googleConn={googleConn ? { email: googleConn.googleEmail, status: googleConn.status } : null}
      googleEvents={googleEvents as any}
      googleError={googleError}
      contactNames={contactNames}
      isManager={isManager}
      viewingAs={viewingAs}
      teamMembers={teamMembers as any}
    />
  );
}
