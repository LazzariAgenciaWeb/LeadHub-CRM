import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const { phone, companyId, leadId } = await req.json();
  if (!phone || !companyId || !leadId) {
    return NextResponse.json({ error: "phone, companyId e leadId são obrigatórios" }, { status: 400 });
  }

  // O companyId vem do corpo — sem este gate, qualquer usuário logado ligava
  // mensagens a lead de OUTRA empresa só trocando o id.
  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  if (role !== "SUPER_ADMIN" && companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Verify the lead exists and belongs to this company
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
  });
  if (!lead) {
    return NextResponse.json({ error: "Prospect não encontrado" }, { status: 404 });
  }

  // Link all messages from this phone/company to the prospect
  const updated = await prisma.message.updateMany({
    where: { phone, companyId },
    data: { leadId },
  });

  // Lead sem telefone herda o da conversa vinculada. (Antes havia um
  // `if (!lead.phone) {} else if (!lead.phone) {...}` — o segundo ramo nunca
  // rodava, então o telefone jamais era gravado.)
  if (!lead.phone?.trim()) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { phone },
    });
  }

  return NextResponse.json({ linked: updated.count });
}
