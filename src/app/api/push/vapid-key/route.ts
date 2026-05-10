import { NextResponse } from "next/server";

// GET /api/push/vapid-key  → devolve a public key pra UI montar o subscription.
// Lê em RUNTIME (não no build), por isso `NEXT_PUBLIC_*` deixa de ser necessário.
// Sem auth: a chave pública é, por definição, pública (vai aparecer em todo
// browser registrado). A privada nunca sai do servidor.
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ configured: false }, { status: 503 });
  }
  return NextResponse.json({ configured: true, publicKey });
}
