import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { verifyChallenge } from "@/lib/vault-2fa";

// POST /api/vault/verify
// Body: { challengeId: string, code: string }
//
// Valida o código contra o challenge. Se OK, cria VaultTrustedSession (15 min)
// que dispensa novos códigos no intervalo. Retorna a data de expiração.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any)?.id as string;
  if (!userId) return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const challengeId: string = String(body.challengeId ?? "");
  const code: string = String(body.code ?? "").trim();

  if (!challengeId || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "challengeId e code (6 dígitos) obrigatórios" }, { status: 400 });
  }

  const result = await verifyChallenge({ userId, challengeId, code });
  if (!result.ok) {
    const messages: Record<string, { msg: string; status: number }> = {
      EXPIRED:           { msg: "Código expirado, peça outro",      status: 410 },
      INVALID:           { msg: "Código incorreto",                  status: 401 },
      USED:              { msg: "Código já usado",                   status: 410 },
      TOO_MANY_ATTEMPTS: { msg: "Muitas tentativas erradas",         status: 429 },
      NOT_FOUND:         { msg: "Solicitação inválida",              status: 404 },
    };
    const m = messages[result.reason];
    return NextResponse.json({ error: m.msg, reason: result.reason }, { status: m.status });
  }

  return NextResponse.json({ ok: true, trustedUntil: result.trustedUntil.toISOString() });
}
