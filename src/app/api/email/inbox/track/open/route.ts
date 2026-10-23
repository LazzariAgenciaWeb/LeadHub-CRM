import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// GIF transparente 1x1 (43 bytes). Devolvido SEMPRE, inclusive com token
// inválido ou erro no banco — se o pixel falhar, o cliente de email mostra
// ícone de imagem quebrada no meio da mensagem.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

// GET /api/email/inbox/track/open?t=TOKEN
// Rota PÚBLICA (quem abre o email não tem sessão no GoHub) e deliberadamente
// muda: não diz se o token existe, não aceita nada além do token e nunca
// devolve dado do email. O token é opaco e não carrega nada dentro.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (token && token.length <= 64) {
    void registrarAbertura(token).catch(() => null);
  }
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      // Sem cache: cada abertura precisa bater aqui.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

async function registrarAbertura(token: string) {
  const email = await prisma.inboxEmail.findUnique({
    where: { trackToken: token },
    select: { id: true, companyId: true, openedAt: true, leadId: true, toEmail: true, subject: true },
  });
  if (!email) return;

  const agora = new Date();
  await prisma.inboxEmail.update({
    where: { id: email.id },
    data: {
      openCount: { increment: 1 },
      lastOpenedAt: agora,
      ...(email.openedAt ? {} : { openedAt: agora }),
    },
  });

  // Primeira abertura de email ligado a uma negociação entra na timeline do
  // lead — mesmo comportamento da abertura de campanha.
  if (!email.openedAt && email.leadId) {
    await prisma.activity.create({
      data: {
        type: "NOTE_ADDED",
        leadId: email.leadId,
        companyId: email.companyId,
        authorName: "Sistema",
        body: `📧 Abriu o email "${(email.subject || "(sem assunto)").slice(0, 120)}"`,
        meta: { kind: "email_open", inboxEmailId: email.id },
      },
    }).catch(() => null);
  }
}
