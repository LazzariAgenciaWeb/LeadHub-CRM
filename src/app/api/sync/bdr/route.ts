import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SUPABASE_URL = "https://mlrawqrovbwxocxdxaoj.supabase.co";
const SUPABASE_KEY = "sb_publishable_cddcnE0EKbUZ5ERwD7Hp4g_vUcZKHsT";
const TABLE_NAME   = "leadsProspectaIA";

type UrlType = "site" | "instagram" | "facebook" | "linkedin" | "tiktok" | "youtube" | "outro";

function classifyUrl(url: string | null | undefined): UrlType | null {
  if (!url?.trim()) return null;
  const u = url.toLowerCase();
  if (u.includes("instagram.com"))                      return "instagram";
  if (u.includes("facebook.com") || u.includes("fb.com") || u.includes("fb.me")) return "facebook";
  if (u.includes("linkedin.com"))                       return "linkedin";
  if (u.includes("tiktok.com"))                         return "tiktok";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.startsWith("http"))                             return "site";
  return "outro";
}

const URL_ICON: Record<UrlType, string> = {
  site:      "🌐",
  instagram: "📸",
  facebook:  "👥",
  linkedin:  "💼",
  tiktok:    "🎵",
  youtube:   "▶️",
  outro:     "🔗",
};

const URL_LABEL: Record<UrlType, string> = {
  site:      "Site",
  instagram: "Instagram",
  facebook:  "Facebook",
  linkedin:  "LinkedIn",
  tiktok:    "TikTok",
  youtube:   "YouTube",
  outro:     "Link",
};

function buildNotes(record: any): string {
  const parts: string[] = [];

  // Mensagem enviada pelo BDR em destaque
  if (record.mensagens) {
    parts.push(`📨 Mensagem enviada pelo BDR:\n${record.mensagens}`);
  }

  // Informações do negócio
  const info: string[] = [];
  if (record.especialidades) info.push(`🏷️ Especialidades: ${record.especialidades}`);
  if (record.rating)         info.push(`⭐ Avaliação: ${record.rating}`);
  if (record.review)         info.push(`💬 Review: ${record.review}`);
  if (info.length)           parts.push(info.join("\n"));

  // Presença digital — classifica cada URL corretamente
  const digital: string[] = [];
  let hasRealSite = false;

  // O campo "site" do Supabase pode ser qualquer URL — detectar o tipo
  if (record.site) {
    const type = classifyUrl(record.site);
    if (type) {
      digital.push(`${URL_ICON[type]} ${URL_LABEL[type]}: ${record.site}`);
      if (type === "site" || type === "outro") hasRealSite = true;
    }
  }

  // Campos extras de redes sociais (caso existam na tabela)
  if (record.instagram) {
    const type = classifyUrl(record.instagram) ?? "instagram";
    digital.push(`${URL_ICON[type]} ${URL_LABEL[type]}: ${record.instagram}`);
  }
  if (record.facebook) {
    const type = classifyUrl(record.facebook) ?? "facebook";
    digital.push(`${URL_ICON[type]} ${URL_LABEL[type]}: ${record.facebook}`);
  }
  if (record.linkedin) digital.push(`💼 LinkedIn: ${record.linkedin}`);

  if (digital.length) {
    parts.push(digital.join("\n"));
  }

  // Tag de oportunidade para empresa sem site próprio
  if (digital.length === 0) {
    parts.push(`🚀 SEM_PRESENCA_DIGITAL`);
  } else if (!hasRealSite) {
    parts.push(`🚀 SEM_SITE_PROPRIO`);
  }

  if (record.disparo) parts.push(`📅 Disparo: ${record.disparo}`);

  return parts.join("\n\n");
}

async function runSync(companyId: string) {
  const supabaseUrl = process.env.SUPABASE_BDR_URL ?? SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_BDR_KEY ?? SUPABASE_KEY;

  const supabaseRes = await fetch(
    `${supabaseUrl}/rest/v1/${TABLE_NAME}?select=*&order=created_at.asc`,
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
    throw new Error(`Falha ao buscar dados do Supabase: ${err}`);
  }

  const records: any[] = await supabaseRes.json();
  console.log(`[BDR Sync] ${records.length} registros encontrados`);

  const existingLeads = await prisma.lead.findMany({
    where: { companyId, pipeline: "PROSPECCAO", externalId: { not: null } },
    select: { externalId: true },
  });
  const existingIds = new Set(existingLeads.map((l) => l.externalId));

  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId, pipeline: "PROSPECCAO" },
    orderBy: { order: "asc" },
  });

  let imported = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (const record of records) {
    const externalId = String(record.id);
    if (existingIds.has(externalId)) { skipped++; continue; }

    try {
      await prisma.lead.create({
        data: {
          phone:         String(record.telefone ?? "sem-telefone"),
          name:          record.empresa ?? null,
          companyId,
          source:        "bdr",
          status:        "NEW",
          pipeline:      "PROSPECCAO",
          pipelineStage: firstStage?.name ?? null,
          externalId,
          notes:         buildNotes(record) || null,
        },
      });
      imported++;
    } catch (err: any) {
      console.warn(`[BDR Sync] Erro ao importar ${externalId}:`, err?.message);
      errors.push(`${externalId}: ${err?.message}`);
    }
  }

  console.log(`[BDR Sync] ${imported} importados, ${skipped} ignorados`);
  return { imported, skipped, total: records.length, errors };
}

// POST /api/sync/bdr
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const syncSecret = process.env.SYNC_SECRET ?? "leadhub-sync-secret";

  const isCron  = authHeader === `Bearer ${syncSecret}`;
  const session = isCron ? null : await getServerSession(authOptions);
  const isAdmin = session && ["SUPER_ADMIN", "ADMIN"].includes((session.user as any)?.role);

  if (!isCron && !isAdmin) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = req.headers.get("content-type")?.includes("json")
    ? await req.json().catch(() => ({}))
    : {};

  const companyId =
    body.companyId ??
    process.env.BDR_SYNC_COMPANY_ID ??
    (session ? (session.user as any)?.companyId : null);

  if (!companyId) {
    return NextResponse.json({ error: "companyId não informado" }, { status: 400 });
  }

  try {
    const result = await runSync(companyId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

// GET /api/sync/bdr?token=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token      = searchParams.get("token");
  const syncSecret = process.env.SYNC_SECRET ?? "leadhub-sync-secret";

  if (token !== syncSecret) {
    return NextResponse.json({ error: "Não autorizado. Use ?token=<SYNC_SECRET>" }, { status: 401 });
  }

  const companyId = searchParams.get("companyId") ?? process.env.BDR_SYNC_COMPANY_ID;
  if (!companyId) {
    return NextResponse.json({ error: "Passe ?companyId= ou configure BDR_SYNC_COMPANY_ID" }, { status: 400 });
  }

  try {
    const result = await runSync(companyId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
