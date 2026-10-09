import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readComments, sanitizeComments, type TaskComment } from "@/lib/checklist";
import { Prisma } from "@/generated/prisma";
import { getClickupSettings, addCommentToClickupTask, markClickupTaskDone } from "@/lib/clickup";
import { resolveGroupInstanceId, pieceFileIds } from "@/lib/approval";
import { deliverScheduledMessage } from "@/lib/scheduled-send";

// POST /api/aprovar/[token]
// Body: { action: "approve" | "adjust", name: string, text?: string, notes?: { [fileId]: string } }
//
// Ação do CLIENTE no link de aprovação — sem login: o token vale só pra esta
// tarefa e só enquanto ela está em aprovação. Quem aprovou fica registrado
// pelo nome digitado. O resultado também vai pro grupo do cliente: confirma
// pra ele e avisa a equipe pela própria caixa do WhatsApp.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action === "approve" ? "approve" : body?.action === "adjust" ? "adjust" : null;
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const text = String(body?.text ?? "").trim().slice(0, 2000);
  const notesRaw = body?.notes && typeof body.notes === "object" ? body.notes as Record<string, unknown> : {};

  if (!action) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "Informe seu nome." }, { status: 400 });

  const task = await prisma.projectTask.findUnique({
    where: { approvalToken: token },
    select: {
      id: true, title: true, status: true, comments: true, clickupTaskId: true, projectId: true,
      approvalCommentAt: true, approvalRound: true, approvalFileIds: true,
      project: { select: { approvalGroupJid: true, setor: { select: { companyId: true } } } },
    },
  });
  if (!task) return NextResponse.json({ error: "Link inválido" }, { status: 404 });
  if (task.status !== "AGUARDANDO_CLIENTE") {
    return NextResponse.json(
      { error: task.status === "APROVADO" ? "Esta peça já foi aprovada." : "Esta peça já voltou pra equipe ajustar." },
      { status: 409 },
    );
  }

  // Observações por arquivo (só no ajuste) — limitadas aos anexos da versão.
  const notes = new Map<string, string>();
  for (const [k, v] of Object.entries(notesRaw)) {
    const n = String(v ?? "").trim().slice(0, 500);
    if (n) notes.set(k, n);
  }
  if (action === "adjust" && !text && notes.size === 0) {
    return NextResponse.json({ error: "Conte o que precisa ajustar." }, { status: 400 });
  }

  // Peça = mesma lista que a página mostrou (ordem do carrossel). Status e
  // observação vão em cada anexo dela, em qualquer andamento.
  const piece = await pieceFileIds(task);
  const inPiece = new Set(piece);
  // Ajuste com recado em imagens específicas: só ELAS vão pra alteração; as
  // outras o cliente viu no carrossel e não apontou nada → aprovadas. Sem
  // recado por imagem (só texto geral), não dá pra saber qual → todas.
  const porImagem = [...notes.keys()].some((k) => inPiece.has(k));
  const statusDe = (fid: string) =>
    action === "approve" ? ("aprovada" as const)
    : !porImagem || notes.has(fid) ? ("alteracao" as const)
    : ("aprovada" as const);
  const existing = readComments(task.comments);
  const updated = existing.map((c) =>
    c.by !== "client" && c.attachments?.some((a) => inPiece.has(a.id))
      ? {
          ...c,
          attachments: c.attachments.map((a) =>
            inPiece.has(a.id)
              ? {
                  ...a,
                  status: statusDe(a.id),
                  ...(notes.has(a.id) ? { note: notes.get(a.id)! } : {}),
                }
              : a,
          ),
        }
      : c,
  );

  // Comentário do cliente — o que a equipe lê no andamento.
  // "Arquivo N" = posição no carrossel que o cliente viu.
  const fileNames = new Map(piece.map((id, i) => [id, `Arquivo ${i + 1}`]));
  const notesText = [...notes].map(([fid, n]) => `• ${fileNames.get(fid) ?? "Arquivo"}: ${n}`).join("\n");
  const clientText =
    action === "approve"
      ? `✓ Aprovado por ${name}${text ? `\n${text}` : ""}`
      : `✎ Ajuste pedido por ${name}${text ? `\n${text}` : ""}${notesText ? `\n${notesText}` : ""}`;
  const clientComment: TaskComment = { text: clientText.slice(0, 2000), at: new Date().toISOString(), by: "client" };

  // ClickUp (best-effort): comentário do cliente + conclusão quando aprova.
  if (task.clickupTaskId) {
    try {
      const settings = await getClickupSettings(task.project.setor.companyId);
      if (settings?.apiToken) {
        const cid = await addCommentToClickupTask({ apiToken: settings.apiToken, taskId: task.clickupTaskId, comment: `[Cliente] ${clientText}` });
        if (cid) clientComment.cid = cid;
        if (action === "approve") await markClickupTaskDone(settings.apiToken, task.clickupTaskId, settings.statusChamadoConcluido);
      }
    } catch { /* silencioso */ }
  }

  const now = new Date();
  const nextStatus = action === "approve" ? "APROVADO" : "EM_PRODUCAO";
  // Claim pelo status: dois cliques (ou duas pessoas) não gravam duas vezes.
  const r = await prisma.projectTask.updateMany({
    where: { id: task.id, status: "AGUARDANDO_CLIENTE" },
    data: {
      status:         nextStatus,
      awaitingClient: false,
      done:           action === "approve",
      completedAt:    action === "approve" ? now : null,
      approvedAt:     action === "approve" ? now : null,
      approvedByName: action === "approve" ? name : null,
      comments:       sanitizeComments([...updated, clientComment]) ?? Prisma.DbNull,
    },
  });
  if (!r.count) return NextResponse.json({ error: "Esta peça acabou de ser respondida." }, { status: 409 });

  await prisma.projectTaskEvent.createMany({
    data: [
      { taskId: task.id, projectId: task.projectId, type: "STATUS", fromText: "AGUARDANDO_CLIENTE", toText: nextStatus, authorName: name, byClient: true },
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
            body:   action === "approve"
              ? `✅ *${task.title}* aprovada por ${name}. Obrigado!`
              : `✏️ Recebemos o pedido de ajuste de ${name} em *${task.title}*. A equipe já vai cuidar e manda a nova versão por aqui.`,
            sendAt: now,
            kind:   "approval_result",
            meta:   { taskId: task.id, projectId: task.projectId, action },
          },
        });
        await deliverScheduledMessage(msg.id);
      }
    } catch (e) {
      console.error("[aprovar] devolutiva no grupo falhou:", e);
    }
  }

  return NextResponse.json({ ok: true, status: nextStatus });
}
