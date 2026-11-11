import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";
import { regenerateReply } from "@/lib/instagram-ai-replies";

/** Pequena espera antes de publicar o que foi aprovado (não sai tudo junto). */
function soon(index = 0): Date {
  return new Date(Date.now() + 30_000 + index * 20_000 + Math.random() * 60_000);
}

// PATCH /api/instagram/ai-replies/[id]
// body: { action: "approve" | "skip" | "retry" | "regenerate", replyText?: string }
//   approve    → publica (com o texto editado, se veio) em ~1 min
//   skip       → não responde
//   retry      → volta pra fila da IA (itens com falha)
//   regenerate → a IA escreve outra resposta (continua esperando aprovação)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const item = await prisma.igAiReply.findFirst({ where: { id, companyId: ctx.companyId }, select: { id: true, status: true, replyText: true } });
  if (!item) return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "");

  if (action === "approve") {
    if (item.status === "SENT") return NextResponse.json({ error: "Já foi publicada" }, { status: 409 });
    const text = typeof b.replyText === "string" ? b.replyText.trim().slice(0, 300) : item.replyText?.trim();
    if (!text) return NextResponse.json({ error: "Escreva a resposta antes de aprovar" }, { status: 400 });
    await prisma.igAiReply.update({
      where: { id },
      data: { replyText: text, status: "SCHEDULED", scheduledAt: soon(), errorDetail: null },
    });
    return NextResponse.json({ ok: true });
  }
  if (action === "skip") {
    if (item.status === "SENT") return NextResponse.json({ error: "Já foi publicada" }, { status: 409 });
    await prisma.igAiReply.update({ where: { id }, data: { status: "SKIPPED", reason: "Pulado por você" } });
    return NextResponse.json({ ok: true });
  }
  if (action === "retry") {
    await prisma.igAiReply.update({ where: { id }, data: { status: "QUEUED", errorDetail: null, sentAt: null } });
    return NextResponse.json({ ok: true });
  }
  if (action === "regenerate") {
    const r = await regenerateReply(id, ctx.companyId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, replyText: r.replyText });
  }
  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
