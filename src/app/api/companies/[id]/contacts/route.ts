import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/companies/[id]/contacts
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const contacts = await prisma.companyContact.findMany({
    where: { companyId: id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json(contacts);
}

// POST /api/companies/[id]/contacts
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const { name, phone, isGroup, role, notes } = await req.json();

  if (!phone?.trim()) {
    return NextResponse.json({ error: "Telefone/ID é obrigatório" }, { status: 400 });
  }

  // Normalize: remove non-digits for regular phones
  const normalizedPhone = isGroup
    ? phone.trim()
    : phone.trim().replace(/\D/g, "");

  const existing = await prisma.companyContact.findFirst({
    where: { companyId: id, phone: normalizedPhone },
  });
  if (existing) {
    return NextResponse.json({ error: "Este contato já está cadastrado" }, { status: 409 });
  }

  const contact = await prisma.companyContact.create({
    data: {
      companyId: id,
      phone: normalizedPhone,
      name: name?.trim() || null,
      isGroup: isGroup ?? false,
      role: role ?? "CONTACT",
      notes: notes?.trim() || null,
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json(contact);
}
