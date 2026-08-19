import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionSendReaction } from "@/lib/evolution";

// POST /api/whatsapp/messages/[id]/react
// Body: { emoji: string } — "" (vazio) REMOVE a reação.
// Envia a reação pela instância da mensagem e atualiza Message.reactions
// localmente (chave "me:<instância>", igual ao eco do webhook — sem duplicar).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const emoji: string = typeof body.emoji === "string" ? body.emoji.slice(0, 8) : "";

  const msg = await prisma.message.findUnique({
    where: { id },
    select: {
      externalId: true, phone: true, direction: true, participantPhone: true,
      companyId: true, reactions: true, instanceId: true,
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
  if (!msg.externalId || !msg.instance) {
    return NextResponse.json({ error: "Mensagem sem vínculo com o WhatsApp (não dá pra reagir)" }, { status: 400 });
  }
  // Modo Visão: empresa não interage pelo painel (mesma regra do envio)
  if (userRole !== "SUPER_ADMIN" && msg.instance.company?.modoAtendimento === "VISAO") {
    return NextResponse.json({ error: "Empresa em modo Visão (somente leitura)." }, { status: 403 });
  }

  // Key da mensagem ALVO: remoteJid da conversa; fromMe se a mensagem é nossa.
  const remoteJid = msg.phone.includes("@")
    ? msg.phone
    : `${msg.phone.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    await evolutionSendReaction(
      msg.instance.instanceName,
      {
        remoteJid,
        fromMe: msg.direction === "OUTBOUND",
        id: msg.externalId,
        participant: msg.participantPhone ?? undefined,
      },
      emoji,
      msg.instance.instanceToken,
    );
  } catch (err: any) {
    const raw = String(err?.message ?? "");
    const friendly = /connection closed/i.test(raw)
      ? "A conexão do WhatsApp caiu no momento — tente de novo em alguns segundos."
      : raw;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }

  // Atualiza o mapa local — mesma chave que o eco fromMe do webhook usaria.
  const reactorKey = `me:${msg.instance.instanceName}`;
  const current: Record<string, any> = (msg.reactions as any) ?? {};
  if (emoji) {
    current[reactorKey] = { emoji, name: null, fromMe: true, at: new Date().toISOString() };
  } else {
    delete current[reactorKey];
  }
  await prisma.message.update({ where: { id }, data: { reactions: current } }).catch(() => {});

  return NextResponse.json({ ok: true, reactions: current });
}
