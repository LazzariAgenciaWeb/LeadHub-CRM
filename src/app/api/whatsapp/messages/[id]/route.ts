import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { evolutionDeleteMessage } from "@/lib/evolution";

// DELETE /api/whatsapp/messages/[id]
// "Apagar para todos" — mesmo efeito do WhatsApp: a mensagem sai do aparelho
// de quem recebeu. No GoHub o REGISTRO PERMANECE (deletedAt preenchido, corpo
// intacto), igual ao que já fazemos quando o cliente apaga: histórico de
// atendimento não se perde por um clique.
//
// Só mensagem NOSSA (OUTBOUND) e enviada pela instância — o WhatsApp não
// permite revogar mensagem de terceiro, nem mensagem que saiu do celular de
// alguém da equipe (aquele número não é a instância).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const userId        = (session.user as any).id as string | undefined;

  const { id } = await params;

  const msg = await prisma.message.findUnique({
    where: { id },
    select: {
      externalId: true, phone: true, direction: true, participantPhone: true,
      companyId: true, deletedAt: true, instanceId: true,
      instance: { select: { id: true, instanceName: true, instanceToken: true, company: { select: { modoAtendimento: true } } } },
      conversation: { select: { instanceId: true, syncBlocked: true } },
    },
  });
  if (!msg) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && msg.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  // Visibilidade (instância privada / conversa bloqueada)
  if (msg.conversation) {
    const { canUserSeeConversation } = await import("@/lib/whatsapp-visibility");
    if (!(await canUserSeeConversation(session, msg.conversation))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    }
  }
  // Modo Visão: empresa não interage pelo painel (mesma regra do envio/reação)
  if (userRole !== "SUPER_ADMIN" && msg.instance?.company?.modoAtendimento === "VISAO") {
    return NextResponse.json({ error: "Empresa em modo Visão (somente leitura)." }, { status: 403 });
  }

  if (msg.direction !== "OUTBOUND") {
    return NextResponse.json(
      { error: "O WhatsApp só permite apagar para todos as mensagens que nós enviamos." },
      { status: 400 },
    );
  }
  if (!msg.externalId || !msg.instance) {
    return NextResponse.json(
      { error: "Mensagem sem vínculo com o WhatsApp (não dá pra apagar lá)." },
      { status: 400 },
    );
  }
  if (msg.deletedAt) {
    return NextResponse.json({ ok: true, deletedAt: msg.deletedAt.toISOString(), already: true });
  }

  const remoteJid = msg.phone.includes("@")
    ? msg.phone
    : `${msg.phone.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    await evolutionDeleteMessage(
      msg.instance.instanceName,
      {
        remoteJid,
        fromMe: true,
        id: msg.externalId,
        participant: msg.participantPhone ?? undefined,
      },
      msg.instance.instanceToken,
    );
  } catch (err: any) {
    const raw = String(err?.message ?? "");
    const friendly = /connection closed/i.test(raw)
      ? "A conexão do WhatsApp caiu no momento — tente de novo em alguns segundos."
      : /404|not found|not exist/i.test(raw)
      ? "O WhatsApp não encontrou mais essa mensagem — provavelmente passou do prazo de apagar para todos."
      : raw;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }

  // Registro permanece: só marca como apagada (o eco do webhook marcaria o
  // mesmo campo; fazer aqui deixa a UI consistente na hora).
  const deletedAt = new Date();
  await prisma.message.update({
    where: { id },
    data: { deletedAt },
  }).catch(() => {});

  console.log(`[WA delete] msg ${id} apagada para todos por user ${userId ?? "?"} (instância ${msg.instance.instanceName})`);

  return NextResponse.json({ ok: true, deletedAt: deletedAt.toISOString() });
}
