import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType } from "@/generated/prisma";
import { businessMinutesBetweenWithConfig, loadCompanyHours, type CompanyHoursConfig } from "@/lib/business-hours";

/**
 * GET/POST /api/cron/sla
 *
 * Job que move conversas OPEN sem resposta para PENDING quando passa o SLA.
 * Roda idealmente a cada 1-2 minutos via cron externo (Vercel Cron, Railway).
 *
 * SLA por empresa: lê de Setting.key = "sla_minutes:<companyId>" (default 15min).
 * O SLA conta MINUTOS ÚTEIS (dentro do expediente). Mensagem que chega às 18h05
 * com expediente até 18h não vira PENDING — só conta a partir das 9h do próximo
 * dia útil. Evita flag de "sem atendimento" em mensagem fora do horário.
 *
 * Segurança: aceita header `Authorization: Bearer <CRON_SECRET>` se a env var existir.
 * Se CRON_SECRET não estiver configurada, aceita qualquer chamada (dev mode).
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const slaSettings = await prisma.setting.findMany({
    where: { key: { startsWith: "sla_minutes:" } },
  });
  const slaByCompany = new Map<string, number>();
  for (const s of slaSettings) {
    const companyId = s.key.replace("sla_minutes:", "");
    const min = parseInt(s.value, 10);
    if (!isNaN(min) && min > 0) slaByCompany.set(companyId, min);
  }

  const DEFAULT_SLA_MIN = 15;

  // Conversas OPEN candidatas a virar PENDING.
  // Pré-filtro com wall-clock pra evitar carregar conversa OPEN de 3 segundos atrás:
  // se nem o SLA mínimo passou em wall-clock, não tem como ter passado em business-clock.
  const earliestCutoff = new Date(Date.now() - DEFAULT_SLA_MIN * 60_000);
  const candidates = await prisma.conversation.findMany({
    where: {
      status: "OPEN",
      statusUpdatedAt: { lte: earliestCutoff },
    },
    select: { id: true, companyId: true, statusUpdatedAt: true },
  });

  // Cache de config por empresa pra não recarregar dentro do loop.
  const configCache = new Map<string, CompanyHoursConfig>();
  async function getConfig(companyId: string): Promise<CompanyHoursConfig> {
    let cfg = configCache.get(companyId);
    if (!cfg) {
      cfg = await loadCompanyHours(companyId);
      configCache.set(companyId, cfg);
    }
    return cfg;
  }

  const now = new Date();
  const promotedIds: string[] = [];
  const promotedCompanyById = new Map<string, string>();

  for (const conv of candidates) {
    const slaMin = slaByCompany.get(conv.companyId) ?? DEFAULT_SLA_MIN;
    const cfg = await getConfig(conv.companyId);
    const elapsedBusinessMin = businessMinutesBetweenWithConfig(conv.statusUpdatedAt, now, cfg);
    if (elapsedBusinessMin >= slaMin) {
      promotedIds.push(conv.id);
      promotedCompanyById.set(conv.id, conv.companyId);
    }
  }

  let promoted = 0;
  if (promotedIds.length > 0) {
    await prisma.conversation.updateMany({
      where: { id: { in: promotedIds } },
      data: { status: "PENDING", statusUpdatedAt: new Date() },
    });

    await Promise.all(
      promotedIds.map((conversationId) => {
        const companyId = promotedCompanyById.get(conversationId);
        if (!companyId) return null;
        return prisma.activity.create({
          data: {
            type: ActivityType.STATUS_CHANGED,
            body: "Conversa marcada como SEM ATENDIMENTO (SLA estourado)",
            meta: { from: "OPEN", to: "PENDING" } as any,
            conversationId,
            companyId,
          },
        }).catch(() => null);
      })
    );
    promoted = promotedIds.length;
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    promoted,
    timestamp: new Date().toISOString(),
  });
}

export const GET  = handle;
export const POST = handle;
