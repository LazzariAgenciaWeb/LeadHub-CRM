import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/lib/email-render";
import { injectTracking } from "@/lib/email-tracking";

// GET /api/email/campaigns/[id]/recipients/[recipientId]/preview
// Re-renderiza o email exatamente como foi enviado (template atual + vars snapshot
// do recipient). Não dispara nada. Inclui pixel + footer pra fidelidade visual.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id, recipientId } = await params;
  const role = session.user.role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const recipient = await prisma.emailRecipient.findUnique({
    where: { id: recipientId },
    select: {
      id: true, campaignId: true, email: true, name: true, vars: true, token: true,
      sentAt: true, status: true,
      campaign: {
        select: {
          id: true, companyId: true, subject: true,
          template: { select: { subject: true, html: true, text: true } },
        },
      },
    },
  });
  if (!recipient || recipient.campaignId !== id) {
    return NextResponse.json({ error: "Destinatário não encontrado" }, { status: 404 });
  }
  if (role !== "SUPER_ADMIN" && recipient.campaign.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tpl = recipient.campaign.template;
  const rendered = renderTemplate(
    { subject: recipient.campaign.subject || tpl.subject, html: tpl.html, text: tpl.text },
    (recipient.vars ?? {}) as Record<string, any>
  );
  const tracked = injectTracking(rendered.html, recipient.token);

  return NextResponse.json({
    to: recipient.email,
    toName: recipient.name,
    subject: rendered.subject,
    html: tracked.html,
    sentAt: recipient.sentAt,
    status: recipient.status,
  });
}
