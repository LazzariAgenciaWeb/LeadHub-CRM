import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH /api/whatsapp/group-company
// Body: { groupJid, targetCompanyId }
// Move o CompanyContact do grupo para a empresa alvo
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { groupJid, targetCompanyId } = await req.json();
  if (!groupJid || !groupJid.includes("@g.us")) {
    return NextResponse.json({ error: "groupJid inválido" }, { status: 400 });
  }
  if (!targetCompanyId) {
    return NextResponse.json({ error: "targetCompanyId obrigatório" }, { status: 400 });
  }

  // Buscar contato existente do grupo (em qualquer empresa)
  const existing = await prisma.companyContact.findFirst({
    where: { phone: groupJid, isGroup: true },
  });

  // Já está na empresa alvo — nada a fazer
  if (existing?.companyId === targetCompanyId) {
    return NextResponse.json({ ok: true });
  }

  const groupName = existing?.name ?? null;

  // Se existia em outra empresa, remover de lá
  if (existing) {
    await prisma.companyContact.delete({ where: { id: existing.id } });
  }

  // Criar (ou garantir) na empresa alvo
  const contact = await prisma.companyContact.upsert({
    where: { companyId_phone: { companyId: targetCompanyId, phone: groupJid } },
    create: { phone: groupJid, name: groupName, isGroup: true, companyId: targetCompanyId },
    update: { isGroup: true, ...(groupName ? { name: groupName } : {}) },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ ok: true, contact });
}
