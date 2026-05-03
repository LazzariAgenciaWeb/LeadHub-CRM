import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { createChallenge, VAULT_2FA_CONFIG } from "@/lib/vault-2fa";
import { sendMail, vaultChallengeEmail, getSmtpConfig } from "@/lib/email";
import { assertModule } from "@/lib/billing";

// POST /api/vault/challenge
// Body: { credentialId?: string }
//
// Gera código de 6 dígitos, salva HASH no banco, envia para o email do
// usuário logado. Retorna { challengeId, expiresAt, sentTo }.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "cofre");
  if (!gate.ok) return gate.response;

  const userId = (session.user as any)?.id as string;
  if (!userId) return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });

  // Busca email atual do banco — pode ter mudado depois do login
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return NextResponse.json({ error: "Usuário sem email cadastrado" }, { status: 400 });

  // Verifica se SMTP está configurado antes de gastar um challenge
  const cfg = await getSmtpConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "SMTP não configurado. Vá em Configurações → E-mail (SMTP) e preencha os dados." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const credentialId: string | undefined = typeof body.credentialId === "string" ? body.credentialId : undefined;

  // Resolve nome da credencial pra incluir no email (auditoria visual)
  let credentialName: string | undefined;
  if (credentialId) {
    const cred = await prisma.companyCredential.findUnique({
      where: { id: credentialId },
      select: { label: true, asset: { select: { name: true } } },
    });
    if (cred) credentialName = cred.label || cred.asset?.name || undefined;
  }

  const { challengeId, code, expiresAt } = await createChallenge({ userId, credentialId });

  const tpl = vaultChallengeEmail({
    recipientName: user.name ?? user.email.split("@")[0],
    code,
    credentialName,
    expiresInMinutes: VAULT_2FA_CONFIG.CODE_TTL_MIN,
  });

  try {
    await sendMail({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Falha ao enviar email", detail: e?.message ?? "" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    challengeId,
    expiresAt: expiresAt.toISOString(),
    sentTo: maskEmail(user.email),
  });
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  const masked = "*".repeat(Math.max(0, local.length - 2));
  return `${visible}${masked}@${domain}`;
}
