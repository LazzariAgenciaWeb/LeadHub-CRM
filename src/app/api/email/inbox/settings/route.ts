import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

async function requireCtx() {
  const session = await getEffectiveSession();
  if (!session) return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return { ok: false as const, res: gate.response };
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return { ok: false as const, res: NextResponse.json({ error: "Sem empresa" }, { status: 400 }) };
  return { ok: true as const, companyId };
}

// GET /api/email/inbox/settings → preferências da caixa da empresa
export async function GET() {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const company = await prisma.company.findUnique({
    where: { id: ctx.companyId },
    select: { emailAiTriageAuto: true },
  });
  return NextResponse.json({ aiTriageAuto: company?.emailAiTriageAuto ?? false });
}

// PATCH /api/email/inbox/settings  { aiTriageAuto: boolean }
export async function PATCH(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.aiTriageAuto !== "boolean") {
    return NextResponse.json({ error: "aiTriageAuto (boolean) obrigatório" }, { status: 400 });
  }
  await prisma.company.update({
    where: { id: ctx.companyId },
    data: { emailAiTriageAuto: body.aiTriageAuto },
  });
  return NextResponse.json({ ok: true, aiTriageAuto: body.aiTriageAuto });
}
