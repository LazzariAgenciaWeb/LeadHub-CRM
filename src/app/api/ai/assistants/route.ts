import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

const VALID_TYPES = ["PRE_ATENDENTE", "VENDAS", "SUPORTE", "FINANCEIRO", "GESTOR", "ASSESSOR"] as const;
type AssistantTypeStr = (typeof VALID_TYPES)[number];

function resolveCompanyId(session: any, fallback?: string | null): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return fallback ?? session.user.companyId ?? null;
  return session.user.companyId ?? null;
}

// GET /api/ai/assistants[?companyId=]  → lista os agentes da empresa
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const companyId = resolveCompanyId(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json([]);

  const assistants = await prisma.assistant.findMany({
    where: { companyId },
    orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
    include: {
      instance: { select: { id: true, label: true, instanceName: true, phone: true } },
      routes: { include: { setor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  return NextResponse.json(assistants);
}

// POST /api/ai/assistants  → cria um agente
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const companyId = resolveCompanyId(session, body.companyId);
  if (!companyId) return NextResponse.json({ error: "companyId ausente" }, { status: 400 });

  const name = (body.name ?? "").trim();
  const type = body.type as AssistantTypeStr;
  const manual = (body.manual ?? "").trim();

  if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  if (!VALID_TYPES.includes(type)) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  if (!manual) return NextResponse.json({ error: "Manual de instruções obrigatório" }, { status: 400 });

  // Valida instância (se enviada) — precisa ser da mesma empresa.
  let instanceId: string | null = body.instanceId ?? null;
  if (instanceId) {
    const inst = await prisma.whatsappInstance.findFirst({
      where: { id: instanceId, companyId },
      select: { id: true },
    });
    if (!inst) return NextResponse.json({ error: "Instância inválida" }, { status: 400 });
  }

  // Valida conta de Instagram (se enviada) — precisa ser da mesma empresa.
  let igAccountId: string | null = body.igAccountId ?? null;
  if (igAccountId) {
    const acc = await prisma.instagramAccount.findFirst({
      where: { id: igAccountId, companyId },
      select: { id: true },
    });
    if (!acc) return NextResponse.json({ error: "Conta de Instagram inválida" }, { status: 400 });
  }

  // Rotas de triagem (modo autônomo)
  const { sanitizeRoutes } = await import("@/lib/assistant");
  const routes = await sanitizeRoutes(body.routes, companyId);
  if (routes === null) {
    return NextResponse.json({ error: "Rota inválida: intent e setor são obrigatórios (sem intents repetidos)" }, { status: 400 });
  }

  // Agenda p/ agendamento direto — usuário da empresa (ou super admin) com Google conectado
  const calendarUserId: string | null = body.calendarUserId || null;
  if (calendarUserId) {
    const u = await prisma.user.findUnique({ where: { id: calendarUserId }, select: { companyId: true, role: true } });
    if (!u || (u.companyId !== companyId && u.role !== "SUPER_ADMIN")) {
      return NextResponse.json({ error: "Usuário da agenda inválido" }, { status: 400 });
    }
  }
  const meetingDurationMin = Math.min(180, Math.max(15, parseInt(body.meetingDurationMin, 10) || 30));
  const cdRaw = parseInt(body.courtesyDelayMin, 10);
  const courtesyDelayMin = Number.isNaN(cdRaw) ? 5 : Math.min(120, Math.max(0, cdRaw));

  const created = await prisma.assistant.create({
    data: {
      companyId,
      name,
      type,
      manual,
      instanceId,
      igAccountId,
      isActive: body.isActive ?? true,
      autoRespond: body.autoRespond === true,
      activationMode: body.activationMode === "TRIGGER" ? "TRIGGER" : "ALWAYS",
      triggerKeywords: Array.isArray(body.triggerKeywords)
        ? body.triggerKeywords.map((k: unknown) => String(k ?? "").trim()).filter(Boolean).slice(0, 30)
        : [],
      discloseAi: body.discloseAi === true,
      learnings: (body.learnings ?? "").trim() || null,
      qualificationChecklist: (body.qualificationChecklist ?? "").trim() || null,
      schedulingLink: (body.schedulingLink ?? "").trim() || null,
      calendarUserId,
      meetingDurationMin,
      courtesyDelayMin,
      groupFirstAidDelayMin: Math.min(240, Math.max(0, parseInt(body.groupFirstAidDelayMin, 10) || 0)),
      courtesyText: (body.courtesyText ?? "").trim() || null,
      reactivationWord: (body.reactivationWord ?? "").trim() || null,
      sendPauseNotice: body.sendPauseNotice !== false,
      pauseNoticeText: (body.pauseNoticeText ?? "").trim() || null,
      model: (body.model ?? "").trim() || null,
      temperature: typeof body.temperature === "number" ? body.temperature : null,
      createdById: (session.user as any).id ?? null,
      ...(routes.length ? { routes: { create: routes } } : {}),
    },
    include: { routes: { include: { setor: { select: { id: true, name: true } } } } },
  });
  return NextResponse.json(created, { status: 201 });
}
