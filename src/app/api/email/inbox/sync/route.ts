import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { syncCompanyInbox } from "@/lib/imap-inbox";

// POST /api/email/inbox/sync → "Sincronizar agora" da empresa da sessão.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const role = (session.user as any).role as string;
  const companyId = role === "SUPER_ADMIN"
    ? (body?.companyId ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  try {
    const { imported } = await syncCompanyInbox(companyId);
    return NextResponse.json({ ok: true, imported });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha na sincronização" }, { status: 400 });
  }
}
