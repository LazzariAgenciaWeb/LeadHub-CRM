import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Instâncias de WhatsApp que o SUPER_ADMIN vê na visão global (/whatsapp sem
 * impersonar). Preferência pessoal da conta dele — serve pra tirar da caixa
 * global as instâncias que ele não acompanha e deixar a lista mais leve.
 *
 * GET   → todas as instâncias (todas as empresas) com flag `hidden`
 * PATCH → { hiddenIds: string[] } substitui a lista inteira
 */
async function superAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") return null;
  return session;
}

export async function GET() {
  const session = await superAdmin();
  if (!session) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const userId = (session.user as any).id as string;

  const [instances, user] = await Promise.all([
    prisma.whatsappInstance.findMany({
      where: { ownerUserId: null }, // privadas de outro dono nunca aparecem — nem pra escolher
      orderBy: [{ company: { name: "asc" } }, { label: "asc" }, { instanceName: "asc" }],
      select: {
        id: true, instanceName: true, label: true, phone: true, status: true,
        company: { select: { id: true, name: true } },
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { hiddenWaInstanceIds: true } }),
  ]);
  const hidden = new Set(user?.hiddenWaInstanceIds ?? []);
  return NextResponse.json(instances.map((i) => ({ ...i, hidden: hidden.has(i.id) })));
}

export async function PATCH(req: NextRequest) {
  const session = await superAdmin();
  if (!session) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const userId = (session.user as any).id as string;

  const body = await req.json().catch(() => ({}));
  const hiddenIds = Array.isArray(body?.hiddenIds)
    ? [...new Set((body.hiddenIds as unknown[]).filter((x): x is string => typeof x === "string"))]
    : null;
  if (!hiddenIds) return NextResponse.json({ error: "hiddenIds inválido" }, { status: 400 });

  await prisma.user.update({ where: { id: userId }, data: { hiddenWaInstanceIds: hiddenIds } });
  return NextResponse.json({ ok: true, hiddenIds });
}
