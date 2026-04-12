import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Classifica URL pelo domínio
function classifyUrl(url: string | null | undefined) {
  if (!url?.trim()) return null;
  const u = url.toLowerCase();
  if (u.includes("instagram.com"))                          return { icon: "📸", label: "Instagram" };
  if (u.includes("facebook.com") || u.includes("fb.com"))  return { icon: "👥", label: "Facebook" };
  if (u.includes("linkedin.com"))                           return { icon: "💼", label: "LinkedIn" };
  if (u.includes("tiktok.com"))                             return { icon: "🎵", label: "TikTok" };
  if (u.includes("youtube.com") || u.includes("youtu.be")) return { icon: "▶️",  label: "YouTube" };
  if (u.startsWith("http"))                                 return { icon: "🌐", label: "Site" };
  return { icon: "🔗", label: "Link" };
}

function buildNotes(row: Record<string, string>) {
  const parts: string[] = [];
  if (row.mensagens) parts.push(`📨 Mensagem enviada pelo BDR:\n${row.mensagens}`);
  const info: string[] = [];
  if (row.especialidades) info.push(`🏷️ Especialidades: ${row.especialidades}`);
  if (row.rating)         info.push(`⭐ Avaliação: ${row.rating}`);
  if (row.review)         info.push(`💬 Review: ${row.review}`);
  if (info.length)        parts.push(info.join("\n"));
  const digital: string[] = [];
  let hasRealSite = false;
  if (row.site) {
    const c = classifyUrl(row.site);
    if (c) { digital.push(`${c.icon} ${c.label}: ${row.site}`); if (c.label === "Site") hasRealSite = true; }
  }
  if (row.instagram) digital.push(`📸 Instagram: ${row.instagram}`);
  if (row.facebook)  digital.push(`👥 Facebook: ${row.facebook}`);
  if (digital.length) parts.push(digital.join("\n"));
  if (!digital.length)  parts.push("🚀 SEM_PRESENCA_DIGITAL");
  else if (!hasRealSite) parts.push("🚀 SEM_SITE_PROPRIO");
  if (row.disparo) parts.push(`📅 Disparo: ${row.disparo}`);
  return parts.join("\n\n");
}

// POST /api/sync/bdr/import
// Recebe JSON com array de registros (enviado pelo frontend após parse do Excel)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const { records, companyId: bodyCompanyId } = body as {
    records: Record<string, string>[];
    companyId?: string;
  };

  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: "Nenhum registro enviado" }, { status: 400 });
  }

  const userRole     = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const companyId    = userRole === "SUPER_ADMIN" ? (bodyCompanyId ?? userCompanyId) : userCompanyId;

  if (!companyId) return NextResponse.json({ error: "Empresa não identificada" }, { status: 400 });

  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId, pipeline: "PROSPECCAO" },
    orderBy: { order: "asc" },
  });

  let imported = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (const row of records) {
    const phone = String(row.telefone ?? row.phone ?? row.Telefone ?? "").trim();
    const name  = (row.empresa ?? row.name ?? row.Empresa ?? row.Nome ?? "").trim() || null;

    if (!phone) { skipped++; continue; }

    // Evita duplicata pelo telefone + pipeline
    const exists = await prisma.lead.findFirst({
      where: { companyId, phone, pipeline: "PROSPECCAO" },
      select: { id: true },
    });
    if (exists) { skipped++; continue; }

    try {
      await prisma.lead.create({
        data: {
          phone,
          name,
          companyId,
          source:        "bdr",
          status:        "NEW",
          pipeline:      "PROSPECCAO",
          pipelineStage: firstStage?.name ?? null,
          notes:         buildNotes(row) || null,
        },
      });
      imported++;
    } catch (err: any) {
      errors.push(`${phone}: ${err?.message}`);
    }
  }

  return NextResponse.json({ imported, skipped, total: records.length, errors });
}
