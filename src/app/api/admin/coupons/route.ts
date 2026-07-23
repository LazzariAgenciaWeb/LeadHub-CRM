import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * CRUD de cupons — só SUPER_ADMIN.
 * GET lista todos, POST cria novo.
 */

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as any)?.role === "SUPER_ADMIN" ? session : null;
}

// GET /api/admin/coupons
export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Apenas super admin" }, { status: 403 });

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { redemptions: true } } },
  });
  return NextResponse.json({ coupons });
}

// POST /api/admin/coupons
export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Apenas super admin" }, { status: 403 });

  const body = await req.json();
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "code obrigatório" }, { status: 400 });
  if (!["PERCENT", "FIXED"].includes(body.discountType)) {
    return NextResponse.json({ error: "discountType inválido" }, { status: 400 });
  }
  const discountValue = parseFloat(body.discountValue);
  if (isNaN(discountValue) || discountValue <= 0) {
    return NextResponse.json({ error: "discountValue inválido" }, { status: 400 });
  }
  if (body.discountType === "PERCENT" && discountValue > 100) {
    return NextResponse.json({ error: "Percentual não pode passar de 100" }, { status: 400 });
  }

  // Código único
  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) return NextResponse.json({ error: "Já existe cupom com esse código" }, { status: 409 });

  const coupon = await prisma.coupon.create({
    data: {
      code,
      label: body.label || null,
      discountType: body.discountType,
      discountValue,
      recurring: !!body.recurring,
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      maxUses: body.maxUses ? parseInt(body.maxUses, 10) : null,
      appliesToPlans: Array.isArray(body.appliesToPlans) ? body.appliesToPlans : [],
      active: body.active !== false,
      createdById: (session.user as any).id ?? null,
    },
  });
  return NextResponse.json({ coupon }, { status: 201 });
}
