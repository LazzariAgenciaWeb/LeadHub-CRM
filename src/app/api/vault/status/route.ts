import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getActiveTrustedSession } from "@/lib/vault-2fa";

// GET /api/vault/status
// Retorna se o usuário tem trusted session ativa pra evitar challenge na UI.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any)?.id as string;
  if (!userId) return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });

  const trustedUntil = await getActiveTrustedSession(userId);
  return NextResponse.json({
    trusted: !!trustedUntil,
    trustedUntil: trustedUntil?.toISOString() ?? null,
  });
}
