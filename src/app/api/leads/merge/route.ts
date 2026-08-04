import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/leads/merge
 *
 * Funde 2+ leads/oportunidades duplicados num só registro. Body:
 *   { leadIds: string[], primaryId?: string }
 *
 * - `primaryId` (opcional): qual registro sobrevive. Se omitido, escolhe pelo
 *   funil (Oportunidade > Lead > Prospecção) → tem conversa → mais antigo.
 * - Todos os filhos (mensagens, comentários, atividades, tarefas, tags, campos
 *   custom, destinatários de email) são reassociados ao sobrevivente.
 * - Campos vazios do sobrevivente são preenchidos com dados dos demais.
 * - Os leads perdedores são deletados (cascade limpa join rows restantes).
 *
 * Gate: cliente só funde leads da própria empresa; todos precisam ser da MESMA
 * empresa (não faz sentido fundir leads de empresas diferentes).
 */

const PIPELINE_RANK: Record<string, number> = { OPORTUNIDADES: 3, LEADS: 2, PROSPECCAO: 1 };

// Campos escalares preenchidos por "gap-fill" (só quando o sobrevivente está vazio).
// pipeline/pipelineStage NÃO entram — o sobrevivente já foi escolhido pelo melhor funil.
const GAP_FILL_FIELDS = [
  "name", "email", "value", "notes", "source",
  "website", "instagram", "facebook", "address", "city", "segment", "hasWhatsapp",
  "clickupTaskId", "conversationId", "trackingLinkId", "campaignId",
  "expectedReturnAt", "attendanceStatus",
  "diagnosis", "diagnosisAt", "diagnosisSource", "diagnosisToken", "diagnosisClickedAt",
  "fbc", "fbp", "eventSourceUrl", "clientIp", "clientUserAgent",
  "externalId",
] as const;

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = role === "SUPER_ADMIN";

  const body = await req.json().catch(() => ({}));
  const leadIds: string[] = Array.isArray(body.leadIds)
    ? [...new Set(body.leadIds.filter((x: any) => typeof x === "string"))] as string[]
    : [];
  const primaryIdInput = typeof body.primaryId === "string" ? body.primaryId : null;

  if (leadIds.length < 2) {
    return NextResponse.json({ error: "Selecione ao menos 2 leads para mesclar" }, { status: 400 });
  }
  if (leadIds.length > 25) {
    return NextResponse.json({ error: "Máximo de 25 leads por mesclagem" }, { status: 400 });
  }

  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } } });
  if (leads.length < 2) {
    return NextResponse.json({ error: "Leads não encontrados" }, { status: 404 });
  }

  // Gate de empresa: todos da mesma empresa; cliente só mexe na própria.
  const companyIds = new Set(leads.map((l) => l.companyId));
  if (companyIds.size > 1) {
    return NextResponse.json({ error: "Os leads são de empresas diferentes" }, { status: 400 });
  }
  const companyId = leads[0].companyId;
  if (!isSuperAdmin && companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão para esses leads" }, { status: 403 });
  }

  // ── Escolhe o sobrevivente ────────────────────────────────────────────────
  const ranked = [...leads].sort((a, b) => {
    const pr = (PIPELINE_RANK[b.pipeline ?? ""] ?? 0) - (PIPELINE_RANK[a.pipeline ?? ""] ?? 0);
    if (pr !== 0) return pr;
    const conv = (b.conversationId ? 1 : 0) - (a.conversationId ? 1 : 0);
    if (conv !== 0) return conv;
    return a.createdAt.getTime() - b.createdAt.getTime(); // mais antigo primeiro
  });
  const primary = primaryIdInput
    ? leads.find((l) => l.id === primaryIdInput) ?? ranked[0]
    : ranked[0];
  const losers = leads.filter((l) => l.id !== primary.id);
  const loserIds = losers.map((l) => l.id);

  // Gap-fill: percorre perdedores na ordem de ranking (melhor primeiro).
  const fillOrder = ranked.filter((l) => l.id !== primary.id);
  const patch: Record<string, any> = {};
  for (const field of GAP_FILL_FIELDS) {
    if ((primary as any)[field] != null) continue;
    for (const loser of fillOrder) {
      const v = (loser as any)[field];
      if (v != null) { patch[field] = v; break; }
    }
  }
  // diagnosisToken é @unique — como os perdedores são deletados no fim da
  // transação (antes do update do primary), não há colisão.

  // Tags e custom fields do sobrevivente (pra evitar conflito de unique).
  const [primaryTags, loserTags, primaryCV, loserCV] = await Promise.all([
    prisma.leadTag.findMany({ where: { leadId: primary.id }, select: { tagId: true } }),
    prisma.leadTag.findMany({ where: { leadId: { in: loserIds } }, select: { tagId: true } }),
    prisma.leadCustomValue.findMany({ where: { leadId: primary.id }, select: { fieldId: true } }),
    prisma.leadCustomValue.findMany({ where: { leadId: { in: loserIds } }, select: { fieldId: true, value: true, createdAt: true } }),
  ]);
  const primaryTagIds = new Set(primaryTags.map((t) => t.tagId));
  const newTagIds = [...new Set(loserTags.map((t) => t.tagId))].filter((id) => !primaryTagIds.has(id));

  const primaryFieldIds = new Set(primaryCV.map((c) => c.fieldId));
  const seenFieldIds = new Set(primaryFieldIds);
  const newCustomValues: { leadId: string; fieldId: string; value: string }[] = [];
  for (const cv of loserCV.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (seenFieldIds.has(cv.fieldId)) continue;
    seenFieldIds.add(cv.fieldId);
    newCustomValues.push({ leadId: primary.id, fieldId: cv.fieldId, value: cv.value });
  }

  await prisma.$transaction(async (tx) => {
    // 1. Reassocia filhos "simples" (sem constraint de unique por lead).
    await Promise.all([
      tx.message.updateMany({ where: { leadId: { in: loserIds } }, data: { leadId: primary.id } }),
      tx.leadComment.updateMany({ where: { leadId: { in: loserIds } }, data: { leadId: primary.id } }),
      tx.activity.updateMany({ where: { leadId: { in: loserIds } }, data: { leadId: primary.id } }),
      tx.task.updateMany({ where: { leadId: { in: loserIds } }, data: { leadId: primary.id } }),
      tx.emailRecipient.updateMany({ where: { leadId: { in: loserIds } }, data: { leadId: primary.id } }),
    ]);

    // 2. Tags e custom values sem duplicar (constraints de unique).
    if (newTagIds.length > 0) {
      await tx.leadTag.createMany({
        data: newTagIds.map((tagId) => ({ leadId: primary.id, tagId })),
        skipDuplicates: true,
      });
    }
    if (newCustomValues.length > 0) {
      await tx.leadCustomValue.createMany({ data: newCustomValues, skipDuplicates: true });
    }

    // 3. Deleta os perdedores (cascade limpa join rows restantes deles).
    await tx.lead.deleteMany({ where: { id: { in: loserIds } } });

    // 4. Preenche lacunas do sobrevivente (depois do delete → sem colisão de unique).
    if (Object.keys(patch).length > 0) {
      await tx.lead.update({ where: { id: primary.id }, data: patch });
    }
  });

  return NextResponse.json({
    ok: true,
    primaryId: primary.id,
    merged: loserIds.length,
    total: leads.length,
  });
}
