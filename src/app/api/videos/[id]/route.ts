import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { canManageCategory, parseYouTubeId } from "@/lib/videos";

// Carrega o vídeo + a trilha dona e checa se o usuário pode gerenciá-la.
async function loadOwned(session: any, id: string) {
  const video = await prisma.video.findUnique({
    where: { id },
    include: { category: { select: { id: true, scope: true, companyId: true } } },
  });
  if (!video) return { error: NextResponse.json({ error: "Vídeo não encontrado" }, { status: 404 }) };
  if (!canManageCategory(session, video.category)) {
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { video };
}

// PATCH /api/videos/[id] — edita título/descrição/duração/link/ordem/ativo.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "videos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const owned = await loadOwned(session, id);
  if (owned.error) return owned.error;

  const body = await req.json();
  const data: any = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if ("description" in body) data.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  if ("durationLabel" in body) data.durationLabel = typeof body.durationLabel === "string" && body.durationLabel.trim() ? body.durationLabel.trim() : null;
  if ("thumbnailUrl" in body) data.thumbnailUrl = typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim() ? body.thumbnailUrl.trim() : null;
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.position === "number" && Number.isFinite(body.position)) data.position = Math.trunc(body.position);
  if (typeof body.url === "string" && body.url.trim()) {
    const yid = parseYouTubeId(body.url);
    if (!yid) return NextResponse.json({ error: "Link do YouTube inválido" }, { status: 400 });
    data.youtubeId = yid;
  }

  const video = await prisma.video.update({ where: { id }, data });
  return NextResponse.json({ video });
}

// DELETE /api/videos/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "videos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const owned = await loadOwned(session, id);
  if (owned.error) return owned.error;

  await prisma.video.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
