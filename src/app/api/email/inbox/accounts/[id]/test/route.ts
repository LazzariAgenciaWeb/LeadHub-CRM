import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { verifyEmailAccount, syncAccountInbox } from "@/lib/imap-inbox";
import { resolveCompanyId } from "../../helpers";

// POST /api/email/inbox/accounts/[id]/test  → testa SMTP + IMAP da conta.
// IMAP ok → já roda a 1ª sync pra caixa não abrir vazia.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const companyId = resolveCompanyId(session, body?.companyId);
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });
  const { id } = await params;

  try {
    const result = await verifyEmailAccount(companyId, id);
    let imported = 0;
    let syncError: string | undefined;
    if (result.imap?.ok) {
      try {
        imported = (await syncAccountInbox(companyId, id)).imported;
      } catch (e: any) {
        syncError = e?.message ?? "Falha na 1ª sincronização";
      }
    }
    return NextResponse.json({ ...result, imported, syncError });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha no teste" }, { status: 400 });
  }
}
