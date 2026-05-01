import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { tokenCrypto } from "@/lib/google-oauth";

// DELETE /api/calendar/google/disconnect
//
// Revoga o token no Google e remove a conexão do banco.
export async function DELETE(_req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any)?.id as string;
  const conn = await prisma.userGoogleConnection.findUnique({
    where: { userId_service: { userId, service: "calendar" } },
    select: { id: true, accessTokenEnc: true, refreshTokenEnc: true },
  });

  if (!conn) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  // Best-effort: revoga no Google
  const tokenToRevoke = tokenCrypto.decrypt(conn.refreshTokenEnc) || tokenCrypto.decrypt(conn.accessTokenEnc);
  if (tokenToRevoke) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => { /* não crítico */ });
  }

  await prisma.userGoogleConnection.delete({ where: { id: conn.id } });
  return NextResponse.json({ ok: true });
}
