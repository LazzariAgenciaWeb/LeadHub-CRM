import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { ActivityType } from "@/generated/prisma";
import { addScore } from "@/lib/gamification";
import { assertModule } from "@/lib/billing";
import { formatBrazilDateTimeShort } from "@/lib/datetime";

// GET /api/conversations/[id]/notes
// Lista todas as notas internas da conversa, mais recentes primeiro.
// A UI usa pra renderizar bolhas amarelas na timeline mesmo quando a conversa
// não tem Lead associado (típico de grupos).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const userRole = (session.user as any)?.role;
  const userCompanyId = (session.user as any)?.companyId;

  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { companyId: true },
  });
  if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  if (userRole !== "SUPER_ADMIN" && conv.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const notes = await prisma.conversationNote.findMany({
    where:   { conversationId: id },
    orderBy: { createdAt: "desc" },
    select:  { id: true, body: true, authorId: true, authorName: true, createdAt: true },
  });

  return NextResponse.json(notes);
}

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

  const trimmed = body.trim();
  const author = userName ?? "Usuário";

  // ConversationNote + Activity + append em Lead.notes em uma transação:
  // se qualquer escrita falhar, nenhuma persiste — evita ficar com nota
  // visível na timeline mas ausente do legacy Lead.notes (ou vice-versa).
  const lead = await prisma.lead.findFirst({
    where: { conversationId: conv.id },
    select: { id: true, notes: true },
  }).catch(() => null);

  const stamp = formatBrazilDateTimeShort(new Date());
  const entry = `[${stamp}] ${trimmed} — ${author}`;
  const newNotes = lead ? (lead.notes ? `${entry}\n\n${lead.notes}` : entry) : null;

  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.conversationNote.create({
      data: {
        conversationId: conv.id,
        body: trimmed,
        authorId: userId,
        authorName: author,
      },
    });
    await tx.activity.create({
      data: {
        type: ActivityType.NOTE_ADDED,
        body: created.body,
        authorId: userId,
        authorName: author,
        conversationId: conv.id,
        companyId: conv.companyId,
      },
    });
    if (lead && newNotes !== null) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { notes: newNotes },
      });
    }
    return created;
  });

  void addScore(userId, conv.companyId, "NOTA_REGISTRADA", conv.id).catch(() => {});

  return NextResponse.json(note, { status: 201 });
}
