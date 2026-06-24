import { NextResponse } from "next/server";
import { requireInstagramCompany, getCompanyAccount } from "@/lib/instagram-api";

// GET /api/instagram/account → conta IG conectada da empresa (sem token) + link de conexão.
export async function GET() {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const account = await getCompanyAccount(ctx.companyId);
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const connectUrl = `${base.replace(/\/$/, "")}/api/integrations/instagram/connect?companyId=${ctx.companyId}`;

  return NextResponse.json({
    connectUrl,
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
