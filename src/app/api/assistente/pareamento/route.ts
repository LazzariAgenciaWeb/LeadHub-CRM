import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";
import { createPairingCode } from "@/lib/personal-assistant/whatsapp";
import { syncGroupsIgnore } from "@/lib/personal-assistant/groups";

/**
 * POST   /api/assistente/pareamento → gera código GOHUB-XXXXX (15 min). O
 *        usuário manda o código no grupo do WhatsApp e o webhook vincula.
 * GET    → status do vínculo atual.
 * DELETE → desvincula o grupo.
 */
export async function POST() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const { code, expiresAt } = await createPairingCode(auth.userId);
  return NextResponse.json({ code, expiresAt });
}

export async function GET() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const u = await prisma.user.findUnique({ where: { id: auth.userId }, select: { assistantGroupJid: true, assistantInstanceId: true } });
  const inst = u?.assistantInstanceId
    ? await prisma.whatsappInstance.findUnique({ where: { id: u.assistantInstanceId }, select: { label: true, instanceName: true, phone: true, status: true } })
    : null;
  return NextResponse.json({ linked: !!u?.assistantGroupJid, groupJid: u?.assistantGroupJid ?? null, instance: inst });
}

export async function DELETE() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const before = await prisma.user.findUnique({ where: { id: auth.userId }, select: { assistantInstanceId: true } });
  await prisma.user.update({ where: { id: auth.userId }, data: { assistantGroupJid: null, assistantInstanceId: null } });
  // Sem assistente, "Grupos OFF" volta a ignorar grupos na própria Evolution.
  if (before?.assistantInstanceId) await syncGroupsIgnore(before.assistantInstanceId);
  return NextResponse.json({ ok: true });
}
