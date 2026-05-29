import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { verifyCompanyEmail } from "@/lib/company-email";

// POST /api/email/config/test  → verifica conexão SMTP da empresa
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  let companyId = (session.user as any).companyId as string | undefined;
  if (role === "SUPER_ADMIN") {
    const body = await req.json().catch(() => ({}));
    companyId = body.companyId ?? companyId;
  }
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const result = await verifyCompanyEmail(companyId);
  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
}
