import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncAccountInbox } from "@/lib/imap-inbox";

export const dynamic = "force-dynamic";

/**
 * Poller IMAP — importa emails novos de todas as contas ativas (EmailAccount
 * com imapHost). Chamado pelo loop do start.sh (IMAP_SYNC_INTERVAL_SECONDS,
 * default 180s) ou manualmente por um admin logado.
 */
async function run(req: NextRequest) {
  // Auth: Bearer CRON_SECRET (start.sh) OU sessão SUPER_ADMIN/ADMIN (manual).
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const viaSecret = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  if (!viaSecret) {
    const session = await getServerSession(authOptions);
    const role = (session?.user as any)?.role;
    if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  const accounts = await prisma.emailAccount.findMany({
    where: { active: true, imapHost: { not: null } },
    select: { id: true, companyId: true, fromEmail: true },
    orderBy: { lastSyncedAt: "asc" },
  });

  const summary: { account: string; imported?: number; error?: string }[] = [];
  for (const acc of accounts) {
    try {
      const { imported } = await syncAccountInbox(acc.companyId, acc.id);
      summary.push({ account: acc.fromEmail, imported });
    } catch (e: any) {
      // Uma conta com IMAP fora do ar não pode travar as demais.
      console.error(`[imap-sync] falha conta=${acc.fromEmail}:`, e?.message ?? e);
      summary.push({ account: acc.fromEmail, error: e?.message ?? "erro" });
    }
  }

  return NextResponse.json({
    ok: true,
    accounts: accounts.length,
    imported: summary.reduce((acc, s) => acc + (s.imported ?? 0), 0),
    summary,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
