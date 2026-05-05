import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, fetchClickupTasks } from "@/lib/clickup";
import { syncProjectTasks } from "@/lib/gamification";

/**
 * POST /api/projetos/sync-all
 *
 * Versão "manual" do cron projetos-sync — usa sessão (não CRON_SECRET) pra
 * ser chamada do botão na UI sem expor o secret. Roda exatamente o mesmo
 * algoritmo: contadores, atividades, pontuação.
 *
 * Acesso: usuário autenticado da empresa (filtra projetos por companyId).
 * SUPER_ADMIN sincroniza todas as empresas.
 */
export async function POST() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const where = role === "SUPER_ADMIN"
    ? { status: { notIn: ["ENTREGUE", "CANCELADO"] as any } }
    : {
        status: { notIn: ["ENTREGUE", "CANCELADO"] as any },
        setor:  { companyId: userCompanyId },
      };

  const projects = await prisma.setorClickupList.findMany({
    where,
    include: { setor: { select: { companyId: true } } },
  });

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
  });
}
