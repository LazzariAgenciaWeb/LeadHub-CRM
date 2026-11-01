import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { parsePref, prefKey } from "@/lib/projetos-view-pref";

// POST /api/projetos/view-pref — salva a combinação atual (visão + agrupar +
// ordenar) como padrão do usuário logado.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const pref = parsePref(await req.json().catch(() => ({})));
  await prisma.setting.upsert({
    where:  { key: prefKey(userId) },
    create: { key: prefKey(userId), value: JSON.stringify(pref) },
    update: { value: JSON.stringify(pref) },
  });
  return NextResponse.json({ ok: true, pref });
}
