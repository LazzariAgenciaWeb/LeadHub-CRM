import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { canManageCategory, parseYouTubeId } from "@/lib/videos";

// POST /api/videos — adiciona um vídeo a uma trilha.
// Body: { categoryId, url, title, description?, durationLabel?, thumbnailUrl? }
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "videos");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const youtubeId = parseYouTubeId(typeof body.url === "string" ? body.url : "");

  if (!categoryId) return NextResponse.json({ error: "categoryId obrigatório" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });
  if (!youtubeId) return NextResponse.json({ error: "Link do YouTube inválido" }, { status: 400 });

  const category = await prisma.videoCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, scope: true, companyId: true },
  });
  if (!category) return NextResponse.json({ error: "Trilha não encontrada" }, { status: 404 });
  if (!canManageCategory(session, category)) {
    return NextResponse.json({ error: "Sem permissão nessa trilha" }, { status: 403 });
  }

  const last = await prisma.video.findFirst({
    where: { categoryId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const video = await prisma.video.create({
    data: {
      categoryId,
      title,
      youtubeId,
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      durationLabel: typeof body.durationLabel === "string" && body.durationLabel.trim() ? body.durationLabel.trim() : null,
      thumbnailUrl: typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim() ? body.thumbnailUrl.trim() : null,
      position: (last?.position ?? -1) + 1,
    },
  });

  return NextResponse.json({ video }, { status: 201 });
}
