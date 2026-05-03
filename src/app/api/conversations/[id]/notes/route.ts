import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { ActivityType } from "@/generated/prisma";
import { addScore } from "@/lib/gamification";
import { assertModule } from "@/lib/billing";

// POST /api/conversations/[id]/notes
// Body: { body: string }
// Cria nota interna na conversa + Activity NOTE_ADDED para a timeline.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const userId   = (session.user as any)?.id as string;
  const userName = (session.user as any)?.name as string;
  const userRole = (session.user as any)?.role;
  const userCompanyId = (session.user as any)?.companyId;

  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, companyId: true },
  });
  if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  if (userRole !== "SUPER_ADMIN" && conv.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { body } = await req.json();
  if (!body || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "body obrigatório" }, { status: 400 });
  }

  const note = await prisma.conversationNote.create({
    data: {
      conversationId: conv.id,
      body: body.trim(),
      authorId: userId,
      authorName: userName ?? "Usuário",
    },
  });

  await prisma.activity.create({
    data: {
      type: ActivityType.NOTE_ADDED,
      body: note.body,
      authorId: userId,
      authorName: userName ?? "Usuário",
      conversationId: conv.id,
      companyId: conv.companyId,
    },
  }).catch(() => { /* não crítico */ });

  void addScore(userId, conv.companyId, "NOTA_REGISTRADA", conv.id).catch(() => {});

  return NextResponse.json(note, { status: 201 });
}
