import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { syncCompanyAccounts } from "@/lib/imap-inbox";

// POST /api/email/inbox/sync → "Sincronizar agora": todas as contas da empresa.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const role = (session.user as any).role as string;
  const companyId = role === "SUPER_ADMIN"
    ? (body?.companyId ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const { imported, errors } = await syncCompanyAccounts(companyId);
  if (errors.length && !imported) {
    return NextResponse.json({ error: errors.join(" · ") }, { status: 400 });
  }
  return NextResponse.json({ ok: true, imported, errors });
}
