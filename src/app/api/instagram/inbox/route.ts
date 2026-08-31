import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";
import { decryptAccountToken, getIgUserProfile } from "@/lib/instagram";

// GET /api/instagram/inbox?filter=needsReply → conversas de DM da empresa.
export async function GET(req: NextRequest) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const needsReply = new URL(req.url).searchParams.get("filter") === "needsReply";

  const conversations = await prisma.igConversation.findMany({
    where: { companyId: ctx.companyId, ...(needsReply ? { needsReply: true } : {}) },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      channel: true,
      accountId: true,
      participantId: true,
      participantUsername: true,
      lastMessageText: true,
      lastMessageAt: true,
      lastDirection: true,
      needsReply: true,
      hadAutomation: true,
    },
  });

  // Backfill do @: conversas nascidas de echo (DM que NÓS mandamos primeiro,
  // ex. prospecção) entram sem username e a lista mostraria o IGSID cru. A API
  // de perfil só responde dentro da janela de mensagens, então só tenta as
  // recentes — e poucas por vez, pra não pesar a listagem.
  const missing = conversations.filter(
    (c) => c.channel === "INSTAGRAM" && !c.participantUsername && isRecent(c.lastMessageAt)
  );
  if (missing.length > 0) {
    const resolved = await resolveUsernames(missing.slice(0, 12));
    for (const c of conversations) {
      const uname = resolved.get(c.id);
      if (uname) c.participantUsername = uname;
    }
  }

  const pending = await prisma.igConversation.count({ where: { companyId: ctx.companyId, needsReply: true } });
  return NextResponse.json({ count: conversations.length, pending, conversations });
}

/** Janela em que a API de perfil ainda resolve o IGSID. */
function isRecent(lastMessageAt: Date | null): boolean {
  if (!lastMessageAt) return false;
  return Date.now() - lastMessageAt.getTime() < 30 * 24 * 60 * 60 * 1000;
}

/** Busca o @ de cada conversa e grava. Best-effort: falha é silenciosa. */
async function resolveUsernames(
  convos: { id: string; accountId: string | null; participantId: string }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const accountIds = Array.from(new Set(convos.map((c) => c.accountId).filter((a): a is string => !!a)));
  if (accountIds.length === 0) return out;

  const accounts = await prisma.instagramAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, accessTokenEnc: true },
  });
  const tokenById = new Map(accounts.map((a) => [a.id, decryptAccountToken(a.accessTokenEnc)]));

  await Promise.all(
    convos.map(async (c) => {
      const token = c.accountId ? tokenById.get(c.accountId) : null;
      if (!token) return;
      try {
        const prof = await getIgUserProfile(c.participantId, token);
        const uname = prof.username ?? prof.name ?? null;
        if (!uname) return;
        await prisma.igConversation.update({ where: { id: c.id }, data: { participantUsername: uname } });
        out.set(c.id, uname);
      } catch {
        // Perfil fora da janela ou apagado — segue mostrando o id.
      }
    })
  );
  return out;
}
