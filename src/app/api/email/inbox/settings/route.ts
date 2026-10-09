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
    select: { emailAiTriageAuto: true, emailAutoSpam: true },
  });
  return NextResponse.json({
    aiTriageAuto: company?.emailAiTriageAuto ?? false,
    autoSpam: company?.emailAutoSpam ?? false,
  });
}

// PATCH /api/email/inbox/settings  { aiTriageAuto?: boolean, autoSpam?: boolean }
// Ao LIGAR a limpeza automática, já faz a faxina do que está parado na
// Entrada — senão a caixa continuaria suja até chegar email novo.
export async function PATCH(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const body = await req.json().catch(() => ({}));

  const data: { emailAiTriageAuto?: boolean; emailAutoSpam?: boolean } = {};
  if (typeof body?.aiTriageAuto === "boolean") data.emailAiTriageAuto = body.aiTriageAuto;
  if (typeof body?.autoSpam === "boolean") data.emailAutoSpam = body.autoSpam;
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nada pra atualizar" }, { status: 400 });
  }

  const company = await prisma.company.update({
    where: { id: ctx.companyId },
    data,
    select: { emailAiTriageAuto: true, emailAutoSpam: true },
  });

  let limpos = 0;
  if (data.emailAutoSpam === true) {
    const r = await prisma.inboxEmail.updateMany({
      where: {
        companyId: ctx.companyId,
        direction: "IN",
        folder: "INBOX",
        aiLocked: false, // decisão manual é respeitada
        OR: [{ suspicious: true }, { aiImportance: "BAIXA" }],
      },
      data: { folder: "SPAM" },
    });
    limpos = r.count;
  }

  return NextResponse.json({
    ok: true,
    aiTriageAuto: company.emailAiTriageAuto,
    autoSpam: company.emailAutoSpam,
    limpos,
  });
}
