import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { syncProjectFromClickup } from "@/lib/project-sync";
import { assertModule } from "@/lib/billing";

// POST /api/projetos/[id]/sync — sync manual de UM projeto
// Requer sessão (não usa CRON_SECRET, pra permitir o botão "Sync" no detail).
// A sincronização em si vive em project-sync.ts, compartilhada com a ferramenta
// sincronizar_projeto do assistente — o botão e o MCP fazem exatamente o mesmo.
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
    select:  { id: true, setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const r = await syncProjectFromClickup(id);
  if (!r.ok) {
    const status = r.code === "SEM_PROJETO" ? 404
                 : r.code === "SEM_LISTA"   ? 400
                 : r.code === "SEM_TOKEN"   ? 503
                 : 502;
    return NextResponse.json({ error: r.reason }, { status });
  }

  return NextResponse.json({
    ok: true,
    tasksFound: r.tasksFound,
    mirrored:   r.mirrored, // quantas tarefas do ClickUp viraram tarefas nativas nesta sync
    activities: r.activities,
    syncedAt:   r.syncedAt,
  });
}
