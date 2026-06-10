import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

const VALID_TYPES = ["PRE_ATENDENTE", "VENDAS", "SUPORTE", "FINANCEIRO", "GESTOR"] as const;
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
    include: { instance: { select: { id: true, label: true, instanceName: true, phone: true } } },
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

  const created = await prisma.assistant.create({
    data: {
      companyId,
      name,
      type,
      manual,
      instanceId,
      isActive: body.isActive ?? true,
      schedulingLink: (body.schedulingLink ?? "").trim() || null,
      model: (body.model ?? "").trim() || null,
      temperature: typeof body.temperature === "number" ? body.temperature : null,
      createdById: (session.user as any).id ?? null,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
