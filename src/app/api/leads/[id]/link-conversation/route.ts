import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

/**
 * POST   /api/leads/[id]/link-conversation  { conversationId }
 * DELETE /api/leads/[id]/link-conversation
 *
 * Liga o lead/oportunidade a uma conversa do WhatsApp — contato OU grupo —
 * escolhida na busca. Pensado pro lead que entrou sem telefone e ganha o
 * celular (ou um grupo de negociação) mais tarde.
 *
 * - Lead.conversationId passa a apontar pra conversa (a timeline e a jornada
 *   puxam as mensagens dela, inclusive as que chegarem depois).
 * - Se o lead não tem telefone, herda o da conversa (JID do grupo, se for grupo).
 *   Se já tem, mantém — ex.: celular do cliente + grupo da negociação.
 * - Mensagens dessa conversa SEM lead viram deste lead; as já ligadas a outro
 *   lead ficam onde estão (um grupo pode servir a mais de uma negociação).
 */

async function loadLead(id: string) {
  const session = await getEffectiveSession();
  if (!session) return { error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, phone: true, companyId: true, conversationId: true },
  });
  if (!lead) return { error: NextResponse.json({ error: "Lead não encontrado" }, { status: 404 }) };

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  if (role !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { lead };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadLead(id);
  if ("error" in ctx) return ctx.error;
  const { lead } = ctx;

  const body = await req.json().catch(() => ({}));
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId obrigatório" }, { status: 400 });
  }

  // A conversa tem que ser da MESMA empresa do lead.
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, companyId: lead.companyId },
    select: { id: true, phone: true },
  });
  if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

  const setPhone = !lead.phone?.trim();
  await prisma.lead.update({
    where: { id: lead.id },
    data: { conversationId: conv.id, ...(setPhone ? { phone: conv.phone } : {}) },
  });

  const linked = await prisma.message.updateMany({
    where: { companyId: lead.companyId, phone: conv.phone, leadId: null },
    data: { leadId: lead.id },
  });

  return NextResponse.json({
    ok: true,
    linked: linked.count,
    phone: setPhone ? conv.phone : lead.phone,
    phoneSet: setPhone,
    isGroup: conv.phone.endsWith("@g.us"),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadLead(id);
  if ("error" in ctx) return ctx.error;

  // Só solta o ponteiro da conversa. Telefone e mensagens ficam — desfazer
  // aquilo exigiria saber o que já era do lead antes do vínculo.
  await prisma.lead.update({ where: { id: ctx.lead.id }, data: { conversationId: null } });
  return NextResponse.json({ ok: true });
}
