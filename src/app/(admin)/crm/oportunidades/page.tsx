import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import CRMBoard from "../CRMBoard";

const PIPELINE = "OPORTUNIDADES";

const DEFAULT_STAGES = [
  { name: "Reunião Realizada", color: "#8b5cf6", order: 0, isFinal: false },
  { name: "Proposta Enviada", color: "#3b82f6", order: 1, isFinal: false },
  { name: "Em Negociação", color: "#f59e0b", order: 2, isFinal: false },
  { name: "Aguardando Aprovação", color: "#f97316", order: 3, isFinal: false },
  { name: "Fechado ✅", color: "#22c55e", order: 4, isFinal: true },
  { name: "Perdido ❌", color: "#ef4444", order: 5, isFinal: true },
];

export default async function OportunidadesPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const companyId = (session.user as any)?.companyId as string | undefined;

  const effectiveCompanyId = isSuperAdmin ? undefined : companyId;

  let stages = await prisma.pipelineStageConfig.findMany({
    where: { pipeline: PIPELINE, ...(effectiveCompanyId ? { companyId: effectiveCompanyId } : {}) },
    orderBy: { order: "asc" },
  });

  if (stages.length === 0 && effectiveCompanyId) {
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
    />
  );
}
