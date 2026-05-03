import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, fetchClickupTasks } from "@/lib/clickup";
import { syncProjectTasks } from "@/lib/gamification";

/**
 * GET/POST /api/cron/projetos-sync
 *
 * Sincroniza projetos com ClickUp:
 *  - Atualiza contadores de tarefas (taskCount/completed/overdue/noDueDate)
 *  - Detecta criações, atualizações e conclusões de tarefas
 *  - Cria entries em ProjectActivity (histórico no detail)
 *  - Pontua membros via TAREFA_CRIADA / ATUALIZADA / CONCLUIDA
 *
 * Apenas projetos com status diferente de ENTREGUE/CANCELADO são tocados.
 *
 * Segurança: header `Authorization: Bearer <CRON_SECRET>`.
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const projects = await prisma.setorClickupList.findMany({
    where:  { status: { notIn: ["ENTREGUE", "CANCELADO"] } },
    include: { setor: { select: { companyId: true } } },
  });

  // Cache de settings por empresa pra evitar query repetida
  const settingsByCompany = new Map<string, Awaited<ReturnType<typeof getClickupSettings>>>();
  let synced = 0;
  let errors = 0;
  let totalCreated = 0, totalUpdated = 0, totalCompleted = 0;

  for (const proj of projects) {
    const cid = proj.setor.companyId;
    if (!settingsByCompany.has(cid)) {
      settingsByCompany.set(cid, await getClickupSettings(cid));
    }
    const settings = settingsByCompany.get(cid);
    if (!settings?.apiToken) {
      errors++;
      continue;
    }

    const tasks = await fetchClickupTasks(settings.apiToken, proj.clickupListId);
    if (!tasks) {
      errors++;
      continue;
    }

    const result = await syncProjectTasks(proj.id, tasks);
    synced++;
    totalCreated   += result.created;
    totalUpdated   += result.updated;
    totalCompleted += result.completed;
  }

  return NextResponse.json({
    ok: true,
    total:    projects.length,
    synced,
    errors,
    activities: { created: totalCreated, updated: totalUpdated, completed: totalCompleted },
    timestamp: new Date().toISOString(),
  });
}

export const GET  = handle;
export const POST = handle;
