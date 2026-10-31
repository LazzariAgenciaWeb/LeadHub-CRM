import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { testApiKey } from "@/lib/freepik";

// POST /api/integrations/freepik/test   Body: { apiKey, baseUrl? }
// Confere a chave ANTES de salvar. Vai pelo servidor porque a API do Freepik
// não libera CORS — o navegador não consegue chamar direto.
// getServerSession (não a efetiva): chave da plataforma é do Lazzari, e durante
// impersonação o role efetivo vira ADMIN.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const apiKey = String(body?.apiKey ?? "").trim();
  if (!apiKey) return NextResponse.json({ error: "Informe a chave" }, { status: 400 });
  const baseUrl = String(body?.baseUrl ?? "").trim() || "https://api.freepik.com";

  const result = await testApiKey({ apiKey, baseUrl: baseUrl.replace(/\/+$/, "") });
  if ("ok" in result) return NextResponse.json({ ok: true });

  return NextResponse.json(
    { error: result.status === 401 ? "Chave inválida ou sem permissão" : result.error },
    { status: 200 },
  );
}
