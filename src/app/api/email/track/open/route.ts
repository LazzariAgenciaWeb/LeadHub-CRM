import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// GIF transparente 1x1 (43 bytes). Servido sempre, mesmo em erro — pra não
// quebrar a renderização do email do cliente.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

// GET /api/email/track/open?t=TOKEN  → grava EmailEvent OPEN, devolve pixel
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (token) {
    void recordOpen(token, req).catch(() => null);
  }
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
    },
  });
}

async function recordOpen(token: string, req: NextRequest) {
  const recipient = await prisma.emailRecipient.findUnique({
    where: { token },
    select: { id: true, firstOpenedAt: true, campaignId: true, leadId: true, email: true },
  });
  if (!recipient) return;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  await prisma.emailEvent.create({
    data: { recipientId: recipient.id, type: "OPEN", ipAddress: ip, userAgent: ua },
  });

  // Primeira abertura: marca no recipient + incrementa contador da campanha
  if (!recipient.firstOpenedAt) {
    await prisma.$transaction([
      prisma.emailRecipient.update({
        where: { id: recipient.id },
        data: { firstOpenedAt: new Date() },
      }),
      prisma.emailCampaign.update({
        where: { id: recipient.campaignId },
        data: { openedCount: { increment: 1 } },
      }),
    ]).catch(() => null);

    // Cria Activity na timeline do lead (se vinculado)
    if (recipient.leadId) {
      await prisma.activity.create({
        data: {
          type: "NOTE_ADDED",
          leadId: recipient.leadId,
          companyId: (await prisma.lead.findUnique({ where: { id: recipient.leadId }, select: { companyId: true } }))?.companyId ?? "",
          authorName: "Sistema",
          body: `📧 Abriu o email da campanha`,
          meta: { kind: "email_open", recipientId: recipient.id },
        },
      }).catch(() => null);
    }
  }
}
