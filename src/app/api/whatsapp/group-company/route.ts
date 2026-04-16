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

  const isGroup = groupJid.includes("@g.us");

  // Buscar contato existente (em qualquer empresa)
  const existing = await prisma.companyContact.findFirst({
    where: { phone: groupJid },
  });

  // Já está na empresa alvo — nada a fazer
  if (existing?.companyId === targetCompanyId) {
    return NextResponse.json({ ok: true });
  }

  const contactName = existing?.name ?? null;

  // Se existia em outra empresa, remover de lá
  if (existing) {
    await prisma.companyContact.delete({ where: { id: existing.id } });
  }

  // Criar (ou garantir) na empresa alvo
  const contact = await prisma.companyContact.upsert({
    where: { companyId_phone: { companyId: targetCompanyId, phone: groupJid } },
    create: { phone: groupJid, name: contactName, isGroup, companyId: targetCompanyId },
    update: { isGroup, ...(contactName ? { name: contactName } : {}) },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ ok: true, contact });
}
