import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as any)?.role === "SUPER_ADMIN" ? session : null;
}

// PATCH /api/admin/coupons/[id] — ativar/desativar, editar
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Apenas super admin" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if ("active" in body) data.active = !!body.active;
  if ("label" in body) data.label = body.label || null;
  if ("validUntil" in body) data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
  if ("maxUses" in body) data.maxUses = body.maxUses ? parseInt(body.maxUses, 10) : null;
  if ("recurring" in body) data.recurring = !!body.recurring;

  const coupon = await prisma.coupon.update({ where: { id }, data });
  return NextResponse.json({ coupon });
}

// DELETE /api/admin/coupons/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Apenas super admin" }, { status: 403 });
  const { id } = await params;

  await prisma.coupon.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
