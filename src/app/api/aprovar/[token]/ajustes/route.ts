import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  pieceOrder, fileLabelOf, addLateAdjustment, adjustmentView, ADJ_SELECT, MAX_ADJ_TEXT, MAX_OPEN_PER_ROUND,
} from "@/lib/approval-adjustments";

// POST /api/aprovar/[token]/ajustes
// Body: { name, text, fileId?, deviceKey }
//
// Anota UM ajuste na peça (link sem login). Enquanto a peça espera o cliente,
// só anota — nada muda até alguém tocar em "Enviar ajustes pra equipe".
// Depois do envio, enquanto a equipe não manda a versão nova, é o "Esqueci
// uma coisa": entra na mesma rodada já enviado e avisa a equipe.
// deviceKey: chave aleatória do aparelho — só quem anotou edita/apaga.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const text = String(body?.text ?? "").trim().slice(0, MAX_ADJ_TEXT);
  const deviceKey = typeof body?.deviceKey === "string" ? body.deviceKey.slice(0, 64) : null;

  if (name.length < 2) return NextResponse.json({ error: "Escreva seu nome pra registrar quem pediu." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Escreva o que precisa mudar." }, { status: 400 });

  const task = await prisma.projectTask.findUnique({
    where: { approvalToken: token },
    select: {
      id: true, title: true, status: true, projectId: true, comments: true, clickupTaskId: true, assigneeId: true,
      approvalRound: true, approvalFileIds: true, approvalLinks: true, approvalSentAt: true,
      project: { select: { setor: { select: { companyId: true } } } },
    },
  });
  if (!task) return NextResponse.json({ error: "Link inválido" }, { status: 404 });
  if (task.status === "APROVADO") return NextResponse.json({ error: "Esta peça já foi aprovada." }, { status: 409 });
  if (task.approvalRound < 1) return NextResponse.json({ error: "Esta peça ainda não foi enviada pra aprovação." }, { status: 409 });

  const order = await pieceOrder(task);
  const fileId = typeof body?.fileId === "string" && order.includes(body.fileId) ? body.fileId : null;
  const fileLabel = fileLabelOf(order, fileId);

  if (task.status !== "AGUARDANDO_CLIENTE") {
    const row = await addLateAdjustment(
      { ...task, companyId: task.project.setor.companyId },
      { authorName: name, text, fileId, fileLabel, deviceKey },
    );
    return NextResponse.json({ ok: true, adjustment: adjustmentView(row) }, { status: 201 });
  }

  const open = await prisma.projectTaskAdjustment.count({ where: { taskId: task.id, round: task.approvalRound, sentAt: null } });
  if (open >= MAX_OPEN_PER_ROUND) {
    return NextResponse.json({ error: "Muitos ajustes anotados. Envie estes pra equipe antes de anotar mais." }, { status: 429 });
  }

  const row = await prisma.projectTaskAdjustment.create({
    data: { taskId: task.id, round: task.approvalRound, authorName: name, text, fileId, fileLabel, deviceKey },
    select: ADJ_SELECT,
  });
  return NextResponse.json({ ok: true, adjustment: adjustmentView(row) }, { status: 201 });
}
