import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { hasModule } from "@/lib/permissions";
import { visibleCategoriesWhere, parseYouTubeId } from "@/lib/videos";
import { redirect } from "next/navigation";
import VideosNetflix from "./VideosNetflix";

export const dynamic = "force-dynamic";

export default async function MeuEspacoVideosPage() {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, parentCompanyId: true },
  });
  if (!company?.parentCompanyId) redirect("/dashboard");
  if (!hasModule(session, "videos")) redirect("/meu-espaco");

  const categoriesRaw = await prisma.videoCategory.findMany({
    where: visibleCategoriesWhere(companyId, company.parentCompanyId),
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      videos: {
        where: { active: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  // Só trilhas que têm vídeo ativo viram fileira.
  const categories = categoriesRaw
    .map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      emoji: c.emoji,
      accent: c.accent,
      videos: c.videos.map((v) => ({
        id: v.id,
        title: v.title,
        description: v.description,
        youtubeId: v.youtubeId,
        thumbnailUrl: v.thumbnailUrl,
        durationLabel: v.durationLabel,
      })),
    }))
    .filter((c) => c.videos.length > 0);

  // Vídeo intro fixo (mesmo setting do email de acesso) — destaque "Comece por aqui".
  const introRow = await prisma.setting.findUnique({ where: { key: "onboarding_video_url" } });
  const introId = introRow?.value ? parseYouTubeId(introRow.value) : null;
  const introVideo = introId
    ? { id: "intro", title: "Como usar o LeadHub", description: "Vídeo de introdução — comece por aqui.", youtubeId: introId, thumbnailUrl: null, durationLabel: null }
    : null;

  return <VideosNetflix categories={categories} clientName={company.name} introVideo={introVideo} />;
}
