import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { verifyCompanyImap, syncCompanyInbox } from "@/lib/imap-inbox";

// POST /api/email/inbox/config/test  → testa conexão IMAP e roda a 1ª sync.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  const body = await req.json().catch(() => ({}));
  const companyId = role === "SUPER_ADMIN"
    ? (body?.companyId ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const result = await verifyCompanyImap(companyId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // Conexão ok → já importa a primeira leva pra caixa não abrir vazia.
  try {
    const { imported } = await syncCompanyInbox(companyId);
    return NextResponse.json({ ok: true, imported });
  } catch (e: any) {
    return NextResponse.json({ ok: true, imported: 0, syncError: e?.message ?? "Falha na 1ª sincronização" });
  }
}
