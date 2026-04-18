import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/settings
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const settings = await prisma.setting.findMany();
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;
  return NextResponse.json(map);
}

// PUT /api/settings  — body: { key: string, value: string }[]
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const body: { key: string; value: string }[] = await req.json();

  // Apenas SUPER_ADMIN pode gravar chaves de integração
  const integrationKeys = [
    "evolution_base_url",
    "evolution_api_key",
    "clickup_api_token",
    "clickup_oportunidades_list_id",
    "clickup_tickets_list_id",
    "openai_api_key",
    "openai_model",
  ];
  for (const item of body) {
    if (integrationKeys.includes(item.key) && !isSuperAdmin) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    await prisma.setting.upsert({
      where: { key: item.key },
      create: { key: item.key, value: item.value },
      update: { value: item.value },
    });
  }

  return NextResponse.json({ ok: true });
}
