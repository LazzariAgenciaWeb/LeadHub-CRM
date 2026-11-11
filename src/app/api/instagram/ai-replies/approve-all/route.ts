import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

// POST /api/instagram/ai-replies/approve-all  body: { automationId }
// Aprova todas as respostas esperando aprovação. Saem espaçadas (o worker
// ainda respeita o teto por hora), nunca todas de uma vez.
export async function POST(req: NextRequest) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const b = await req.json().catch(() => ({}));
  const automationId = String(b.automationId || "");
  if (!automationId) return NextResponse.json({ error: "automationId obrigatório" }, { status: 400 });

  const items = await prisma.igAiReply.findMany({
    where: { companyId: ctx.companyId, automationId, status: "AWAITING_APPROVAL", replyText: { not: null } },
    orderBy: [{ likeCount: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  // Espalha: ~1 a cada 40–90s a partir de agora.
  let t = Date.now() + 30_000;
  for (const it of items) {
    t += 40_000 + Math.random() * 50_000;
    await prisma.igAiReply.update({ where: { id: it.id }, data: { status: "SCHEDULED", scheduledAt: new Date(t) } });
  }
  return NextResponse.json({ ok: true, approved: items.length });
}
