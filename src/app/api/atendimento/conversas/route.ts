import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

interface Conv {
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
}

// GET /api/atendimento/conversas?date=YYYY-MM-DD&companyId=
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session.user as any)?.companyId as string | undefined;

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const companyIdParam = searchParams.get("companyId");

  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: "Parâmetro date inválido. Use YYYY-MM-DD." }, { status: 400 });
  }

  // Resolve companyId
  let companyId: string | undefined;
  if (isSuperAdmin) {
    companyId = companyIdParam ?? undefined;
  } else {
    companyId = userCompanyId;
  }

  const companyFilter = companyId ? { companyId } : {};

  // Date range for requested day
  const [year, month, day] = dateParam.split("-").map(Number);
  const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

  // Fetch messages for that day
  const messages = await prisma.message.findMany({
    where: {
      ...companyFilter,
      receivedAt: { gte: dayStart, lte: dayEnd },
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

  const phonesOnDay = new Set(messages.map((m) => m.phone));
  const phonesArr = Array.from(phonesOnDay);

  // Batch lookup contact names
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

  const convs: Conv[] = [];

  for (const phone of phonesOnDay) {
    const phoneMsgs = messages
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

    const outboundMsg = outboundMsgs[0] ?? phoneMsgs.find((m) => m.instance?.instanceName);
    const instanceName =
      outboundMsg?.instance?.instanceName ??
      phoneMsgs[0]?.instance?.instanceName ??
      null;

    const contactName = leadNameMap.get(phone) ?? contactNameMap.get(phone) ?? null;
    const lastDirection = lastMsg.direction as "INBOUND" | "OUTBOUND";
    const isAnswered = lastDirection === "OUTBOUND";
    const isGroup = phone.includes("@g.us");
    const lastMessagePreview = lastMsg.body?.slice(0, 120) ?? "";

    convs.push({
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
  convs.sort((a, b) => {
    if (a.isAnswered !== b.isAnswered) return a.isAnswered ? 1 : -1;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });

  return NextResponse.json(convs);
}
