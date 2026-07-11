import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// Confere que o projeto pertence à empresa da sessão. Retorna o companyId do setor.
async function ownedProject(id: string, session: any) {
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    select: { id: true, setor: { select: { companyId: true } } },
  });
  if (!project) return { error: NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 }) };
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true as const, companyId: project.setor.companyId };
}

// POST /api/projetos/[id]/servicos — adiciona um serviço à sequência do projeto.
// Body: { serviceId?: string, name?: string } — ao menos um. serviceId precisa ser
// da mesma empresa. Sem serviceId, cria uma etapa livre só com rótulo (name).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const owned = await ownedProject(id, session);
  if ("error" in owned) return owned.error;

  const body = await req.json().catch(() => ({}));
  const serviceId = typeof body.serviceId === "string" && body.serviceId.trim() ? body.serviceId.trim() : null;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  if (!serviceId && !name) {
    return NextResponse.json({ error: "Informe um serviço ou um nome de etapa" }, { status: 400 });
  }

  if (serviceId) {
    const svc = await prisma.service.findUnique({ where: { id: serviceId }, select: { companyId: true } });
    if (!svc || svc.companyId !== owned.companyId) {
      return NextResponse.json({ error: "Serviço inválido" }, { status: 400 });
    }
  }

  const last = await prisma.projectService.findFirst({
    where: { projectId: id }, orderBy: { order: "desc" }, select: { order: true },
  });
  const step = await prisma.projectService.create({
    data: { projectId: id, serviceId, name, order: (last?.order ?? -1) + 1 },
    select: { id: true, serviceId: true, name: true, order: true, service: { select: { name: true } } },
  });
  return NextResponse.json(step, { status: 201 });
}
