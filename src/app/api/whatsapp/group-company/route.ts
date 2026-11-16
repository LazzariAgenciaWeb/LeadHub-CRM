import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { LinkError, linkConversationToClient } from "@/lib/conversation-client";

// PATCH /api/whatsapp/group-company
// Body: { groupJid, targetCompanyId }
// Liga o grupo ao cliente alvo (sub-empresa da agência)
export async function PATCH(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const { groupJid, targetCompanyId } = await req.json();
  if (!groupJid || !groupJid.includes("@g.us")) {
    return NextResponse.json({ error: "groupJid inválido" }, { status: 400 });
  }
  if (!targetCompanyId) {
    return NextResponse.json({ error: "targetCompanyId obrigatório" }, { status: 400 });
  }

  // Agência dona da carteira: a do usuário; super admin fora de impersonação
  // usa a mãe do cliente alvo. O alvo PRECISA ser cliente dessa agência —
  // antes este endpoint apagava o contato do grupo em qualquer empresa e
  // aceitava a própria agência como "cliente".
  const role = (session.user as any).role as string;
  const target = await prisma.company.findUnique({ where: { id: targetCompanyId }, select: { parentCompanyId: true } });
  const agencyId = role === "SUPER_ADMIN" ? target?.parentCompanyId : (session.user as any).companyId;
  if (!agencyId || target?.parentCompanyId !== agencyId) {
    return NextResponse.json({ error: "Escolha um cliente da carteira (não a própria empresa)" }, { status: 400 });
  }

  let contact;
  try {
    contact = await linkConversationToClient(agencyId, { phone: groupJid, isGroup: true }, targetCompanyId);
  } catch (e) {
    if (e instanceof LinkError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  return NextResponse.json({ ok: true, contact });
}
