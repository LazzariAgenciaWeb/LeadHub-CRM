import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import AssistenteBoard from "./AssistenteBoard";

export default async function AssistentePage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session.user as any)?.companyId as string | undefined;
  const companyFilter = isSuperAdmin ? {} : { companyId: userCompanyId };

  // ── Date ranges ────────────────────────────────────────────────────────────
  const now = new Date();

  const since30 = new Date(now);
  since30.setDate(since30.getDate() - 30);
  since30.setHours(0, 0, 0, 0);

  const yesterdayStart = new Date(now);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  yesterdayStart.setHours(0, 0, 0, 0);

  const yesterdayEnd = new Date(now);
  yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
  yesterdayEnd.setHours(23, 59, 59, 999);

  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // ── Messages: last 30 days ─────────────────────────────────────────────────
  const messages = await prisma.message.findMany({
    where: {
      ...companyFilter,
      receivedAt: { gte: since30 },
    },
    select: {
      phone: true,
      direction: true,
      receivedAt: true,
      body: true,
      instanceId: true,
      instance: { select: { instanceName: true } },
    },
    orderBy: { receivedAt: "asc" },
  });

  // ── dailyGraph: 30 days ────────────────────────────────────────────────────
  type DayData = {
    dateKey: string;
    label: string;
    total: number;
    respondidas: number;
    pendentes: number;
    avgResponseMin: number;
  };

  const dailyGraph: DayData[] = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const dateKey = dayStart.toISOString().slice(0, 10);
    const label = `${String(dayStart.getDate()).padStart(2, "0")}/${String(dayStart.getMonth() + 1).padStart(2, "0")}`;

    const dayMsgs = messages.filter((m) => {
      const t = new Date(m.receivedAt).getTime();
      return t >= dayStart.getTime() && t <= dayEnd.getTime();
    });

    // Unique phones on this day
    const phonesOnDay = new Set(dayMsgs.map((m) => m.phone));
    const total = phonesOnDay.size;

    // Per phone: check if responded (OUTBOUND after INBOUND)
    let respondidas = 0;
    const responseTimes: number[] = [];

    for (const phone of phonesOnDay) {
      const phoneMsgs = dayMsgs.filter((m) => m.phone === phone).sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
      const firstInbound = phoneMsgs.find((m) => m.direction === "INBOUND");
      if (!firstInbound) continue;
      const firstOutboundAfter = phoneMsgs.find(
        (m) =>
          m.direction === "OUTBOUND" &&
          new Date(m.receivedAt).getTime() > new Date(firstInbound.receivedAt).getTime()
      );
      if (firstOutboundAfter) {
        respondidas++;
        const diffMin =
          (new Date(firstOutboundAfter.receivedAt).getTime() - new Date(firstInbound.receivedAt).getTime()) / 60000;
        responseTimes.push(diffMin);
      }
    }

    const avgResponseMin =
      responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0;

    dailyGraph.push({
      dateKey,
      label,
      total,
      respondidas,
      pendentes: total - respondidas,
      avgResponseMin,
    });
  }

  // ── yesterdayConvs ─────────────────────────────────────────────────────────
  const yesterdayMsgs = messages.filter((m) => {
    const t = new Date(m.receivedAt).getTime();
    return t >= yesterdayStart.getTime() && t <= yesterdayEnd.getTime();
  });

  const yesterdayPhones = new Set(yesterdayMsgs.map((m) => m.phone));

  // Batch lookup contact names for yesterday's phones
  const phonesArr = Array.from(yesterdayPhones);

  const [leadRows, contactRows] = await Promise.all([
    prisma.lead.findMany({
      where: { ...companyFilter, phone: { in: phonesArr } },
      select: { phone: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.companyContact.findMany({
      where: { ...companyFilter, phone: { in: phonesArr } },
      select: { phone: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const leadNameMap = new Map<string, string>();
  for (const r of leadRows) {
    if (r.name && !leadNameMap.has(r.phone)) leadNameMap.set(r.phone, r.name);
  }
  const contactNameMap = new Map<string, string>();
  for (const r of contactRows) {
    if (r.name && !contactNameMap.has(r.phone)) contactNameMap.set(r.phone, r.name);
  }

  type Conv = {
    phone: string;
    contactName: string | null;
    instanceName: string | null;
    firstMessageAt: string;
    lastMessageAt: string;
    lastDirection: "INBOUND" | "OUTBOUND";
    responseTimeMinutes: number | null;
    totalMessages: number;
    inboundCount: number;
    outboundCount: number;
    isAnswered: boolean;
    isGroup: boolean;
    lastMessagePreview: string;
  };

  const yesterdayConvs: Conv[] = [];

  for (const phone of yesterdayPhones) {
    const phoneMsgs = yesterdayMsgs
      .filter((m) => m.phone === phone)
      .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

    if (phoneMsgs.length === 0) continue;

    const firstMsg = phoneMsgs[0];
    const lastMsg = phoneMsgs[phoneMsgs.length - 1];

    const inboundMsgs = phoneMsgs.filter((m) => m.direction === "INBOUND");
    const outboundMsgs = phoneMsgs.filter((m) => m.direction === "OUTBOUND");

    const firstInbound = inboundMsgs[0];
    const firstOutboundAfterInbound = firstInbound
      ? outboundMsgs.find(
          (m) => new Date(m.receivedAt).getTime() > new Date(firstInbound.receivedAt).getTime()
        )
      : undefined;

    let responseTimeMinutes: number | null = null;
    if (firstInbound && firstOutboundAfterInbound) {
      responseTimeMinutes = Math.round(
        (new Date(firstOutboundAfterInbound.receivedAt).getTime() -
          new Date(firstInbound.receivedAt).getTime()) /
          60000
      );
    }

    // instanceName: prefer outbound message's instance, fallback to any
    const outboundMsg = outboundMsgs[0] ?? phoneMsgs.find((m) => m.instance?.instanceName);
    const instanceName = outboundMsg?.instance?.instanceName ?? phoneMsgs[0]?.instance?.instanceName ?? null;

    const contactName = leadNameMap.get(phone) ?? contactNameMap.get(phone) ?? null;
    const lastDirection = lastMsg.direction as "INBOUND" | "OUTBOUND";
    const isAnswered = lastDirection === "OUTBOUND";
    const isGroup = phone.includes("@g.us");
    const lastMessagePreview = lastMsg.body?.slice(0, 120) ?? "";

    yesterdayConvs.push({
      phone,
      contactName,
      instanceName,
      firstMessageAt: new Date(firstMsg.receivedAt).toISOString(),
      lastMessageAt: new Date(lastMsg.receivedAt).toISOString(),
      lastDirection,
      responseTimeMinutes,
      totalMessages: phoneMsgs.length,
      inboundCount: inboundMsgs.length,
      outboundCount: outboundMsgs.length,
      isAnswered,
      isGroup,
      lastMessagePreview,
    });
  }

  // Sort: unanswered first, then by lastMessageAt desc
  yesterdayConvs.sort((a, b) => {
    if (a.isAnswered !== b.isAnswered) return a.isAnswered ? 1 : -1;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });

  // ── instanceStats: full 30 days ────────────────────────────────────────────
  const instanceMap = new Map<string, { total: number; respondidas: number }>();

  const allPhones30 = new Set(messages.map((m) => m.phone));
  for (const phone of allPhones30) {
    const phoneMsgs = messages
      .filter((m) => m.phone === phone)
      .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

    const hasInbound = phoneMsgs.some((m) => m.direction === "INBOUND");
    if (!hasInbound) continue;

    // Find the instance that sent outbound
    const firstInbound = phoneMsgs.find((m) => m.direction === "INBOUND");
    const firstOutboundAfter = firstInbound
      ? phoneMsgs.find(
          (m) =>
            m.direction === "OUTBOUND" &&
            new Date(m.receivedAt).getTime() > new Date(firstInbound.receivedAt).getTime()
        )
      : undefined;

    const instName =
      firstOutboundAfter?.instance?.instanceName ??
      phoneMsgs.find((m) => m.instance?.instanceName)?.instance?.instanceName ??
      "Desconhecida";

    if (!instanceMap.has(instName)) instanceMap.set(instName, { total: 0, respondidas: 0 });
    const entry = instanceMap.get(instName)!;
    entry.total++;
    if (firstOutboundAfter) entry.respondidas++;
  }

  const instanceStats = Array.from(instanceMap.entries()).map(([name, s]) => ({
    name,
    total: s.total,
    respondidas: s.respondidas,
    taxaResposta: s.total > 0 ? Math.round((s.respondidas / s.total) * 100) : 0,
  }));

  // ── pendingLeads ───────────────────────────────────────────────────────────
  const pendingLeadsRaw = await prisma.lead.findMany({
    where: {
      ...companyFilter,
      expectedReturnAt: { lte: todayEnd },
      NOT: {
        attendanceStatus: { in: ["RESOLVED", "CLOSED"] },
      },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      expectedReturnAt: true,
      pipeline: true,
      pipelineStage: true,
      attendanceStatus: true,
    },
    orderBy: { expectedReturnAt: "asc" },
    take: 20,
  });

  const pendingLeads = pendingLeadsRaw.map((l) => ({
    ...l,
    expectedReturnAt: l.expectedReturnAt ? l.expectedReturnAt.toISOString() : null,
  }));

  // ── stalledOpps ────────────────────────────────────────────────────────────
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const stalledOppsRaw = await prisma.lead.findMany({
    where: {
      ...companyFilter,
      pipeline: "OPORTUNIDADES",
      updatedAt: { lt: sevenDaysAgo },
      NOT: {
        attendanceStatus: { in: ["RESOLVED", "CLOSED"] },
      },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      pipelineStage: true,
      updatedAt: true,
      expectedReturnAt: true,
      attendanceStatus: true,
    },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });

  const stalledOpps = stalledOppsRaw.map((o) => ({
    ...o,
    updatedAt: o.updatedAt.toISOString(),
    expectedReturnAt: o.expectedReturnAt ? o.expectedReturnAt.toISOString() : null,
  }));

  // ── openTickets ────────────────────────────────────────────────────────────
  const priorityOrder: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

  const openTicketsRaw = await prisma.ticket.findMany({
    where: {
      ...companyFilter,
      status: { in: ["OPEN", "IN_PROGRESS"] },
    },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
    },
    take: 15,
  });

  const openTickets = openTicketsRaw
    .sort((a, b) => {
      const po = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
      if (po !== 0) return po;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })
    .map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));

  const companyId = userCompanyId ?? "";

  return (
    <AssistenteBoard
      dailyGraph={dailyGraph}
      yesterdayConvs={yesterdayConvs}
      instanceStats={instanceStats}
      pendingLeads={pendingLeads}
      stalledOpps={stalledOpps}
      openTickets={openTickets}
      companyId={companyId}
    />
  );
}
