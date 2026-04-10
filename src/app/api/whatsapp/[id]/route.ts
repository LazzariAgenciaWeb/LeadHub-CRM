import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionDeleteInstance } from "@/lib/evolution";

// PATCH /api/whatsapp/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const existing = await prisma.whatsappInstance.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Instância não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && existing.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { instanceName, phone, status, webhookUrl } = body;

  const instance = await prisma.whatsappInstance.update({
    where: { id },
    data: { instanceName, phone, status, webhookUrl },
  });

  return NextResponse.json(instance);
}

// DELETE /api/whatsapp/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const existing = await prisma.whatsappInstance.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Instância não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && existing.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  // Remove from Evolution API (best effort)
  await evolutionDeleteInstance(existing.instanceName).catch(() => {});

  await prisma.whatsappInstance.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
