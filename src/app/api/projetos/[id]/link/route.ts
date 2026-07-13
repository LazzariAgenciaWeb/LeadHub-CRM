import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// POST /api/projetos/[id]/link — gera (se ainda não existe) o link público do
// cliente. Retorna o publicToken. Idempotente: se já existe, devolve o mesmo.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;
  // Publicar o painel do cliente exige o módulo "Espaço do Cliente".
  const espaco = await assertModule(session, "espacoCliente");
  if (!espaco.ok) return NextResponse.json({ error: "Módulo Espaço do Cliente não habilitado para esta empresa." }, { status: 403 });

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    select: { id: true, publicToken: true, setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  let token = project.publicToken;
  if (!token) {
    token = randomBytes(18).toString("base64url"); // ~24 chars, inguessável
    await prisma.setorClickupList.update({ where: { id }, data: { publicToken: token } });
  }
  return NextResponse.json({ publicToken: token });
}

// DELETE /api/projetos/[id]/link — revoga o link (zera o token)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    select: { id: true, setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  await prisma.setorClickupList.update({ where: { id }, data: { publicToken: null } });
  return NextResponse.json({ ok: true });
}
