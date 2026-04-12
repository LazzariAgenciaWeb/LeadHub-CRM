import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/sync/bdr
// Sincroniza prospects do Supabase (BDR) para o pipeline PROSPECCAO
// Chamado pelo cron job diário no start.sh
export async function POST(req: NextRequest) {
  // Verificação simples de segurança via token no header
  const authHeader = req.headers.get("authorization");
  const syncSecret = process.env.SYNC_SECRET ?? "leadhub-sync-secret";
  if (authHeader !== `Bearer ${syncSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const companyId = process.env.BDR_SYNC_COMPANY_ID;
  if (!companyId) {
    return NextResponse.json({ error: "BDR_SYNC_COMPANY_ID não configurado" }, { status: 500 });
  }

  const supabaseUrl = process.env.SUPABASE_BDR_URL ?? "https://mlrawqrovbwxocxdxaoj.supabase.co";
  const supabaseKey = process.env.SUPABASE_BDR_KEY ?? "sb_publishable_cddcnE0EKbUZ5ERwD7Hp4g_vUcZKHsT";
  const tableName = "leadsProspectaIA";

  // Busca todos os registros do Supabase ordenados por data
  const supabaseRes = await fetch(
    `${supabaseUrl}/rest/v1/${tableName}?select=*&order=created_at.asc`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!supabaseRes.ok) {
    const err = await supabaseRes.text();
    console.error("[BDR Sync] Erro ao buscar do Supabase:", err);
    return NextResponse.json({ error: "Falha ao buscar dados do Supabase", detail: err }, { status: 502 });
  }

  const records: any[] = await supabaseRes.json();
  console.log(`[BDR Sync] ${records.length} registros encontrados no Supabase`);

  // Busca IDs externos já importados para evitar duplicatas
  const existingLeads = await prisma.lead.findMany({
    where: { companyId, pipeline: "PROSPECCAO", externalId: { not: null } },
    select: { externalId: true },
  });
  const existingExternalIds = new Set(existingLeads.map((l) => l.externalId));

  // Busca primeira etapa do pipeline PROSPECCAO para esta empresa
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId, pipeline: "PROSPECCAO" },
    orderBy: { order: "asc" },
  });

  let imported = 0;
  let skipped = 0;

  for (const record of records) {
    const externalId = String(record.id);

    if (existingExternalIds.has(externalId)) {
      skipped++;
      continue;
    }

    // Monta notas com informações extras do registro
    const noteLines: string[] = [];
    if (record.rating) noteLines.push(`⭐ Rating: ${record.rating}`);
    if (record.review) noteLines.push(`💬 Review: ${record.review}`);
    if (record.especialidades) noteLines.push(`🏷️ Especialidades: ${record.especialidades}`);
    if (record.site) noteLines.push(`🌐 Site: ${record.site}`);
    if (record.mensagens) noteLines.push(`📨 Mensagens BDR: ${record.mensagens}`);
    if (record.disparo) noteLines.push(`📅 Disparo: ${record.disparo}`);

    const notes = noteLines.join("\n");

    try {
      await prisma.lead.create({
        data: {
          phone: String(record.telefone ?? ""),
          name: record.empresa ?? null,
          companyId,
          source: "bdr",
          status: "NEW",
          pipeline: "PROSPECCAO",
          pipelineStage: firstStage?.name ?? null,
          externalId,
          notes: notes || null,
        },
      });
      imported++;
    } catch (err: any) {
      // Ignora conflitos de phone duplicado se houver unique constraint
      console.warn(`[BDR Sync] Erro ao importar ${externalId}:`, err?.message);
    }
  }

  console.log(`[BDR Sync] Concluído: ${imported} importados, ${skipped} ignorados (já existiam)`);
  return NextResponse.json({ imported, skipped, total: records.length });
}

// GET /api/sync/bdr — status / trigger manual via browser (requer token)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const syncSecret = process.env.SYNC_SECRET ?? "leadhub-sync-secret";

  if (token !== syncSecret) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Redireciona para POST internamente
  const postReq = new Request(req.url, {
    method: "POST",
    headers: { authorization: `Bearer ${syncSecret}` },
  });
  return POST(postReq as NextRequest);
}
