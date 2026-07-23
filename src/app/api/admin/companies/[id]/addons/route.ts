import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UNIT_ADDONS } from "@/lib/plans";
import type { AddonType } from "@/generated/prisma";

/**
 * Gerencia os add-ons quantitativos de uma empresa (atendente extra, WhatsApp
 * extra). Só SUPER_ADMIN. GET lista, PUT define a quantidade (0 remove).
 */

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as any)?.role === "SUPER_ADMIN" ? session : null;
}

const TYPE_TO_ADDON: Record<AddonType, keyof typeof UNIT_ADDONS> = {
  EXTRA_ATENDENTE: "atendenteExtra",
  EXTRA_WHATSAPP: "whatsappExtra",
};

// GET /api/admin/companies/[id]/addons
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Apenas super admin" }, { status: 403 });
  const { id: companyId } = await params;

  const addons = await prisma.subscriptionAddon.findMany({
    where: { companyId },
    select: { id: true, type: true, quantity: true, unitPrice: true },
  });

  return NextResponse.json({
    addons,
    catalog: {
      EXTRA_ATENDENTE: UNIT_ADDONS.atendenteExtra,
      EXTRA_WHATSAPP: UNIT_ADDONS.whatsappExtra,
    },
  });
}

// PUT /api/admin/companies/[id]/addons  body: { type, quantity }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Apenas super admin" }, { status: 403 });
  const { id: companyId } = await params;

  const body = await req.json();
  const type = body.type as AddonType;
  const quantity = Math.max(0, parseInt(body.quantity, 10) || 0);

  if (!["EXTRA_ATENDENTE", "EXTRA_WHATSAPP"].includes(type)) {
    return NextResponse.json({ error: "type inválido" }, { status: 400 });
  }

  const catalogItem = UNIT_ADDONS[TYPE_TO_ADDON[type]];

  if (quantity === 0) {
    // Remove o add-on
    await prisma.subscriptionAddon.deleteMany({ where: { companyId, type } });
    return NextResponse.json({ ok: true, removed: true });
  }

  const addon = await prisma.subscriptionAddon.upsert({
    where: { companyId_type: { companyId, type } },
    create: { companyId, type, quantity, unitPrice: catalogItem.priceMonthly },
    update: { quantity },
    select: { id: true, type: true, quantity: true, unitPrice: true },
  });

  return NextResponse.json({ addon });
}
