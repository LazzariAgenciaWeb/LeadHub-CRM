import { prisma } from "./prisma";
import { readComments, sanitizeComments, type TaskComment } from "./checklist";
import { Prisma } from "@/generated/prisma";
import { getClickupSettings, addCommentToClickupTask } from "./clickup";
import { resolveGroupInstanceId, pieceFileIds, pieceLinks, linkItemId } from "./approval";
import { deliverScheduledMessage } from "./scheduled-send";
import { sendPushToUser } from "./push";

// Ajustes pedidos pelo cliente no link de aprovação (ProjectTaskAdjustment).
//
// Anotar ≠ enviar: cada pessoa anota quantos ajustes quiser, a peça continua
// "esperando o cliente", e só "Enviar ajustes pra equipe" (cliente) ou
// "Puxar ajustes" (equipe) fecha a rodada — uma mensagem no grupo e um
// comentário no ClickUp com a lista inteira. Depois disso, "Esqueci uma
// coisa" ainda entra na mesma rodada (late), até sair a versão nova.

export type AdjustmentView = {
  id: string; round: number; authorName: string; text: string;
  fileId: string | null; fileLabel: string | null;
  sentAt: string | null; late: boolean; doneAt: string | null; doneByName: string | null; createdAt: string;
};

type Row = {
  id: string; round: number; authorName: string; text: string; fileId: string | null; fileLabel: string | null;
  sentAt: Date | null; late: boolean; doneAt: Date | null; doneByName: string | null; createdAt: Date;
};

export const ADJ_SELECT = {
  id: true, round: true, authorName: true, text: true, fileId: true, fileLabel: true,
  sentAt: true, late: true, doneAt: true, doneByName: true, createdAt: true,
} as const;

export function adjustmentView(a: Row): AdjustmentView {
  return {
    id: a.id, round: a.round, authorName: a.authorName, text: a.text, fileId: a.fileId, fileLabel: a.fileLabel,
    sentAt: a.sentAt?.toISOString() ?? null, late: a.late,
    doneAt: a.doneAt?.toISOString() ?? null, doneByName: a.doneByName, createdAt: a.createdAt.toISOString(),
  };
}

// Limites contra abuso do link (é secreto, mas não tem login).
export const MAX_ADJ_TEXT = 1000;
export const MAX_OPEN_PER_ROUND = 50;

/** Itens do carrossel na ordem da página: arquivos e depois vídeos por link. */
export async function pieceOrder(task: Parameters<typeof pieceFileIds>[0] & { approvalLinks: unknown }): Promise<string[]> {
  const files = await pieceFileIds(task);
  const links = (await pieceLinks(task)).map((l) => linkItemId(l.url));
  return [...files, ...links];
}

export function fileLabelOf(order: string[], fileId: string | null | undefined): string | null {
  const i = fileId ? order.indexOf(fileId) : -1;
  return i >= 0 ? `Arquivo ${i + 1}` : null;
}

/** "• Arquivo 2: trocar a cor (Ana)" — uma linha por ajuste. */
export function adjustmentLine(a: { fileLabel: string | null; text: string; authorName: string }, withAuthor = true): string {
  return `• ${a.fileLabel ? `${a.fileLabel}: ` : ""}${a.text}${withAuthor ? ` (${a.authorName})` : ""}`;
}

export const authorsOf = (list: { authorName: string }[]) => [...new Set(list.map((a) => a.authorName))].join(", ");

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

type SendResult = { ok: true; count: number; status: string } | { ok: false; status: number; error: string };

/**
 * Fecha a rodada com os ajustes anotados: a peça volta pra produção, os
 * arquivos com ajuste viram "alteração" (os outros, aprovados), e equipe +
 * grupo recebem a lista numa mensagem só.
 *   sender  — quem tocou em enviar (cliente) ou puxou (equipe)
 *   byTeam  — a equipe puxou sem esperar o cliente
 *   extra   — ajustes que chegam junto com o envio (página antiga: texto livre)
 */
