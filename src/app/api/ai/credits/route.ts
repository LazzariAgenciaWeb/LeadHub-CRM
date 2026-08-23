import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession, isImpersonating } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { getAiUsage } from "@/lib/assistant";

function resolveCompanyId(session: any, fallback?: string | null): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return fallback ?? session.user.companyId ?? null;
  return session.user.companyId ?? null;
}

// GET /api/ai/credits[?companyId=]  → consumo de IA da empresa no período atual
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const companyId = resolveCompanyId(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json({ quota: 0, used: 0, remaining: 0, resetAt: null });

  const usage = await getAiUsage(companyId);
  return NextResponse.json(usage);
}

// PUT /api/ai/credits  → define a cota mensal da empresa. SUPER_ADMIN only
// (é a alavanca comercial — o cliente não aumenta o próprio limite).
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Super admin REAL: durante impersonação o role efetivo é ADMIN, mas só um
  // SUPER_ADMIN consegue impersonar. Aceita ambos os casos.
  const role = (session.user as any).role as string;
  const realSuperAdmin = role === "SUPER_ADMIN" || isImpersonating(session);
  if (!realSuperAdmin) {
    return NextResponse.json({ error: "Apenas o administrador da plataforma define a cota." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const companyId = body.companyId ?? (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ error: "companyId ausente" }, { status: 400 });

  const quota = Number(body.aiMonthlyQuota);
  if (!Number.isInteger(quota) || quota < 0) {
    return NextResponse.json({ error: "Cota inválida (inteiro >= 0)" }, { status: 400 });
  }

  // Grava como EXCEÇÃO de limite na assinatura, não direto na Company:
  // `aiMonthlyQuota` é cache derivado (plano + exceção) e seria sobrescrito no
  // próximo save da assinatura. Espelhamos no cache aqui pra valer na hora.
  const sub = await prisma.subscription.findUnique({
    where: { companyId },
    select: { id: true, customLimits: true },
  });
  if (sub) {
    const limits = (sub.customLimits as Record<string, unknown> | null) ?? {};
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { customLimits: { ...limits, aiInteractions: quota } as any },
    });
  }
  await prisma.company.update({
    where: { id: companyId },
    data: { aiMonthlyQuota: quota },
  });

  const usage = await getAiUsage(companyId);
  return NextResponse.json(usage);
}
