import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// Valores dos campos personalizados aplicados a uma empresa específica.
// Espelha /api/leads/[id]/custom-values, mas pra Company.

async function authorize(targetCompanyId: string) {
  const session = await getEffectiveSession();
  if (!session) return { ok: false as const, status: 401, error: "Não autorizado" };

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const target = await prisma.company.findUnique({
    where: { id: targetCompanyId },
    select: { id: true, parentCompanyId: true },
  });
  if (!target) return { ok: false as const, status: 404, error: "Empresa não encontrada" };

  const ownerCompanyId = target.parentCompanyId ?? target.id;

  if (role !== "SUPER_ADMIN" && userCompanyId !== ownerCompanyId && userCompanyId !== target.id) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }
  return { ok: true as const, ownerCompanyId, targetCompanyId: target.id };
}

// GET /api/companies/[id]/custom-values
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const values = await prisma.companyCustomValue.findMany({
    where: { companyId: id },
    include: { field: true },
  });
  return NextResponse.json(values);
}

// PUT /api/companies/[id]/custom-values { fieldId, value }
// Upsert; vazio deleta.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { fieldId, value } = await req.json();
  if (!fieldId) return NextResponse.json({ error: "fieldId obrigatório" }, { status: 400 });

  const field = await prisma.companyCustomFieldDef.findUnique({ where: { id: fieldId } });
  if (!field) return NextResponse.json({ error: "Campo não encontrado" }, { status: 404 });

  // O def precisa pertencer ao owner da target (parent ou ela mesma).
  if (field.ownerCompanyId !== auth.ownerCompanyId) {
    return NextResponse.json({ error: "Campo de outro tenant" }, { status: 400 });
  }

  const trimmed = value == null ? "" : String(value).trim();
  if (!trimmed) {
    await prisma.companyCustomValue
      .delete({ where: { companyId_fieldId: { companyId: id, fieldId } } })
      .catch(() => null);
    return NextResponse.json({ ok: true, value: null });
  }

  if (field.type === "NUMBER" && Number.isNaN(Number(trimmed))) {
    return NextResponse.json({ error: "Valor numérico inválido" }, { status: 400 });
  }
  if (field.type === "DATE" && Number.isNaN(new Date(trimmed).getTime())) {
    return NextResponse.json({ error: "Data inválida" }, { status: 400 });
  }
  if (field.type === "SELECT") {
    const opts = Array.isArray(field.options) ? (field.options as string[]) : [];
    if (!opts.includes(trimmed)) {
      return NextResponse.json({ error: "Opção fora da lista permitida" }, { status: 400 });
    }
  }

  const saved = await prisma.companyCustomValue.upsert({
    where: { companyId_fieldId: { companyId: id, fieldId } },
    create: { companyId: id, fieldId, value: trimmed },
    update: { value: trimmed },
  });
  return NextResponse.json(saved);
}
