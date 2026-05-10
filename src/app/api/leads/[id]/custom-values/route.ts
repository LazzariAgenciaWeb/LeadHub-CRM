import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/leads/[id]/custom-values  → todos os valores do lead
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const lead = await prisma.lead.findUnique({ where: { id }, select: { companyId: true } });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const values = await prisma.leadCustomValue.findMany({
    where: { leadId: id },
    include: { field: true },
  });
  return NextResponse.json(values);
}

// PUT /api/leads/[id]/custom-values { fieldId, value }
// Upsert: se valor é "" ou null, deleta. Senão salva.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const { fieldId, value } = await req.json();

  if (!fieldId) return NextResponse.json({ error: "fieldId obrigatório" }, { status: 400 });

  const [lead, field] = await Promise.all([
    prisma.lead.findUnique({ where: { id }, select: { companyId: true } }),
    prisma.customFieldDef.findUnique({ where: { id: fieldId } }),
  ]);
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  if (!field) return NextResponse.json({ error: "Campo não encontrado" }, { status: 404 });

  if (lead.companyId !== field.companyId) {
    return NextResponse.json({ error: "Lead e campo de empresas diferentes" }, { status: 400 });
  }
  if (role !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const trimmed = value == null ? "" : String(value).trim();

  // Vazio → remove o valor (não salva string vazia ocupando linha)
  if (!trimmed) {
    await prisma.leadCustomValue
      .delete({ where: { leadId_fieldId: { leadId: id, fieldId } } })
      .catch(() => null);
    return NextResponse.json({ ok: true, value: null });
  }

  // Validação básica por tipo
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

  const saved = await prisma.leadCustomValue.upsert({
    where: { leadId_fieldId: { leadId: id, fieldId } },
    create: { leadId: id, fieldId, value: trimmed },
    update: { value: trimmed },
  });
  return NextResponse.json(saved);
}
