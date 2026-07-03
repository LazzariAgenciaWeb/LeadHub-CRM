import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { sendTestConversion } from "@/lib/meta-capi";

// POST /api/integrations/meta-capi/test  → dispara um evento de teste pro Meta.
// Usa o test_event_code da config (se houver) pra aparecer na aba "Eventos de
// teste" do Events Manager sem sujar os dados reais.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const body = await req.json().catch(() => ({}));
  const companyId = role === "SUPER_ADMIN"
    ? (body?.companyId || (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const result = await sendTestConversion(companyId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
