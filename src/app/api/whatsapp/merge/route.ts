import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

/**
 * POST /api/whatsapp/merge
 *
 * Mescla dois contatos duplicados (mesmo contato com telefones diferentes,
 * ex: número real vs @lid do WhatsApp Business).
 *
 * Body: { keepPhone, mergePhone, companyId }
 * - keepPhone: telefone que permanece (lead/mensagens sobreviventes)
 * - mergePhone: telefone que será absorvido e removido
 *
 * O que acontece:
 * 1. Mensagens de mergePhone são reatribuídas a keepPhone (e ao lead de keepPhone, se existir)
 * 2. Lead de mergePhone (se existir e keepPhone não tiver lead) → telefone atualizado para keepPhone
 * 3. Lead de mergePhone (se existir E keepPhone já tiver lead) → deletado após transferir mensagens
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const body = await req.json();
  const { keepPhone, mergePhone, companyId } = body;

  if (!keepPhone || !mergePhone) {
    return NextResponse.json({ error: "keepPhone e mergePhone são obrigatórios" }, { status: 400 });
  }
  if (keepPhone === mergePhone) {
    return NextResponse.json({ error: "Os telefones são iguais" }, { status: 400 });
  }

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;
  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
  }

  // Buscar leads dos dois telefones
  const keepLead = await prisma.lead.findFirst({
    where: { phone: keepPhone, companyId: effectiveCompanyId },
    orderBy: { createdAt: "desc" },
  });
  const mergeLead = await prisma.lead.findFirst({
    where: { phone: mergePhone, companyId: effectiveCompanyId },
    orderBy: { createdAt: "desc" },
  });

  // Transferir mensagens de mergePhone → keepPhone
  await prisma.message.updateMany({
    where: { phone: mergePhone, companyId: effectiveCompanyId },
    data: {
      phone: keepPhone,
      // Se keepPhone já tem lead, vincula ao lead; caso contrário, remove vínculo de lead antigo
      leadId: keepLead?.id ?? null,
    },
  });

  if (mergeLead) {
    if (!keepLead) {
      // keepPhone não tem lead → atualiza o lead do mergePhone para usar keepPhone
      await prisma.lead.update({
        where: { id: mergeLead.id },
        data: { phone: keepPhone },
      });
      // Vincula as mensagens transferidas a este lead
      await prisma.message.updateMany({
        where: { phone: keepPhone, companyId: effectiveCompanyId, leadId: null },
        data: { leadId: mergeLead.id },
      });
    } else {
      // Ambos têm lead → transferir mensagens para o lead de keepPhone, deletar lead duplicado
      await prisma.message.updateMany({
        where: { leadId: mergeLead.id },
        data: { leadId: keepLead.id },
      });
      // Deletar lead duplicado (mergePhone)
      await prisma.lead.delete({ where: { id: mergeLead.id } });
    }
  }

  // Se o mergePhone (telefone absorvido) é @lid → salva alias inbound:
  //   @lid → keepPhone: redireciona webhooks futuros do @lid para a conversa principal.
  // Apenas quando o @lid é o que está sendo absorvido (mergePhone).
  // Quando o @lid é o keepPhone, as mensagens já ficam sob @lid, sem necessidade de alias.
  if (mergePhone.includes("@lid")) {
    await prisma.setting.upsert({
      where:  { key: `phone_alias:${effectiveCompanyId}:${mergePhone}` },
      create: { key: `phone_alias:${effectiveCompanyId}:${mergePhone}`, value: keepPhone },
      update: { value: keepPhone },
    });
  }

  return NextResponse.json({ success: true, keepPhone, mergePhone });
}
