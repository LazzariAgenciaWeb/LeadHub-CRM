import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { upsertCompanyImapConfig } from "@/lib/imap-inbox";

function resolveCompanyId(session: any, explicit?: string | null): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return explicit ?? session.user.companyId ?? null;
  return session.user.companyId ?? null;
}

// GET /api/email/inbox/config?companyId=  → config IMAP da empresa (sem expor senha)
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const companyId = resolveCompanyId(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json(null);

  const cfg = await prisma.companyImapConfig.findUnique({
    where: { companyId },
    select: {
      host: true, port: true, secure: true, user: true, active: true,
      verified: true, lastVerifiedAt: true, lastError: true, lastSyncedAt: true,
      // passEnc NUNCA é retornado
    },
  });
  return NextResponse.json(cfg ? { ...cfg, hasPassword: true } : null);
}

// PUT /api/email/inbox/config  → cria/atualiza config IMAP
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const companyId = resolveCompanyId(session, body?.companyId);
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const { host, port, secure, user, pass, active } = body;
  if (!host?.trim() || !user?.trim()) {
    return NextResponse.json({ error: "host e user são obrigatórios" }, { status: 400 });
  }

  try {
    await upsertCompanyImapConfig(companyId, {
      host,
      port: parseInt(String(port ?? 993), 10),
      secure: secure !== false,
      user,
      pass,
      active: active !== false,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao salvar" }, { status: 400 });
  }
}
