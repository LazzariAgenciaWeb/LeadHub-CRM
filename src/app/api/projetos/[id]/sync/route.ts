import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, fetchClickupTasks, fetchClickupTaskDescription, fetchClickupTaskComments } from "@/lib/clickup";
import { readComments, sanitizeComments } from "@/lib/checklist";
import { syncProjectTasks } from "@/lib/gamification";
import { assertModule } from "@/lib/billing";

// POST /api/projetos/[id]/sync — sync manual de UM projeto
// Requer sessão (não usa CRON_SECRET, pra permitir o botão "Sync" no detail).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const { id } = await params;
  const project = await prisma.setorClickupList.findUnique({
    where:   { id },
    include: { setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  if (!project.clickupListId) {
    return NextResponse.json({ error: "Projeto sem lista do ClickUp — nada pra sincronizar" }, { status: 400 });
  }

  const settings = await getClickupSettings(project.setor.companyId);
  if (!settings?.apiToken) {
    return NextResponse.json({ error: "ClickUp não configurado pra essa empresa" }, { status: 503 });
  }

  const tasks = await fetchClickupTasks(settings.apiToken, project.clickupListId);
  if (!tasks) {
    return NextResponse.json({
      error: "Não foi possível buscar tarefas do ClickUp. Cheque se o List ID está correto e o token tem acesso."
    }, { status: 502 });
  }

  const result = await syncProjectTasks(id, tasks);

  // Fase 2 (ClickUp → interna): reflete título/prazo/concluído nas tarefas
  // internas VINCULADAS (importadas). Não cria novas — só atualiza as ligadas.
  const linked = await prisma.projectTask.findMany({
    where:  { projectId: id, clickupTaskId: { not: null } },
    select: { id: true, clickupTaskId: true, comments: true, updatedAt: true },
  });
  if (linked.length) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const lt of linked) {
      const src = byId.get(lt.clickupTaskId!);
      if (!src) continue;

      // "Quem venceu a corrida" — só sobrescreve campos editáveis (título, prazo,
      // início, descritivo) quando o ClickUp foi atualizado DEPOIS da última
      // edição no LeadHub. Se o Diego editou no LeadHub e o ClickUp está mais
      // velho, preserva a edição local.
      const remoteMs = src.dateUpdated ?? 0;
      const localMs  = lt.updatedAt.getTime();
      const remoteWins = remoteMs > localMs;

      // Descritivo (só quando remote é mais novo). Best-effort — 1 chamada por
      // tarefa vinculada. Não apaga o descritivo local se o do ClickUp for vazio.
      let desc: string | null = null;
      if (remoteWins) {
        try { desc = (await fetchClickupTaskDescription(settings.apiToken, lt.clickupTaskId!)) || null; } catch { /* silencioso */ }
      }
      // Comentários do ClickUp → atualizações do cliente. Merge deduplicado por
      // texto+data; comentários do cliente (by:"client") nunca colidem (não vão
      // pro ClickUp). Ordena cronologicamente. Comentários sempre mergam
      // (independente de "quem venceu"): comentário é append-only.
      let mergedComments: ReturnType<typeof sanitizeComments> = undefined as any;
      try {
        const cmts = await fetchClickupTaskComments(settings.apiToken, lt.clickupTaskId!);
        const existing = readComments(lt.comments);
        const seen = new Set(existing.map((c) => `${c.text}|${c.at}`));
        const fresh = cmts.filter((c) => !seen.has(`${c.text}|${c.at}`));
        if (fresh.length) {
          mergedComments = sanitizeComments(
            [...existing, ...fresh].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
          );
        }
      } catch { /* silencioso */ }

      await prisma.projectTask.update({
        where: { id: lt.id },
        data: {
          // Campos que respeitam "quem venceu" — não sobrescrevem edição local.
          ...(remoteWins && src.name ? { title: src.name } : {}),
          ...(remoteWins && desc ? { description: desc } : {}),
          ...(remoteWins ? { dueDate:   src.dueDate   != null ? new Date(src.dueDate)   : null } : {}),
          ...(remoteWins ? { startDate: src.startDate != null ? new Date(src.startDate) : null } : {}),
          // done é sempre alinhado com o ClickUp (idempotente e não conflita:
          // concluir no LeadHub já foi empurrado pro ClickUp via markClickupTaskDone).
          done: src.isCompleted,
          completedAt: src.isCompleted ? new Date() : null,
          // Comentários mergados (append-only).
          ...(mergedComments ? { comments: mergedComments } : {}),
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    tasksFound: tasks.length,
    activities: result,
    syncedAt: new Date().toISOString(),
  });
}
