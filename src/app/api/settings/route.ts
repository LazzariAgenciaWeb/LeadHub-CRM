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

  const isSuperAdmin  = (session.user as any)?.role === "SUPER_ADMIN";
  const isAdmin       = (session.user as any)?.role === "ADMIN";
  const userCompanyId = (session.user as any)?.companyId as string | undefined;
  const body: { key: string; value: string }[] = await req.json();

  // Chaves globais — só SUPER_ADMIN.
  // ClickUp NÃO entra mais aqui (saiu de global pra per-empresa em 2026-05);
  // chaves `clickup_*:<companyId>` são liberadas pelo regex perCompanyClickupRe
  // abaixo pro ADMIN da empresa correspondente. Chaves antigas sem sufixo
  // (legacy global) ficam órfãs — se alguém tentar gravar, cai aqui e nega.
  const superAdminOnlyKeys = [
    "evolution_base_url",
    "evolution_api_key",
    "openai_api_key",
    "openai_model",
  ];

  // Chaves per-empresa: clickup_*:<companyId> — liberadas pro ADMIN daquela
  // empresa (e SUPER_ADMIN sempre). Cada empresa-cliente pode ter o próprio
  // token, secret e list IDs (sincroniza com o ClickUp dela).
  const perCompanyClickupRe = /^clickup_(api_token|webhook_secret|oportunidades_list_id|tickets_list_id):(.+)$/;

  // Bloqueia gravação nas chaves ClickUp globais legacy — saíram de uso.
  // Existentes ficam órfãs no banco mas não afetam (getClickupSettings ignora).
  const legacyGlobalClickup = new Set([
    "clickup_api_token",
    "clickup_webhook_secret",
    "clickup_oportunidades_list_id",
    "clickup_tickets_list_id",
  ]);

  for (const item of body) {
    if (legacyGlobalClickup.has(item.key)) {
      return NextResponse.json(
        { error: "Configuração ClickUp é per-empresa. Use Configurações → ClickUp dentro da empresa." },
        { status: 400 },
      );
    }
    if (superAdminOnlyKeys.includes(item.key) && !isSuperAdmin) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const perCompany = item.key.match(perCompanyClickupRe);
    if (perCompany) {
      const targetCompanyId = perCompany[2];
      const allowed = isSuperAdmin || (isAdmin && userCompanyId === targetCompanyId);
      if (!allowed) {
        return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
      }
    }
    await prisma.setting.upsert({
      where:  { key: item.key },
      create: { key: item.key, value: item.value },
      update: { value: item.value },
    });
  }

  return NextResponse.json({ ok: true });
}
