import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";

// GET  /api/companies/[id]/marketing/events
//   Lista todos os eventos detectados nos últimos 30 dias + config (isConversion, displayLabel, hidden).
// PATCH /api/companies/[id]/marketing/events
//   Body: { events: [{ eventName, isConversion?, displayLabel?, hidden? }, ...] }
//   Upserta MarketingEventConfig pra cada item.

const SOURCE = "ga4";

async function authorize(companyId: string) {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return { ok: false as const, response: gate.response };
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return { ok: false as const, response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  return { ok: true as const, auth };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const gate = await authorize(companyId);
  if (!gate.ok) return gate.response;

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 30);

  // Agrega contagem últimos 30d por eventName
  const rows = await prisma.analyticsEventDaily.groupBy({
    by: ["eventName"],
    where: { companyId, source: SOURCE, date: { gte: since } },
    _sum: { eventCount: true, users: true },
    orderBy: { _sum: { eventCount: "desc" } },
  });

  const configs = await prisma.marketingEventConfig.findMany({
    where: { companyId, source: SOURCE },
  });
  const configByName = new Map(configs.map((c) => [c.eventName, c]));

  const events = rows.map((r) => {
    const cfg = configByName.get(r.eventName);
    return {
      eventName: r.eventName,
      count30d: r._sum.eventCount ?? 0,
      users30d: r._sum.users ?? 0,
      isConversion: cfg?.isConversion ?? false,
      displayLabel: cfg?.displayLabel ?? null,
      hidden: cfg?.hidden ?? false,
    };
  });

  return NextResponse.json({ events });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const gate = await authorize(companyId);
  if (!gate.ok) return gate.response;

  let body: { events?: Array<{ eventName: string; isConversion?: boolean; displayLabel?: string | null; hidden?: boolean }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.events || !Array.isArray(body.events)) {
    return NextResponse.json({ error: "events[] obrigatório" }, { status: 400 });
  }

  for (const ev of body.events) {
    if (!ev.eventName || typeof ev.eventName !== "string") continue;
    const data = {
      isConversion: ev.isConversion ?? false,
      displayLabel: ev.displayLabel === "" ? null : (ev.displayLabel ?? null),
      hidden: ev.hidden ?? false,
    };
    await prisma.marketingEventConfig.upsert({
      where: { companyId_source_eventName: { companyId, source: SOURCE, eventName: ev.eventName } },
      create: { companyId, source: SOURCE, eventName: ev.eventName, ...data },
      update: data,
    });
  }

  return NextResponse.json({ ok: true, updated: body.events.length });
}
