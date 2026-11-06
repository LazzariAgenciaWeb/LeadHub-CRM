import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { transcribeAudioMessage } from "@/lib/transcribe";

// POST /api/whatsapp/messages/[id]/transcribe
// Transcrição sob demanda (botão da conversa): cobre áudio antigo, áudio longo
// e tentativa que falhou. O texto é INTERNO — não volta pro WhatsApp.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { id } = await params;
  const msg = await prisma.message.findUnique({
    where: { id },
    select: {
      companyId: true, mediaType: true,
      conversation: { select: { instanceId: true, syncBlocked: true } },
    },
  });
  if (!msg) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && msg.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  if (msg.conversation) {
    const { canUserSeeConversation } = await import("@/lib/whatsapp-visibility");
    if (!(await canUserSeeConversation(session, msg.conversation))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    }
  }

  const result = await transcribeAudioMessage(id, { force: true });
  if (!result.ok) return NextResponse.json({ error: result.error ?? "Falhou" }, { status: 502 });

  return NextResponse.json({ transcript: result.transcript ?? "" });
}
