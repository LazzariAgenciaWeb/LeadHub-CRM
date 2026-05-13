import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { attachTaskSummaries, openTaskCountMap } from "@/lib/lead-task-summary";
import { computeScoresForLeads } from "@/lib/lead-score";
import { redirect } from "next/navigation";
import CRMBoard from "../CRMBoard";

const PIPELINE = "PROSPECCAO";

const DEFAULT_STAGES = [
  { name: "Não Contatado", color: "#64748b", order: 0, isFinal: false },
  { name: "Tentando Contato", color: "#8b5cf6", order: 1, isFinal: false },
  { name: "Primeiro Contato", color: "#3b82f6", order: 2, isFinal: false },
  { name: "Apresentação", color: "#f59e0b", order: 3, isFinal: false },
  { name: "Convertido", color: "#22c55e", order: 4, isFinal: true },
  { name: "Descartado", color: "#ef4444", order: 5, isFinal: true },
];

export default async function ProspeccaoPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const defaultLeadId = sp.lead;

  const isRealSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const isSuperAdmin = isRealSuperAdmin || !!(session as any)._impersonating;
  const companyId = (session.user as any)?.companyId as string | undefined;
  const defaultCompanyId = (session as any)._impersonating?.companyId as string | undefined;

  const effectiveCompanyId = isRealSuperAdmin
    ? undefined // superadmin vê todos
    : companyId;

  // Busca etapas configuradas ou cria os defaults
  let stages = await prisma.pipelineStageConfig.findMany({
    where: { pipeline: PIPELINE, ...(effectiveCompanyId ? { companyId: effectiveCompanyId } : {}) },
    orderBy: { order: "asc" },
  });

  // SUPER_ADMIN vê stages de todas as empresas — deduplicar por nome
  // e filtrar pelos nomes canônicos do pipeline (evita contaminar com stages de outros pipelines)
  if (isRealSuperAdmin) {
    const canonicalNames = new Set(DEFAULT_STAGES.map(s => s.name));
    const seen = new Set<string>();
    stages = stages.filter((s) =>
      canonicalNames.has(s.name) && (seen.has(s.name) ? false : (seen.add(s.name), true))
    );
    if (stages.length === 0) {
      stages = DEFAULT_STAGES.map((s, i) => ({ ...s, id: `default-${i}`, pipeline: PIPELINE, companyId: "", createdAt: new Date(), updatedAt: new Date() }));
    }
  }

  // Se não há etapas configuradas e temos uma empresa, cria os defaults
  if (stages.length === 0 && !isRealSuperAdmin && effectiveCompanyId) {
    stages = await Promise.all(
      DEFAULT_STAGES.map((s) =>
        prisma.pipelineStageConfig.create({
          data: { ...s, pipeline: PIPELINE, companyId: effectiveCompanyId },
        })
      )
    );
  }

  const rawLeads = await prisma.lead.findMany({
    where: {
      pipeline: PIPELINE,
      ...(effectiveCompanyId ? { companyId: effectiveCompanyId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      campaign: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      trackingLink: { select: { id: true, code: true, label: true, clicks: true, destination: true, isActive: true, _count: { select: { clickEvents: true } } } },
      tags: { include: { tag: true } },
    },
  });
  const leadsWithTaskSummary = await attachTaskSummaries(rawLeads);
  const scores = await computeScoresForLeads({
    leads: leadsWithTaskSummary as any,
    openTaskByLead: openTaskCountMap(leadsWithTaskSummary),
  });
  const leads = leadsWithTaskSummary.map((l) => ({
    ...l,
    tags: (l as any).tags?.map((lt: any) => ({ id: lt.tag.id, name: lt.tag.name, color: lt.tag.color })) ?? [],
    score: scores[l.id] ?? null,
  }));

  const companies = isSuperAdmin
    ? await prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  const [clickupSetting, whatsappInstanceCount, currentCompany] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "clickup_api_token" }, select: { value: true } }),
    effectiveCompanyId
      ? prisma.whatsappInstance.count({ where: { companyId: effectiveCompanyId } })
      : Promise.resolve(0),
    effectiveCompanyId
      ? prisma.company.findUnique({ where: { id: effectiveCompanyId }, select: { moduleWhatsapp: true, moduleProspeccao: true, serpapiKey: true } })
      : Promise.resolve(null),
  ]);
  const clickupEnabled  = !!clickupSetting?.value;
  const whatsappEnabled = isRealSuperAdmin || (currentCompany?.moduleWhatsapp === true && whatsappInstanceCount > 0);
  // SUPER_ADMIN sempre vê (pra testar/operar AZZ). ADMIN da empresa precisa do
  // módulo ligado E da própria SerpAPI key cadastrada — sem key não dá pra buscar.
  const prospeccaoEnabled = isRealSuperAdmin
    || (currentCompany?.moduleProspeccao === true && !!currentCompany?.serpapiKey);

  return (
    <CRMBoard
      pipeline={PIPELINE}
      initialLeads={leads as any}
      stages={stages}
      isSuperAdmin={isSuperAdmin}
      defaultLeadId={defaultLeadId}
      companies={companies}
      defaultCompanyId={defaultCompanyId}
      whatsappEnabled={whatsappEnabled}
      clickupEnabled={clickupEnabled}
      prospeccaoEnabled={prospeccaoEnabled}
    />
  );
}
