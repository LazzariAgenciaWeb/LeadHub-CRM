import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, addCommentToClickupTask } from "@/lib/clickup";

// GET /api/leads/[id]/comments
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const comments = await prisma.leadComment.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(comments);
}

// POST /api/leads/[id]/comments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const { body } = await req.json();

  if (!body?.trim()) {
    return NextResponse.json({ error: "Comentário não pode ser vazio" }, { status: 400 });
  }

  const authorName = session.user?.name ?? "Usuário";

  const comment = await prisma.leadComment.create({
    data: { leadId: id, body: body.trim(), authorName },
  });

  // ── ClickUp comment sync (Oportunidades) ─────────────────────────────────
  // Sincroniza o comentário para a task do ClickUp se a oportunidade já foi
  // vinculada. Guarda o ID do comentário ClickUp em externalId para dedup:
  // quando o webhook do ClickUp devolver esse mesmo comentário, o sistema
  // ignora (evita loop infinito).
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { clickupTaskId: true, companyId: true, pipeline: true },
  });

  console.log(`[Comment] leadId=${id} pipeline=${lead?.pipeline} clickupTaskId=${lead?.clickupTaskId ?? "null"}`);
  if (lead?.clickupTaskId && lead.pipeline === "OPORTUNIDADES") {
    const clickupSettings = await getClickupSettings(lead.companyId);
    console.log(`[Comment→CU] settings=${clickupSettings ? "ok" : "null"} taskId=${lead.clickupTaskId}`);
    if (clickupSettings) {
      const clickupCommentId = await addCommentToClickupTask({
        apiToken: clickupSettings.apiToken,
        taskId: lead.clickupTaskId,
        comment: `💬 ${authorName}\n\n${body.trim()}`,
      });
      console.log(`[Comment→CU] commentId=${clickupCommentId ?? "null (falhou)"}`);
      if (clickupCommentId) {
        await prisma.leadComment.update({
          where: { id: comment.id },
          data: { externalId: clickupCommentId },
        }).catch(() => {});
      }
    }
  } else {
    console.log(`[Comment] Não sincronizou: pipeline=${lead?.pipeline} taskId=${lead?.clickupTaskId ?? "ausente"}`);
  }

  return NextResponse.json(comment, { status: 201 });
}
