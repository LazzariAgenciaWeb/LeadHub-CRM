import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readComments, sanitizeComments, type TaskComment } from "@/lib/checklist";
import { Prisma } from "@/generated/prisma";
import { getClickupSettings, addCommentToClickupTask, markClickupTaskDone } from "@/lib/clickup";
import { resolveGroupInstanceId, pieceFileIds } from "@/lib/approval";
import { deliverScheduledMessage } from "@/lib/scheduled-send";
import { sendAdjustments, adjustmentLine, authorsOf, ADJ_SELECT } from "@/lib/approval-adjustments";

// POST /api/aprovar/[token]
// Body: { action: "approve" | "send" | "adjust", name: string, text?: string, force?: boolean,
//         notes?: { [fileId]: string } }
//
// Ação do CLIENTE no link de aprovação — sem login: o token vale só pra esta
// tarefa e só enquanto ela está em aprovação. Quem respondeu fica registrado
// pelo nome digitado. O resultado também vai pro grupo do cliente.
//
//   approve — aprova a peça. Com ajuste anotado na rodada, pede confirmação
//             (409 HAS_ADJUSTMENTS); com force, aprova e leva os anotados
//             como observação.
//   send    — envia pra equipe os ajustes anotados (lib/approval-adjustments).
//   adjust  — formato antigo (texto + recado por arquivo numa vez só): vira
//             ajustes anotados e é enviado na hora. Fica por página aberta antes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const action = ["approve", "send", "adjust"].includes(body?.action) ? (body.action as "approve" | "send" | "adjust") : null;
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const text = String(body?.text ?? "").trim().slice(0, 2000);

  if (!action) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "Informe seu nome." }, { status: 400 });

  const task = await prisma.projectTask.findUnique({
    where: { approvalToken: token },
    select: {
      id: true, title: true, status: true, comments: true, clickupTaskId: true, projectId: true,
      approvalCommentAt: true, approvalRound: true, approvalFileIds: true, approvalLinks: true, approvalSentAt: true,
      project: { select: { approvalGroupJid: true, setor: { select: { companyId: true } } } },
    },
  });
  if (!task) return NextResponse.json({ error: "Link inválido" }, { status: 404 });

  if (action !== "approve") {
    const notesRaw = action === "adjust" && body?.notes && typeof body.notes === "object" ? body.notes as Record<string, unknown> : {};
    const extra = [
      ...(text ? [{ text }] : []),
      ...Object.entries(notesRaw).map(([fileId, v]) => ({ fileId, text: String(v ?? "") })),
    ];
    const r = await sendAdjustments({ taskId: task.id, sender: name, extra });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, status: r.status, count: r.count });
  }

  if (task.status !== "AGUARDANDO_CLIENTE") {
    return NextResponse.json(
      { error: task.status === "APROVADO" ? "Esta peça já foi aprovada." : "Esta peça já voltou pra equipe ajustar." },
      { status: 409 },
    );
  }

  // Alguém anotou ajuste e outra pessoa quer aprovar: pergunta antes.
  const open = await prisma.projectTaskAdjustment.findMany({
    where:   { taskId: task.id, round: task.approvalRound, sentAt: null },
    orderBy: { createdAt: "asc" },
    select:  ADJ_SELECT,
  });
  if (open.length && body?.force !== true) {
    return NextResponse.json(
      { error: "Tem ajuste anotado nesta peça.", code: "HAS_ADJUSTMENTS", count: open.length, authors: authorsOf(open) },
      { status: 409 },
    );
  }

  // Aprovada: todos os arquivos da peça viram "aprovada".
  const inPiece = new Set(await pieceFileIds(task));
  const updated = readComments(task.comments).map((c) =>
    c.by !== "client" && c.attachments?.some((a) => inPiece.has(a.id))
      ? { ...c, attachments: c.attachments.map((a) => (inPiece.has(a.id) ? { ...a, status: "aprovada" as const } : a)) }
      : c,
  );

  // Aprovou mesmo com ajuste anotado: os anotados vão como observação.
  const obs = open.length ? `\nObservações anotadas:\n${open.map((a) => adjustmentLine(a)).join("\n")}` : "";
  const clientText = `✓ Aprovado por ${name}${text ? `\n${text}` : ""}${obs}`;
  const clientComment: TaskComment = { text: clientText.slice(0, 2000), at: new Date().toISOString(), by: "client" };

  // ClickUp (best-effort): comentário do cliente + conclusão.
  if (task.clickupTaskId) {
    try {
      const settings = await getClickupSettings(task.project.setor.companyId);
      if (settings?.apiToken) {
        const cid = await addCommentToClickupTask({ apiToken: settings.apiToken, taskId: task.clickupTaskId, comment: `[Cliente] ${clientText}` });
        if (cid) clientComment.cid = cid;
        await markClickupTaskDone(settings.apiToken, task.clickupTaskId, settings.statusChamadoConcluido);
      }
    } catch { /* silencioso */ }
  }

  const now = new Date();
  // Claim pelo status: dois cliques (ou duas pessoas) não gravam duas vezes.
  const r = await prisma.projectTask.updateMany({
    where: { id: task.id, status: "AGUARDANDO_CLIENTE" },
    data: {
      status:         "APROVADO",
      awaitingClient: false,
      done:           true,
      completedAt:    now,
      approvedAt:     now,
      approvedByName: name,
      // A rodada fecha: o que o cliente aprovou vira a lista da versão.
      approvalFileIds: [...inPiece],
      comments:       sanitizeComments([...updated, clientComment]) ?? Prisma.DbNull,
    },
  });
  if (!r.count) return NextResponse.json({ error: "Esta peça acabou de ser respondida." }, { status: 409 });

  if (open.length) {
    await prisma.projectTaskAdjustment.updateMany({
      where: { id: { in: open.map((a) => a.id) }, sentAt: null },
      data:  { sentAt: now },
    });
  }

  await prisma.projectTaskEvent.createMany({
    data: [
      { taskId: task.id, projectId: task.projectId, type: "STATUS", fromText: "AGUARDANDO_CLIENTE", toText: "APROVADO", authorName: name, byClient: true },
      { taskId: task.id, projectId: task.projectId, type: "COMMENT", toText: clientText.slice(0, 500), authorName: name, byClient: true },
    ],
  }).catch(() => {});

  // Devolutiva no grupo: o cliente vê que chegou e a equipe recebe na caixa.
  const groupJid = task.project.approvalGroupJid;
  if (groupJid) {
    try {
      const agencyId = task.project.setor.companyId;
      const instanceId = await resolveGroupInstanceId(agencyId, groupJid);
      if (instanceId) {
        const msg = await prisma.scheduledMessage.create({
          data: {
            companyId: agencyId,
            instanceId,
            phone:  groupJid,
            body:   `✅ *${task.title}* aprovada por ${name}. Obrigado!${open.length ? `\n_Com ${open.length} observação(ões) anotada(s) — a equipe vai ver._` : ""}`,
            sendAt: now,
            kind:   "approval_result",
            meta:   { taskId: task.id, projectId: task.projectId, action: "approve" },
          },
        });
        await deliverScheduledMessage(msg.id);
      }
    } catch (e) {
      console.error("[aprovar] devolutiva no grupo falhou:", e);
    }
  }

  return NextResponse.json({ ok: true, status: "APROVADO" });
}
