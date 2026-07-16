import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { videoActorScope } from "@/lib/videos";

// GET /api/videos/categories — trilhas do escopo do usuário (cadastro).
//   SUPER_ADMIN → biblioteca central (GLOBAL). ADMIN → trilhas da própria empresa.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "videos");
  if (!gate.ok) return gate.response;

  const actor = videoActorScope(session);
  if (!actor) return NextResponse.json({ error: "Sem empresa associada" }, { status: 403 });

  const where =
    actor.scope === "GLOBAL"
      ? { scope: "GLOBAL" as const }
      : { scope: "COMPANY" as const, companyId: actor.companyId };

  const categories = await prisma.videoCategory.findMany({
    where,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      videos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      releases: { select: { companyId: true } },
    },
  });

  return NextResponse.json({
    scope: actor.scope,
    categories: categories.map((c) => ({
      ...c,
      releaseCompanyIds: c.releases.map((r) => r.companyId),
    })),
  });
}

// POST /api/videos/categories — cria uma trilha no escopo do usuário.
// Body: { title, description?, emoji?, accent?, visibility? }
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "videos");
  if (!gate.ok) return gate.response;

  const actor = videoActorScope(session);
  if (!actor) return NextResponse.json({ error: "Sem empresa associada" }, { status: 403 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });

  const visibility = body.visibility === "ALL" ? "ALL" : "SELECTED";

  // Próxima posição (fim da lista do escopo).
  const last = await prisma.videoCategory.findFirst({
    where: actor.scope === "GLOBAL" ? { scope: "GLOBAL" } : { scope: "COMPANY", companyId: actor.companyId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const category = await prisma.videoCategory.create({
    data: {
      title,
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      emoji: typeof body.emoji === "string" && body.emoji.trim() ? body.emoji.trim() : null,
      accent: typeof body.accent === "string" && body.accent.trim() ? body.accent.trim() : null,
      scope: actor.scope,
      companyId: actor.companyId,
      visibility,
      position: (last?.position ?? -1) + 1,
    },
  });

  return NextResponse.json({ category }, { status: 201 });
}
