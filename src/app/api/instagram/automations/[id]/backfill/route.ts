import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { backfillMediaComments } from "@/lib/instagram-ai-replies";

// POST /api/instagram/automations/[id]/backfill
// Puxa os comentários que já existem no post da automação (modo IA) e põe na
// fila da IA — os que ainda não respondemos, mais curtidos primeiro.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;
  const r = await backfillMediaComments(id, ctx.companyId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
