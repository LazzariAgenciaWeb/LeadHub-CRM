import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import CRMBoard from "../CRMBoard";

const PIPELINE = "LEADS";

const DEFAULT_STAGES = [
  { name: "Novo Lead", color: "#6366f1", order: 0, isFinal: false },
  { name: "Em Conversa", color: "#3b82f6", order: 1, isFinal: false },
  { name: "Qualificado", color: "#8b5cf6", order: 2, isFinal: false },
  { name: "Reunião Agendada", color: "#f59e0b", order: 3, isFinal: false },
  { name: "Reunião Realizada", color: "#f97316", order: 4, isFinal: false },
  { name: "Convertido em Oportunidade", color: "#22c55e", order: 5, isFinal: true },
  { name: "Perdido", color: "#ef4444", order: 6, isFinal: true },
];

export default async function LeadsPage({
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

  const effectiveCompanyId = isRealSuperAdmin ? undefined : companyId;

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
    // Fallback: se nenhuma empresa tem stages, usa os defaults
    if (stages.length === 0) {
      stages = DEFAULT_STAGES.map((s, i) => ({ ...s, id: `default-${i}`, pipeline: PIPELINE, companyId: "", createdAt: new Date(), updatedAt: new Date() }));
    }
  }

  if (stages.length === 0 && !isRealSuperAdmin && effectiveCompanyId) {
    stages = await Promise.all(
      DEFAULT_STAGES.map((s) =>
        prisma.pipelineStageConfig.create({
          data: { ...s, pipeline: PIPELINE, companyId: effectiveCompanyId },
        })
      )
    );
  }

  const leads = await prisma.lead.findMany({
    where: {
      pipeline: PIPELINE,
      ...(effectiveCompanyId ? { companyId: effectiveCompanyId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      campaign: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
    },
  });

  const companies = isSuperAdmin
    ? await prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  return (
    <CRMBoard
      pipeline={PIPELINE}
      initialLeads={leads as any}
      stages={stages}
      isSuperAdmin={isSuperAdmin}
      companies={companies}
      defaultLeadId={defaultLeadId}
      defaultCompanyId={defaultCompanyId}
    />
  );
}
