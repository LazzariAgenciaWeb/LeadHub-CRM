import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

// GET /api/email/campaigns/[id]/recipients?page=1&pageSize=50&filter=all|sent|opened|clicked|bounced|failed|pending
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role = session.user.role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const campaign = await prisma.emailCampaign.findUnique({
    where: { id }, select: { companyId: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && campaign.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "50", 10)));
  const filter = url.searchParams.get("filter") ?? "all";

  const where: any = { campaignId: id };
  switch (filter) {
    case "sent":     where.status = "SENT"; break;
    case "opened":   where.firstOpenedAt = { not: null }; break;
    case "clicked":  where.firstClickedAt = { not: null }; break;
    case "bounced":  where.status = "BOUNCED"; break;
    case "failed":   where.status = "FAILED"; break;
    case "pending":  where.status = { in: ["PENDING", "SENDING"] }; break;
  }

  const [total, rows] = await Promise.all([
    prisma.emailRecipient.count({ where }),
    prisma.emailRecipient.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, email: true, name: true, status: true,
        sentAt: true, firstOpenedAt: true, firstClickedAt: true, bouncedAt: true,
        errorMessage: true, leadId: true,
        lead: { select: { id: true, name: true, phone: true, pipeline: true } },
        events: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, type: true, targetUrl: true, createdAt: true },
        },
        _count: { select: { events: true } },
      },
    }),
  ]);

  return NextResponse.json({ page, pageSize, total, rows });
}
