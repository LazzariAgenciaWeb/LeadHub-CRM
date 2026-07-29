import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// POST /api/auth/reset-password { token, password }
// Valida o token (hash + validade), define a nova senha e limpa o token.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawToken = String(body?.token ?? "").trim();
  const password = String(body?.password ?? "");

  if (!rawToken) return NextResponse.json({ error: "Link inválido." }, { status: 400 });
  if (password.length < 6) {
    return NextResponse.json({ error: "A senha precisa ter ao menos 6 caracteres." }, { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const user = await prisma.user.findFirst({
    where: { passwordResetToken: tokenHash, passwordResetExpires: { gt: new Date() } },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Link inválido ou expirado. Peça um novo." }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hash, passwordResetToken: null, passwordResetExpires: null },
  });

  return NextResponse.json({ ok: true });
}
