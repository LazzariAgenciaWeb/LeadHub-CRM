import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { upsertCompanyEmailConfig } from "@/lib/company-email";

function resolveCompanyId(session: any, body?: any): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return body?.companyId ?? session.user.companyId ?? null;
  return session.user.companyId ?? null;
}

// GET /api/email/config?companyId=  → config SMTP da empresa (sem expor senha)
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  const companyId = role === "SUPER_ADMIN"
    ? (req.nextUrl.searchParams.get("companyId") ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json(null);

  const cfg = await prisma.companyEmailConfig.findUnique({
    where: { companyId },
    select: {
      host: true, port: true, secure: true, user: true,
      fromEmail: true, fromName: true, verified: true,
      lastVerifiedAt: true, lastError: true,
      // passEnc NUNCA é retornado
    },
  });
  return NextResponse.json(cfg ? { ...cfg, hasPassword: true } : null);
}

// PUT /api/email/config  → cria/atualiza config
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const companyId = resolveCompanyId(session, body);
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const { host, port, secure, user, pass, fromEmail, fromName } = body;
  if (!host?.trim() || !user?.trim() || !fromEmail?.trim() || !fromName?.trim()) {
    return NextResponse.json({ error: "host, user, fromEmail e fromName são obrigatórios" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail.trim())) {
    return NextResponse.json({ error: "fromEmail inválido" }, { status: 400 });
  }

  try {
    await upsertCompanyEmailConfig(companyId, {
      host, port: parseInt(String(port ?? 465), 10), secure: secure !== false,
      user, pass, fromEmail, fromName,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao salvar" }, { status: 400 });
  }
}
