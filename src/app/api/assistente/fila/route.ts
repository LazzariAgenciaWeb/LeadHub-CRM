import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";
import { buildFilaDoDia } from "@/lib/assistant-tools/registry";

/** GET /api/assistente/fila → fila de próximas ações do usuário logado. */
export async function GET() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { companyId: true, role: true } });
  if (!me?.companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });
  const fila = await buildFilaDoDia({ userId: auth.userId, companyId: me.companyId, isManager: me.role !== "CLIENT" });
  return NextResponse.json(fila);
}
