import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";

export const runtime = "nodejs";

// POST /api/auth/forgot-password { email }
// Gera um token de redefinição, guarda o HASH + validade (1h) e envia o link por
// email. SEMPRE responde { ok: true } — não revela se o email existe (evita
// enumeração de contas). Falha no envio também não vaza.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim();
  const generic = NextResponse.json({ ok: true });
  if (!email) return generic;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  if (!user) return generic;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: tokenHash, passwordResetExpires: expires },
  });

  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const link = `${base}/redefinir-senha?token=${rawToken}`;
  const nome = user.name?.split(" ")[0] || "";

  try {
    await sendMail({
      to: user.email,
      subject: "Redefinir sua senha — LeadHub",
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2733">
          <h2 style="margin:0 0 6px">Redefinir sua senha</h2>
          <p style="color:#5b6470;font-size:14px;line-height:1.6">Olá${nome ? ` ${nome}` : ""}, recebemos um pedido para redefinir a senha da sua conta LeadHub. Clique no botão abaixo para escolher uma nova senha:</p>
          <p style="margin:22px 0">
            <a href="${link}" style="background:linear-gradient(135deg,#6E86FF,#9B7BFF);color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;display:inline-block">Redefinir senha</a>
          </p>
          <p style="color:#8a929e;font-size:12.5px;line-height:1.6">Este link expira em 1 hora. Se você não pediu isso, pode ignorar este email — sua senha continua a mesma.</p>
          <p style="color:#aab0ba;font-size:11.5px;word-break:break-all">Se o botão não funcionar, copie e cole este endereço no navegador:<br>${link}</p>
        </div>`,
    });
  } catch {
    // Não revela falha de envio ao cliente.
  }

  return generic;
}
