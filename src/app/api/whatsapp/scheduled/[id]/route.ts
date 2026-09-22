import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// DELETE /api/whatsapp/scheduled/[id] → cancela uma mensagem agendada manual.
// Só enquanto PENDING (ou FAILED, pra limpar da lista) — a que já está sendo
// enviada (SENDING) não dá mais pra cancelar.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const { id } = await params;

  const msg = await prisma.scheduledMessage.findUnique({
    where: { id },
    select: { companyId: true, kind: true, status: true },
  });
  if (!msg || msg.kind !== "manual") return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && msg.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const r = await prisma.scheduledMessage.updateMany({
    where: { id, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "CANCELED" },
  });
  if (r.count === 0) {
    return NextResponse.json({ error: "Já está sendo enviada — não dá mais pra cancelar" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
