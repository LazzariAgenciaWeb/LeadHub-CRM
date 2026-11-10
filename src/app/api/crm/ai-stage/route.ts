import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { CRM_AI_STAGE_KEY, getCrmAiStageMode } from "@/lib/lead-stage-ai";

/**
 * GET/PUT /api/crm/ai-stage?companyId=  { mode: "off" | "suggest" | "auto" }
 * Modo da IA de etapas do CRM por empresa. Só ADMIN da empresa / SUPER_ADMIN.
 */
async function ctx(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return { error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const role = (session.user as any).role as string;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  const q = req.nextUrl.searchParams.get("companyId");
  const companyId = role === "SUPER_ADMIN" ? (q || (session.user as any).companyId) : (session.user as any).companyId;
  if (!companyId) return { error: NextResponse.json({ error: "Empresa não informada" }, { status: 400 }) };
  return { companyId: companyId as string };
}

export async function GET(req: NextRequest) {
  const c = await ctx(req);
  if ("error" in c) return c.error;
  return NextResponse.json({ mode: await getCrmAiStageMode(c.companyId) });
}

export async function PUT(req: NextRequest) {
  const c = await ctx(req);
  if ("error" in c) return c.error;
  const { mode } = await req.json().catch(() => ({}));
  if (!["off", "suggest", "auto"].includes(mode)) {
    return NextResponse.json({ error: "Modo inválido" }, { status: 400 });
  }
  await prisma.setting.upsert({
    where: { key: CRM_AI_STAGE_KEY(c.companyId) },
    create: { key: CRM_AI_STAGE_KEY(c.companyId), value: mode },
    update: { value: mode },
  });
  return NextResponse.json({ ok: true, mode });
}
