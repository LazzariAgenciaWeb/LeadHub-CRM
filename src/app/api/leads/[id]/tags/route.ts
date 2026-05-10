import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/leads/[id]/tags  → tags do lead
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

  const links = await prisma.leadTag.findMany({
    where: { leadId: id },
    include: { tag: true },
  });
  return NextResponse.json(links.map((l) => l.tag));
}

// POST /api/leads/[id]/tags { tagId } → anexa tag existente
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const { tagId } = await req.json();

  const [lead, tag] = await Promise.all([
    prisma.lead.findUnique({ where: { id }, select: { companyId: true } }),
    prisma.tag.findUnique({ where: { id: tagId }, select: { companyId: true } }),
  ]);
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  if (!tag) return NextResponse.json({ error: "Tag não encontrada" }, { status: 404 });

  // Lead e tag têm que ser da mesma empresa.
  if (lead.companyId !== tag.companyId) {
    return NextResponse.json({ error: "Lead e tag de empresas diferentes" }, { status: 400 });
  }
  if (role !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Idempotente: ignora se já existe.
  await prisma.leadTag.upsert({
    where: { leadId_tagId: { leadId: id, tagId } },
    update: {},
    create: { leadId: id, tagId },
  });

  const fullTag = await prisma.tag.findUnique({ where: { id: tagId } });
  return NextResponse.json(fullTag, { status: 201 });
}
