import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

/** Verifica acesso à empresa (mesmo padrão do PATCH individual). */
async function canAccessCompany(session: any, targetCompanyId: string): Promise<boolean> {
  const role        = (session?.user as any)?.role as string;
  const userCompany = (session?.user as any)?.companyId as string | undefined;
  if (role === "SUPER_ADMIN") return true;
  if (!userCompany) return false;
  if (userCompany === targetCompanyId) return true;
  const sub = await prisma.company.findFirst({
    where: { id: targetCompanyId, parentCompanyId: userCompany },
    select: { id: true },
  });
  return !!sub;
}

// POST /api/companies/[id]/contacts/bulk
//
// Operações em massa de contatos. Body:
//   { action: "transfer", contactIds: string[], targetCompanyId: string }
//   { action: "delete",   contactIds: string[] }
//
// "transfer" move os contatos pra outra empresa. Se já existir contato com
// o mesmo phone na destino, pula esse contato (skipped no resultado).
// "delete" remove os contatos.
//
// Retorna { moved/deleted, skipped: [{ id, reason }] } pra UI mostrar feedback.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session?.user as any)?.role as string;
  if (role === "CLIENT" && !can(session, "canCreateCompanies")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  if (!(await canAccessCompany(session, id))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action: string = body.action;
  const contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds : [];

  if (contactIds.length === 0) {
    return NextResponse.json({ error: "Nenhum contato selecionado" }, { status: 400 });
  }

  // Carrega só contatos que pertencem à empresa de origem (segurança)
  const contacts = await prisma.companyContact.findMany({
    where: { id: { in: contactIds }, companyId: id },
    select: { id: true, phone: true, name: true },
  });
  const validIds = contacts.map((c) => c.id);

  if (action === "delete") {
    const result = await prisma.companyContact.deleteMany({
      where: { id: { in: validIds }, companyId: id },
    });
    return NextResponse.json({ deleted: result.count });
  }

  if (action === "transfer") {
    const targetCompanyId: string = body.targetCompanyId;
    if (!targetCompanyId) {
      return NextResponse.json({ error: "Empresa destino obrigatória" }, { status: 400 });
    }
    if (!(await canAccessCompany(session, targetCompanyId))) {
      return NextResponse.json({ error: "Sem acesso à empresa destino" }, { status: 403 });
    }
    if (targetCompanyId === id) {
      return NextResponse.json({ error: "Empresa destino igual à origem" }, { status: 400 });
    }

    // Verifica se a empresa destino já tem contato com algum dos phones
    // (constraint UNIQUE(companyId, phone) — não dá pra duplicar).
    const phones = contacts.map((c) => c.phone);
    const existingInTarget = await prisma.companyContact.findMany({
      where: { companyId: targetCompanyId, phone: { in: phones } },
      select: { phone: true },
    });
    const conflictPhones = new Set(existingInTarget.map((c) => c.phone));

    const skipped: { id: string; name: string | null; phone: string; reason: string }[] = [];
    const toMove: string[] = [];
    for (const c of contacts) {
      if (conflictPhones.has(c.phone)) {
        skipped.push({ id: c.id, name: c.name, phone: c.phone, reason: "já existe na empresa destino" });
      } else {
        toMove.push(c.id);
      }
    }

    let moved = 0;
    if (toMove.length > 0) {
      const r = await prisma.companyContact.updateMany({
        where: { id: { in: toMove }, companyId: id },
        data: { companyId: targetCompanyId },
      });
      moved = r.count;
    }
    return NextResponse.json({ moved, skipped });
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
