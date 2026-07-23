import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { hasModule } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { videoActorScope } from "@/lib/videos";
import VideosManager from "./VideosManager";
import OnboardingVideoCard from "./OnboardingVideoCard";

export const dynamic = "force-dynamic";

export default async function VideosAdminPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const role = (session.user as any)?.role as string | undefined;
  const isSuper = role === "SUPER_ADMIN";
  // Cadastro é pra SUPER_ADMIN (biblioteca central) ou ADMIN com o módulo ligado.
  if (!isSuper) {
    const isAdmin = role === "ADMIN";
    if (!isAdmin || !hasModule(session, "videos")) redirect("/dashboard");
  }

  const actor = videoActorScope(session);
  if (!actor) redirect("/dashboard");

  const where =
    actor.scope === "GLOBAL"
      ? { scope: "GLOBAL" as const }
      : { scope: "COMPANY" as const, companyId: actor.companyId };

  const [categoriesRaw, companies] = await Promise.all([
    prisma.videoCategory.findMany({
      where,
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        videos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
        releases: { select: { companyId: true } },
      },
    }),
    prisma.company.findMany({
      where: actor.scope === "GLOBAL" ? { hasSystemAccess: true } : { parentCompanyId: actor.companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const categories = categoriesRaw.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    emoji: c.emoji,
    accent: c.accent,
    active: c.active,
    visibility: c.visibility as "ALL" | "SELECTED",
    position: c.position,
    releaseCompanyIds: c.releases.map((r) => r.companyId),
    videos: c.videos.map((v) => ({
      id: v.id,
      title: v.title,
      description: v.description,
      youtubeId: v.youtubeId,
      thumbnailUrl: v.thumbnailUrl,
      durationLabel: v.durationLabel,
      active: v.active,
      position: v.position,
    })),
  }));

  // Vídeo de onboarding (global) — card fixo no topo da biblioteca central (super admin).
  const onboardingUrl =
    actor.scope === "GLOBAL"
      ? (await prisma.setting.findUnique({ where: { key: "onboarding_video_url" } }))?.value ?? ""
      : "";

  return (
    <>
      {actor.scope === "GLOBAL" && <OnboardingVideoCard initialUrl={onboardingUrl} />}
      <VideosManager scope={actor.scope} categories={categories} companies={companies} />
    </>
  );
}
