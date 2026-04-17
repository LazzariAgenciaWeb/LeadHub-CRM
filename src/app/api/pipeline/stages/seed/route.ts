import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const DEFAULT_STAGES: Record<string, { name: string; color: string; order: number; isFinal: boolean }[]> = {
  PROSPECCAO: [
    { name: "Não Contatado",    color: "#64748b", order: 0, isFinal: false },
    { name: "Tentando Contato", color: "#8b5cf6", order: 1, isFinal: false },
    { name: "Primeiro Contato", color: "#3b82f6", order: 2, isFinal: false },
    { name: "Apresentação",     color: "#06b6d4", order: 3, isFinal: false },
    { name: "Proposta Enviada", color: "#f59e0b", order: 4, isFinal: false },
    { name: "Convertido ✅",    color: "#22c55e", order: 5, isFinal: true  },
    { name: "Descartado ❌",    color: "#ef4444", order: 6, isFinal: true  },
  ],
  LEADS: [
    { name: "Novo Lead",                      color: "#6366f1", order: 0, isFinal: false },
    { name: "Em Conversa",                    color: "#8b5cf6", order: 1, isFinal: false },
    { name: "Qualificado",                    color: "#3b82f6", order: 2, isFinal: false },
    { name: "Reunião Agendada",               color: "#06b6d4", order: 3, isFinal: false },
    { name: "Reunião Realizada",              color: "#f59e0b", order: 4, isFinal: false },
    { name: "Convertido em Oportunidade ✅",  color: "#22c55e", order: 5, isFinal: true  },
    { name: "Perdido ❌",                     color: "#ef4444", order: 6, isFinal: true  },
  ],
  OPORTUNIDADES: [
    { name: "Reunião Realizada",      color: "#8b5cf6", order: 0, isFinal: false },
    { name: "Proposta Enviada",       color: "#3b82f6", order: 1, isFinal: false },
    { name: "Em Negociação",          color: "#f59e0b", order: 2, isFinal: false },
    { name: "Aguardando Aprovação",   color: "#f97316", order: 3, isFinal: false },
    { name: "Fechado ✅",             color: "#22c55e", order: 4, isFinal: true  },
    { name: "Perdido ❌",             color: "#ef4444", order: 5, isFinal: true  },
  ],
  CHAMADOS: [
    { name: "Novo",                  color: "#6366f1", order: 0, isFinal: false },
    { name: "Em Análise",            color: "#8b5cf6", order: 1, isFinal: false },
    { name: "Aguardando Cliente",    color: "#f59e0b", order: 2, isFinal: false },
    { name: "Em Execução",           color: "#3b82f6", order: 3, isFinal: false },
    { name: "Resolvido ✅",          color: "#22c55e", order: 4, isFinal: true  },
    { name: "Fechado",               color: "#64748b", order: 5, isFinal: true  },
  ],
};

// POST /api/pipeline/stages/seed
// Cria etapas padrão para um pipeline de uma empresa (se ainda não existirem)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const body = await req.json();
  const { pipeline, companyId, force } = body;

  if (!pipeline) {
    return NextResponse.json({ error: "Pipeline inválido" }, { status: 400 });
  }

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;
  if (!effectiveCompanyId) return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });

  const existing = await prisma.pipelineStageConfig.count({
    where: { pipeline, companyId: effectiveCompanyId },
  });

  // Se já tem etapas e não é force, retorna sem fazer nada
  if (existing > 0 && !force) {
    return NextResponse.json({ created: 0, message: "Etapas já existem. Use force=true para recriar." });
  }

  // Se force, apaga as existentes antes
  if (force && existing > 0) {
    await prisma.pipelineStageConfig.deleteMany({
      where: { pipeline, companyId: effectiveCompanyId },
    });
  }

  const stages = await Promise.all(
    DEFAULT_STAGES[pipeline].map((s) =>
      prisma.pipelineStageConfig.create({
        data: { ...s, pipeline, companyId: effectiveCompanyId },
      })
    )
  );

  return NextResponse.json({ created: stages.length, stages });
}
