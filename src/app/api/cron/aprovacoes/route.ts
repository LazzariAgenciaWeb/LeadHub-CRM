import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inReminderWindow, reminderText, resolveGroupInstanceId, type PendingItem } from "@/lib/approval";
import { deliverScheduledMessage } from "@/lib/scheduled-send";
import { sendPushToUser } from "@/lib/push";

/**
 * GET/POST /api/cron/aprovacoes
 *
 * Lembra no grupo do cliente as peças em aprovação há mais de N dias
 * (approvalReminderDays do projeto), contando do envio ou do último lembrete.
 * Uma mensagem por grupo, juntando todas as peças vencidas, e o texto muda se
 * o cliente nem abriu o link ou se abriu e não respondeu. Depois de
 * approvalMaxReminders lembretes, para de insistir e avisa o responsável.
 *
 * Só dispara em dia útil, 9h–18h (Brasília). Roda a cada 15 min (start.sh).
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !inReminderWindow(now)) {
    return NextResponse.json({ ok: true, skipped: "fora do horário" });
  }

  const tasks = await prisma.projectTask.findMany({
    where: {
      status: "AGUARDANDO_CLIENTE",
      approvalToken: { not: null },
      approvalSentAt: { not: null },
      ignoredAt: null,
      project: {
        approvalGroupJid: { not: null },
        status: { notIn: ["ENTREGUE", "CANCELADO", "PAUSADO"] },
      },
    },
    select: {
      id: true, title: true, projectId: true, assigneeId: true, approvalToken: true,
      approvalSentAt: true, approvalViewedAt: true, approvalNudgedAt: true, approvalNudgeCount: true,
      project: {
        select: {
          name: true, approvalGroupJid: true, approvalReminderDays: true, approvalMaxReminders: true,
          setor: { select: { companyId: true } },
        },
      },
    },
    take: 500,
  });

  // Vencidas: passaram N dias do envio/último lembrete e ainda há lembrete sobrando.
  const due = tasks.filter((t) => {
    const days = Math.max(1, t.project.approvalReminderDays);
    const last = t.approvalNudgedAt ?? t.approvalSentAt!;
    return t.approvalNudgeCount < t.project.approvalMaxReminders && now.getTime() - last.getTime() >= days * 86_400_000;
  });

  const byProject = new Map<string, typeof due>();
  for (const t of due) byProject.set(t.projectId, [...(byProject.get(t.projectId) ?? []), t]);

  let sent = 0, failed = 0, stale = 0;
  for (const [projectId, list] of byProject) {
    const proj = list[0].project;
    const agencyId = proj.setor.companyId;
    const instanceId = await resolveGroupInstanceId(agencyId, proj.approvalGroupJid!);
    if (!instanceId) { failed++; continue; }

    const items: PendingItem[] = list.map((t) => ({
      title: t.title, token: t.approvalToken!, sentAt: t.approvalSentAt!, viewed: !!t.approvalViewedAt,
    }));
    const msg = await prisma.scheduledMessage.create({
      data: {
        companyId: agencyId,
        instanceId,
        phone:  proj.approvalGroupJid!,
        body:   reminderText(items),
        sendAt: now,
        kind:   "approval_reminder",
        meta:   { projectId, taskIds: list.map((t) => t.id) },
      },
    });
    const r = await deliverScheduledMessage(msg.id);
    if (r !== "sent") { failed++; continue; }
    sent++;

    for (const t of list) {
      const count = t.approvalNudgeCount + 1;
      await prisma.projectTask.update({
        where: { id: t.id },
        data:  { approvalNudgedAt: now, approvalNudgeCount: count },
      });
      await prisma.projectTaskEvent.create({
        data: {
          taskId: t.id, projectId, type: "APPROVAL_NUDGE",
          toText: `Lembrete ${count}/${proj.approvalMaxReminders} no grupo · ${t.approvalViewedAt ? "cliente já viu" : "cliente não abriu"}`,
        },
      }).catch(() => {});

      // Último lembrete: daqui pra frente é com a equipe (ligar, cobrar na reunião).
      if (count >= proj.approvalMaxReminders) {
        stale++;
        await prisma.projectActivity.create({
          data: {
            projectId, type: "APPROVAL_STALE", taskName: t.title, taskId: t.id,
            description: `Cliente não aprovou depois de ${count} lembretes no grupo. Hora de falar direto com ele.`,
          },
        }).catch(() => {});
        if (t.assigneeId) {
          void sendPushToUser(t.assigneeId, {
            title: "Aprovação travada",
            body:  `${t.title} (${proj.name}): ${count} lembretes sem resposta do cliente.`,
            url:   `/projetos/${projectId}`,
            tag:   `aprov-${t.id}`,
          }, "followUp");
        }
      }
    }
  }

  return NextResponse.json({ ok: true, pending: tasks.length, due: due.length, groups: byProject.size, sent, failed, stale });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
