import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { sanitizeSegmentFilter } from "@/lib/email-segment";

// Cadência padrão (presets na UI sobrescrevem). "Normal" = 60/h, horário comercial.
const DEFAULT_CADENCE = {
  maxPerHour: 60,
  jitterMs: [800, 4000],
  windowStart: "09:00",
  windowEnd: "18:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  timezone: "America/Sao_Paulo",
};

function companyIdFor(session: any, fallback?: string | null): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return fallback ?? session.user.companyId ?? null;
  return session.user.companyId ?? null;
}

// GET /api/email/campaigns?companyId=
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const companyId = companyIdFor(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json([]);

  const campaigns = await prisma.emailCampaign.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    include: {
      template: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(campaigns);
}

// POST /api/email/campaigns  → cria DRAFT
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const companyId = companyIdFor(session, body.companyId);
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const name = (body.name ?? "").trim();
  const templateId = body.templateId;
  if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  if (!templateId) return NextResponse.json({ error: "Template obrigatório" }, { status: 400 });

  // Template precisa ser da mesma empresa
  const tpl = await prisma.emailTemplate.findUnique({ where: { id: templateId }, select: { companyId: true, subject: true } });
  if (!tpl || tpl.companyId !== companyId) {
    return NextResponse.json({ error: "Template inválido" }, { status: 400 });
  }

  const userId = (session.user as any).id as string;
  const cadence = body.cadenceConfig && typeof body.cadenceConfig === "object"
    ? { ...DEFAULT_CADENCE, ...body.cadenceConfig }
    : DEFAULT_CADENCE;

  const campaign = await prisma.emailCampaign.create({
    data: {
      name,
      subject: (body.subject ?? tpl.subject ?? "").trim() || tpl.subject,
      templateId,
      status: "DRAFT",
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      cadenceConfig: cadence,
      segmentFilter: sanitizeSegmentFilter(body.segmentFilter) as any,
      companyId,
      createdById: userId,
    },
  });
  return NextResponse.json(campaign, { status: 201 });
}
