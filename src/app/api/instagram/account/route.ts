import { NextResponse } from "next/server";
import { requireInstagramCompany, getCompanyAccount } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

// GET /api/instagram/account → conta IG conectada da empresa (sem token) + link de conexão.
export async function GET() {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const account = await getCompanyAccount(ctx.companyId);
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const root = base.replace(/\/$/, "");
  const connectUrl = `${root}/api/integrations/instagram/connect?companyId=${ctx.companyId}`;
  const fbConnectUrl = `${root}/api/integrations/facebook/connect?companyId=${ctx.companyId}`;

  const facebookPages = await prisma.facebookPage.findMany({
    where: { companyId: ctx.companyId },
    select: { id: true, pageId: true, name: true, status: true },
  });

  return NextResponse.json({
    connectUrl,
    fbConnectUrl,
    facebookPages,
    account: account
      ? {
          id: account.id,
          username: account.username,
          name: account.name,
          profilePictureUrl: account.profilePictureUrl,
          status: account.status,
          tokenExpiresAt: account.tokenExpiresAt,
        }
      : null,
  });
}