export async function sendAdjustments(args: {
  taskId: string;
  sender: string;
  byTeam?: { userId: string | null; name: string };
  extra?: { text: string; fileId?: string | null }[];
}): Promise<SendResult> {
  const { taskId, sender, byTeam } = args;
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, status: true, comments: true, clickupTaskId: true, projectId: true,
      approvalCommentAt: true, approvalRound: true, approvalFileIds: true, approvalLinks: true, approvalSentAt: true,
      project: { select: { approvalGroupJid: true, setor: { select: { companyId: true } } } },
    },
  });
  if (!task) return { ok: false, status: 404, error: "Link inválido" };
  if (task.status !== "AGUARDANDO_CLIENTE") {
    return {
      ok: false, status: 409,
      error: task.status === "APROVADO" ? "Esta peça já foi aprovada." : "Os ajustes desta peça já foram enviados pra equipe.",
    };
  }

  const order = await pieceOrder(task);
  for (const e of args.extra ?? []) {
    const text = e.text.trim().slice(0, MAX_ADJ_TEXT);
    if (!text) continue;
    await prisma.projectTaskAdjustment.create({
      data: {
        taskId, round: task.approvalRound, authorName: sender, text,
        fileId: e.fileId && order.includes(e.fileId) ? e.fileId : null,
        fileLabel: fileLabelOf(order, e.fileId),
      },
    });
  }

  const open = await prisma.projectTaskAdjustment.findMany({
    where:   { taskId, round: task.approvalRound, sentAt: null },
    orderBy: { createdAt: "asc" },
    select:  ADJ_SELECT,
  });
  if (!open.length) return { ok: false, status: 400, error: "Anote pelo menos um ajuste antes de enviar." };

  // Status por arquivo da peça: ajuste apontado em arquivos específicos → só
  // eles vão pra alteração (os outros o cliente viu e não apontou nada →
  // aprovados). Só ajuste geral → não dá pra saber qual, todos vão.
  const inPiece = new Set(await pieceFileIds(task));
  const inPieceAll = new Set(order);
  const notes = new Map<string, string[]>();
  for (const a of open) if (a.fileId && inPieceAll.has(a.fileId)) notes.set(a.fileId, [...(notes.get(a.fileId) ?? []), a.text]);
  const porArquivo = notes.size > 0;
  const updated = readComments(task.comments).map((c) =>
    c.by !== "client" && c.attachments?.some((x) => inPiece.has(x.id))
      ? {
          ...c,
          attachments: c.attachments.map((x) =>
            inPiece.has(x.id)
              ? {
                  ...x,
                  status: !porArquivo || notes.has(x.id) ? ("alteracao" as const) : ("aprovada" as const),
                  ...(notes.has(x.id) ? { note: notes.get(x.id)!.join(" · ").slice(0, 500) } : {}),
                }
              : x,
          ),
        }
      : c,
  );

  // Comentário do cliente na tarefa — "✎ Ajuste pedido por <autores>" é o
  // formato que a linha do tempo do link reconhece.
  const who = authorsOf(open);
  const clientText = `✎ Ajuste pedido por ${who}\n${open.map((a) => adjustmentLine(a, open.length > 1 && who.includes(","))).join("\n")}`.slice(0, 2000);
  const clientComment: TaskComment = { text: clientText, at: new Date().toISOString(), by: "client" };

  if (task.clickupTaskId) {
    try {
      const settings = await getClickupSettings(task.project.setor.companyId);
      if (settings?.apiToken) {
        const cid = await addCommentToClickupTask({ apiToken: settings.apiToken, taskId: task.clickupTaskId, comment: `[Cliente] ${clientText}` });
        if (cid) clientComment.cid = cid;
      }
    } catch { /* silencioso */ }
  }

  const now = new Date();
  // Claim pelo status: dois cliques (ou cliente + equipe) não enviam duas vezes.
  const r = await prisma.projectTask.updateMany({
    where: { id: taskId, status: "AGUARDANDO_CLIENTE" },
    data: {
      status: "EM_PRODUCAO", awaitingClient: false, done: false, completedAt: null,
      approvedAt: null, approvedByName: null,
      // A rodada fecha: o que o cliente viu (inclusive o que subiu depois do
      // envio) vira a lista da versão.
      approvalFileIds: [...inPiece],
      comments: sanitizeComments([...updated, clientComment]) ?? Prisma.DbNull,
    },
  });
  if (!r.count) return { ok: false, status: 409, error: "Os ajustes desta peça acabaram de ser enviados." };

  await prisma.projectTaskAdjustment.updateMany({
    where: { id: { in: open.map((a) => a.id) }, sentAt: null },
    data:  { sentAt: now },
  });

  await prisma.projectTaskEvent.createMany({
    data: [
      { taskId, projectId: task.projectId, type: "STATUS", fromText: "AGUARDANDO_CLIENTE", toText: "EM_PRODUCAO",
        authorId: byTeam?.userId ?? null, authorName: byTeam?.name ?? sender, byClient: !byTeam },
      { taskId, projectId: task.projectId, type: "COMMENT",
        toText: `${byTeam ? `${byTeam.name} puxou ` : `${sender} enviou `}${open.length} ${plural(open.length, "ajuste", "ajustes")}: ${open.map((a) => a.text).join(" · ")}`.slice(0, 500),
        authorId: byTeam?.userId ?? null, authorName: byTeam?.name ?? sender, byClient: !byTeam },
    ],
  }).catch(() => {});

  // Devolutiva no grupo: o cliente vê que chegou e a equipe recebe na caixa.
  const groupJid = task.project.approvalGroupJid;
  if (groupJid) {
    try {
      const agencyId = task.project.setor.companyId;
      const instanceId = await resolveGroupInstanceId(agencyId, groupJid);
      if (instanceId) {
        const lista = open.slice(0, 12).map((a) => adjustmentLine(a)).join("\n");
        const resto = open.length > 12 ? `\n…e mais ${open.length - 12}` : "";
        const msg = await prisma.scheduledMessage.create({
          data: {
            companyId: agencyId, instanceId, phone: groupJid, sendAt: now, kind: "approval_result",
            body: `✏️ Recebemos ${open.length} ${plural(open.length, "ajuste", "ajustes")} em *${task.title}*:\n${lista}${resto}\n\nA equipe já vai cuidar e manda a nova versão por aqui. Se lembrar de mais alguma coisa, é só abrir o mesmo link.`,
            meta: { taskId, projectId: task.projectId, action: "adjust", count: open.length },
          },
        });
        await deliverScheduledMessage(msg.id);
      }
    } catch (e) {
      console.error("[ajustes] devolutiva no grupo falhou:", e);
    }
  }

  return { ok: true, count: open.length, status: "EM_PRODUCAO" };
}

