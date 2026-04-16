import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/whatsapp/participant-contact?phones=phone1,phone2,...
// Retorna CompanyContacts para os telefones informados
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const phonesStr = new URL(req.url).searchParams.get("phones") ?? "";
  const phones = phonesStr.split(",").map((p) => p.trim()).filter(Boolean);
  if (phones.length === 0) return NextResponse.json([]);

  const contacts = await prisma.companyContact.findMany({
    where: { phone: { in: phones } },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json(contacts);
}

// PATCH /api/whatsapp/participant-contact
// Body: { phone, name?, companyId? }
// Upsert de contato (participante de grupo ou contato individual)
// Também serve para mover um contato de empresa
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { phone, name, companyId } = await req.json();
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  const isGroup = phone.includes("@g.us");

  // Buscar contato existente (em qualquer empresa)
  const existing = await prisma.companyContact.findFirst({ where: { phone } });

  // Se quer mudar de empresa (companyId diferente do atual)
  if (companyId && existing && existing.companyId !== companyId) {
    // Mover: apagar do antigo e criar no novo
    await prisma.companyContact.delete({ where: { id: existing.id } });
    const contact = await prisma.companyContact.upsert({
      where: { companyId_phone: { companyId, phone } },
      create: { phone, name: name ?? existing.name, isGroup, companyId },
      update: { ...(name !== undefined ? { name } : {}), isGroup },
      include: { company: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ contact });
  }

  // Só atualizar nome (mesma empresa)
  if (existing) {
    const contact = await prisma.companyContact.update({
      where: { id: existing.id },
      data: { ...(name !== undefined ? { name } : {}) },
      include: { company: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ contact });
  }

  // Novo contato — precisa de companyId
  if (!companyId) return NextResponse.json({ error: "companyId obrigatório para novo contato" }, { status: 400 });

  const contact = await prisma.companyContact.upsert({
    where: { companyId_phone: { companyId, phone } },
    create: { phone, name: name ?? null, isGroup, companyId },
    update: { ...(name !== undefined ? { name } : {}), isGroup },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ contact });
}
