import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { runEmailTriage } from "@/lib/email-triage";

// POST /api/email/inbox/ai-triage
// Botão "Resumo IA": analisa os emails recebidos HOJE (Entrada + Importantes)
// numa única interação da cota de IA — importância + resumo por email + digest.
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

  const result = await runEmailTriage(companyId, "today", (session.user as any).id ?? null);
  if (!result.ok) {
    if (result.code === "EMPTY") return NextResponse.json({ digest: result.error, analyzed: 0 });
    const status = result.code === "QUOTA" ? 402 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ digest: result.digest, analyzed: result.analyzed });
}
