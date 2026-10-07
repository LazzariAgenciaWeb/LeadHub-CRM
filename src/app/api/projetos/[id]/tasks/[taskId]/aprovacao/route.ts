import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { readComments, sanitizeComments } from "@/lib/checklist";
import { Prisma } from "@/generated/prisma";
import {
  newApprovalToken, approvalUrl, latestVersionComment, resolveGroupInstanceId, sendMessageText,
  collectApprovalFiles, readFileIds,
} from "@/lib/approval";
import { deliverScheduledMessage } from "@/lib/scheduled-send";

// POST /api/projetos/[id]/tasks/[taskId]/aprovacao
// Body: { send?: boolean }  (default true)
//
// Abre uma rodada de aprovação: a versão é o andamento mais recente com anexo
// visível ao cliente. Com send=true manda o link no grupo de aprovação do
// projeto; com send=false só gera o link (pra copiar e mandar à mão).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, taskId } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const userId        = (session.user as any).id as string | undefined;
  const userName      = (session.user as any).name as string | undefined;

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    include: {
      project: {
        include: {
          setor:       { select: { companyId: true } },
          members:     { select: { userId: true } },
          accessUsers: { select: { userId: true } },
        },
      },
    },
  });
  if (!task || task.projectId !== id) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && task.project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const viewer = await getViewer(session);
  if (!canSeeProject(viewer, {
    visibility: task.project.visibility,
    setorId: task.project.setorId,
    memberIds: task.project.members.map((m) => m.userId),
    accessUserIds: task.project.accessUsers.map((a) => a.userId),
  })) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const send = body?.send !== false;
  const agencyId = task.project.setor.companyId;

  // Reenvio enquanto ainda espera o cliente = MESMA rodada (mantém o "visto",
  // só reinicia a contagem do lembrete e acrescenta arquivo que faltou).
  // Depois que o cliente respondeu, enviar de novo abre rodada nova, e os
  // arquivos soltos da rodada anterior ficam de fora.
  const sameRound = task.status === "AGUARDANDO_CLIENTE" && task.approvalRound > 0;
  const picked = await collectApprovalFiles(task, sameRound
    ? { since: task.approvalSentAt, keep: readFileIds(task.approvalFileIds) }
    : { since: task.approvalRound > 0 ? task.approvalSentAt : null });
  // No reenvio, o andamento da rodada continua sendo a versão mesmo sem ser "novo".
  const version = picked.version ?? (sameRound ? latestVersionComment(task.comments) : null);
  const fileIds = picked.ids;
  if (!fileIds.length) {
    return NextResponse.json(
      { error: "Anexe a peça na tarefa (em Arquivos ou num andamento) antes de enviar pra aprovação." },
      { status: 400 },
    );
  }

  let instanceId: string | null = null;
  if (send) {
    if (!task.project.approvalGroupJid) {
      return NextResponse.json(
        { error: "Escolha o grupo do cliente no quadro “Aprovação pelo WhatsApp” do projeto." },
        { status: 400 },
      );
    }
    instanceId = await resolveGroupInstanceId(agencyId, task.project.approvalGroupJid);
    if (!instanceId) {
      return NextResponse.json({ error: "Nenhuma instância de WhatsApp disponível pra falar no grupo." }, { status: 400 });
    }
  }

  // Anexos da versão passam a "aguardando" — o mesmo status que a equipe já
  // usava à mão, então o feed da tarefa mostra a peça em aprovação.
  const inPiece = new Set(fileIds);
  const comments = readComments(task.comments).map((c) =>
    c.by !== "client" && c.attachments?.some((a) => inPiece.has(a.id))
      ? { ...c, attachments: c.attachments.map((a) => (inPiece.has(a.id) ? { ...a, status: "aguardando" as const } : a)) }
      : c,
  );

  const token = task.approvalToken ?? newApprovalToken();
  const round = sameRound ? task.approvalRound : task.approvalRound + 1;
  const now   = new Date();

  await prisma.projectTask.update({
    where: { id: taskId },
    data: {
      approvalToken:      token,
      approvalRound:      round,
      approvalCommentAt:  version?.at ?? null,
      approvalFileIds:    fileIds,
      ...(sameRound
        ? { approvalNudgedAt: now }
        : {
            approvalSentAt: now, approvalViewedAt: null, approvalNudgedAt: null, approvalNudgeCount: 0,
            approvalLastViewAt: null, approvalViewCount: 0, approvalSlidesSeen: 0, approvalSlidesTotal: 0,
          }),
      approvedAt:         null,
      approvedByName:     null,
      status:             "AGUARDANDO_CLIENTE",
      awaitingClient:     true,
      done:               false,
      completedAt:        null,
      visibleToClient:    true,
      comments:           sanitizeComments(comments) ?? Prisma.DbNull,
    },
  });

  await prisma.projectTaskEvent.createMany({
    data: [
      ...(task.status !== "AGUARDANDO_CLIENTE"
        ? [{ taskId, projectId: id, type: "STATUS", fromText: task.status, toText: "AGUARDANDO_CLIENTE", authorId: userId ?? null, authorName: userName ?? null }]
        : []),
      { taskId, projectId: id, type: "APPROVAL_SENT", toText: `Rodada ${round}${sameRound ? " · reenviada" : ""}${send ? " · no grupo" : " · link gerado"}`, authorId: userId ?? null, authorName: userName ?? null },
    ],
  }).catch(() => {});

  let delivery: "sent" | "failed" | "skipped" | null = null;
  if (send && instanceId) {
    const msg = await prisma.scheduledMessage.create({
      data: {
        companyId: agencyId,
        instanceId,
        phone:  task.project.approvalGroupJid!,
        body:   sendMessageText({ title: task.title, round, token }),
        sendAt: now,
        kind:   "approval",
        meta:   { taskId, projectId: id, round, userId: userId ?? null },
      },
    });
    delivery = await deliverScheduledMessage(msg.id);
  }

  return NextResponse.json({
    ok: true,
    url: approvalUrl(token),
    round,
    delivery,
    ...(delivery === "failed" ? { warning: "O link foi gerado, mas o WhatsApp não enviou. Copie e mande à mão." } : {}),
  });
}
