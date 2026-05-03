import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { ScoreReason } from "@/generated/prisma";
import { SCORE_TABLE } from "@/lib/gamification";

const ALL_REASONS: ScoreReason[] = [
  "RESPOSTA_RAPIDA_5MIN",
  "RESPOSTA_RAPIDA_30MIN",
  "TICKET_RESOLVIDO",
  "LEAD_AVANCADO",
  "LEAD_CONVERTIDO",
  "DIA_SEM_PENDENCIA",
  "DIA_SEM_ATRASO",
  "RETORNO_ANTECIPADO",
  "ATENDIMENTO_MESMO_DIA",
  "NOTA_REGISTRADA",
  "PRIMEIRO_CONTATO",
  "SLA_VENCIDO",
  "CONVERSA_SEM_RESPOSTA",
  "PRAZO_PRORROGADO",
];

type RuleInput = {
  reason:         ScoreReason;
  enabled:        boolean;
  points:         number;
  affectsRanking: boolean;
};

// GET /api/configuracoes/gamificacao
// Retorna todas as razões com sua configuração (default + override).
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });

  const configs = await prisma.scoreRuleConfig.findMany({
    where: { companyId },
  });
  const byReason = new Map(configs.map((c) => [c.reason, c]));

  const rules = ALL_REASONS.map((reason) => {
    const cfg = byReason.get(reason);
    return {
      reason,
      defaultPoints:  SCORE_TABLE[reason],
      enabled:        cfg?.enabled        ?? true,
      points:         cfg?.points         ?? SCORE_TABLE[reason],
      affectsRanking: cfg?.affectsRanking ?? true,
    };
  });

  return NextResponse.json({ rules });
}

// PUT /api/configuracoes/gamificacao
// Body: { rules: RuleInput[] }
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string | undefined;
  const role      = (session.user as any).role as string;
  if (!companyId) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { rules }: { rules: RuleInput[] } = await req.json();
  if (!Array.isArray(rules)) {
    return NextResponse.json({ error: "rules deve ser array" }, { status: 400 });
  }

  await prisma.$transaction(
    rules.map((r) =>
      prisma.scoreRuleConfig.upsert({
        where:  { companyId_reason: { companyId, reason: r.reason } },
        create: {
          companyId,
          reason:         r.reason,
          enabled:        r.enabled,
          points:         r.points,
          affectsRanking: r.affectsRanking,
        },
        update: {
          enabled:        r.enabled,
          points:         r.points,
          affectsRanking: r.affectsRanking,
        },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
