import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/push/subscribe { endpoint, p256dh, auth, userAgent? }
// Salva (ou atualiza) a PushSubscription do user logado real (não impersonado).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const { endpoint, p256dh, auth, userAgent } = await req.json();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Subscription incompleta" }, { status: 400 });
  }

  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh, auth, userAgent: userAgent ?? null, userId },
    update: { p256dh, auth, userAgent: userAgent ?? null, userId, lastFailedAt: null, failCount: 0 },
  });
  return NextResponse.json({ ok: true, id: sub.id });
}

// DELETE /api/push/subscribe { endpoint }
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const { endpoint } = await req.json();
  if (!endpoint) return NextResponse.json({ error: "endpoint obrigatório" }, { status: 400 });

  await prisma.pushSubscription
    .deleteMany({ where: { endpoint, userId } })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
