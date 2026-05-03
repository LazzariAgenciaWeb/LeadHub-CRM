import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, fetchClickupListStats } from "@/lib/clickup";

/**
 * GET/POST /api/cron/projetos-sync
 *
 * Sincroniza estatísticas de cada projeto (taskCount/completed/overdue) via
 * ClickUp API. Roda a cada 15-30 min via cron externo.
 *
 * Apenas projetos não finalizados (status ≠ ENTREGUE/CANCELADO) são tocados,
 * pra economizar chamadas.
 *
 * Segurança: header `Authorization: Bearer <CRON_SECRET>` quando configurado.
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

  // Agrupa por companyId pra reusar token
  const settingsByCompany = new Map<string, Awaited<ReturnType<typeof getClickupSettings>>>();
  let synced = 0;
  let errors = 0;

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

    const stats = await fetchClickupListStats(settings.apiToken, proj.clickupListId);
    if (!stats) {
      errors++;
      continue;
    }

    await prisma.setorClickupList.update({
      where: { id: proj.id },
      data:  {
        taskCount:     stats.taskCount,
        taskCompleted: stats.taskCompleted,
        taskOverdue:   stats.taskOverdue,
        lastSyncedAt:  new Date(),
      },
    });
    synced++;
  }

  return NextResponse.json({
    ok: true,
    total: projects.length,
    synced,
    errors,
    timestamp: new Date().toISOString(),
  });
}

export const GET  = handle;
export const POST = handle;
