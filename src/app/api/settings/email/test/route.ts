import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { sendMail, verifySmtp, vaultChallengeEmail } from "@/lib/email";

// POST /api/settings/email/test
// Body: { to?: string }   default: email do usuário logado
//
// 1) Verifica conexão SMTP (transport.verify)
// 2) Manda um e-mail de teste com o template do cofre
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const role = (session.user as any)?.role;
  if (role !== "SUPER_ADMIN") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const to = (body.to as string) || (session.user?.email as string | undefined);
  if (!to) return NextResponse.json({ error: "email destinatário ausente" }, { status: 400 });

  const v = await verifySmtp();
  if (!v.ok) return NextResponse.json({ ok: false, step: "verify", error: v.error }, { status: 502 });

  try {
    const tpl = vaultChallengeEmail({
      recipientName: session.user?.name ?? "Usuário",
      code: "123456",
      credentialName: "(teste de configuração)",
      expiresInMinutes: 5,
    });
    await sendMail({ to, subject: tpl.subject + " (TESTE)", html: tpl.html, text: tpl.text });
    return NextResponse.json({ ok: true, sentTo: to });
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: "send", error: e?.message ?? "Erro" }, { status: 502 });
  }
}
