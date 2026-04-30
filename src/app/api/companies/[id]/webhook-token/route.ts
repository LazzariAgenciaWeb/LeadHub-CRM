import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

function generateToken() {
  return randomBytes(24).toString("hex"); // 48 chars hex
}

// POST /api/companies/[id]/webhook-token — gera ou regenera o token
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  // Só SUPER_ADMIN ou ADMIN da própria empresa pode gerar token
  if (userRole !== "SUPER_ADMIN" && userCompanyId !== id) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const token = generateToken();

  const company = await prisma.company.update({
    where: { id },
    data: { webhookToken: token },
    select: { id: true, webhookToken: true },
  });

  return NextResponse.json({ webhookToken: company.webhookToken });
}

// DELETE /api/companies/[id]/webhook-token — revoga o token
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  if (userRole !== "SUPER_ADMIN" && userCompanyId !== id) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  await prisma.company.update({
    where: { id },
    data: { webhookToken: null },
  });

  return NextResponse.json({ ok: true });
}