/**
 * "Esqueci uma coisa": ajuste que chega depois do envio, enquanto a equipe
 * ainda não mandou a versão nova. Entra na mesma rodada já como enviado, vira
 * comentário na tarefa (e no ClickUp) e avisa o responsável.
 */
export async function addLateAdjustment(task: {
  id: string; title: string; projectId: string; comments: unknown; clickupTaskId: string | null;
  approvalRound: number; assigneeId: string | null; companyId: string;
}, adj: { authorName: string; text: string; fileId: string | null; fileLabel: string | null; deviceKey: string | null }) {
  const now = new Date();
  const row = await prisma.projectTaskAdjustment.create({
    data: { taskId: task.id, round: task.approvalRound, ...adj, sentAt: now, late: true },
    select: ADJ_SELECT,
  });

  const clientText = `✎ Ajuste pedido por ${adj.authorName} (depois do envio)\n${adjustmentLine(row, false)}`.slice(0, 2000);
  const comment: TaskComment = { text: clientText, at: now.toISOString(), by: "client" };
  if (task.clickupTaskId) {
    try {
      const settings = await getClickupSettings(task.companyId);
      if (settings?.apiToken) {
        const cid = await addCommentToClickupTask({ apiToken: settings.apiToken, taskId: task.clickupTaskId, comment: `[Cliente] ${clientText}` });
        if (cid) comment.cid = cid;
      }
    } catch { /* silencioso */ }
  }
  await prisma.projectTask.update({
    where: { id: task.id },
    data:  { comments: sanitizeComments([...readComments(task.comments), comment]) ?? Prisma.DbNull },
  });
  await prisma.projectTaskEvent.create({
    data: {
      taskId: task.id, projectId: task.projectId, type: "COMMENT", byClient: true, authorName: adj.authorName,
      toText: `${adj.authorName} lembrou de mais um ajuste: ${adj.text}`.slice(0, 500),
    },
  }).catch(() => {});
  if (task.assigneeId) {
    void sendPushToUser(task.assigneeId, {
      title: `✎ Mais um ajuste em ${task.title}`,
      body:  `${adj.authorName}: ${adj.text}`.slice(0, 120),
      url:   `/projetos/${task.projectId}?tarefa=${task.id}`,
      tag:   `ajuste-${task.id}`,
    }, "newMessage").catch(() => {});
  }
  return row;
}
