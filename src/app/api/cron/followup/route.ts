import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { STALE_AFTER_DAYS, NOT_CLOSED_LEAD_WHERE } from "@/lib/calendar-data";
import { endOfTodayInSystemTZ } from "@/lib/datetime";

/**
 * GET/POST /api/cron/followup
 *
 * Resumo diário de follow-up do CRM. Para cada empresa com moduleCrm ativo,
 * varre:
 *   - leads/oportunidades com prazo de retorno vencido/hoje (expectedReturnAt)
 *   - leads sem prazo, esfriando (sem interação há STALE_AFTER_DAYS dias)
 * e dispara UM push consolidado por responsável ("você tem N retornos + M
 * esfriando"). Itens sem responsável são reportados aos ADMINs da empresa
 * (que enxergam a fila sem dono e distribuem).
 *
 * MODO "SÓ AVISAR": não cria Task nem altera nada — só notifica. O vendedor
 * decide o que fazer. Idempotente: usa tag `followup-daily-<userId>`, então
 * chamadas repetidas no mesmo dia substituem a notificação em vez de empilhar.
 *
 * Agendamento: chamar 1x por dia de manhã (~8h BRT) via n8n — mesmo padrão dos
 * crons de gamificação/billing (que também não vivem no start.sh). Respeita
 * `Authorization: Bearer <CRON_SECRET>` se a env existir.
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const todayEnd = endOfTodayInSystemTZ(now);
  const staleCutoff = new Date(now);
  staleCutoff.setDate(staleCutoff.getDate() - STALE_AFTER_DAYS);

  // Empresas elegíveis: ativas + com CRM ligado.
  const companies = await prisma.company.findMany({
    where: { status: "ACTIVE", moduleCrm: true },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);
  if (companyIds.length === 0) {
    return NextResponse.json({ ok: true, companies: 0, pushed: 0, timestamp: now.toISOString() });
  }

  // ── Leads com prazo de retorno vencido/hoje ──────────────────────────────
  const dueLeads = await prisma.lead.findMany({
    where: {
      companyId: { in: companyIds },
      ...NOT_CLOSED_LEAD_WHERE,
      expectedReturnAt: { lte: todayEnd },
    },
    select: { id: true, companyId: true, conversation: { select: { assigneeId: true } } },
  });

  // ── Leads sem prazo, esfriando ───────────────────────────────────────────
  const staleLeads = await prisma.lead.findMany({
    where: {
      companyId: { in: companyIds },
      ...NOT_CLOSED_LEAD_WHERE,
      expectedReturnAt: null,
      OR: [
        { conversation: { is: { lastMessageAt: { lt: staleCutoff } } } },
        { AND: [{ conversation: { is: null } }, { updatedAt: { lt: staleCutoff } }] },
      ],
    },
    select: { id: true, companyId: true, conversation: { select: { assigneeId: true } } },
  });

  // ── Agrega: por usuário (atribuídos) + por empresa (sem dono) ─────────────
  type Counts = { due: number; stale: number; unDue: number; unStale: number };
  const perUser = new Map<string, Counts>(); // userId → contagem própria
  const unassignedByCompany = new Map<string, { due: number; stale: number }>();

  const bump = (map: Map<string, Counts>, key: string, field: keyof Counts) => {
    const c = map.get(key) ?? { due: 0, stale: 0, unDue: 0, unStale: 0 };
    c[field]++;
    map.set(key, c);
  };

  for (const l of dueLeads) {
    const assignee = l.conversation?.assigneeId ?? null;
    if (assignee) bump(perUser, assignee, "due");
    else {
      const u = unassignedByCompany.get(l.companyId) ?? { due: 0, stale: 0 };
      u.due++; unassignedByCompany.set(l.companyId, u);
    }
  }
  for (const l of staleLeads) {
    const assignee = l.conversation?.assigneeId ?? null;
    if (assignee) bump(perUser, assignee, "stale");
    else {
      const u = unassignedByCompany.get(l.companyId) ?? { due: 0, stale: 0 };
      u.stale++; unassignedByCompany.set(l.companyId, u);
    }
  }

  // ── Fila sem dono vai pros ADMINs da empresa (exclui SUPER_ADMIN) ─────────
  const companiesWithUnassigned = [...unassignedByCompany.keys()];
  if (companiesWithUnassigned.length > 0) {
    const admins = await prisma.user.findMany({
      where: { companyId: { in: companiesWithUnassigned }, role: "ADMIN" },
      select: { id: true, companyId: true },
    });
    for (const a of admins) {
      if (!a.companyId) continue;
      const u = unassignedByCompany.get(a.companyId);
      if (!u) continue;
      const c = perUser.get(a.id) ?? { due: 0, stale: 0, unDue: 0, unStale: 0 };
      c.unDue += u.due;
      c.unStale += u.stale;
      perUser.set(a.id, c);
    }
  }

  // ── Dispara push consolidado por usuário ─────────────────────────────────
  let pushed = 0;
  await Promise.all(
    [...perUser.entries()].map(async ([userId, c]) => {
      const parts: string[] = [];
      if (c.due > 0) parts.push(`${c.due} retorno${c.due > 1 ? "s" : ""} pra hoje`);
      if (c.stale > 0) parts.push(`🧊 ${c.stale} esfriando`);
      const unTotal = c.unDue + c.unStale;
      if (unTotal > 0) parts.push(`${unTotal} sem responsável`);
      if (parts.length === 0) return;

      await sendPushToUser(
        userId,
        {
          title: "📞 Seus follow-ups de hoje",
          body: `${parts.join(" · ")}. Não deixe esfriar — toque pra ver.`,
          url: "/dashboard",
          tag: `followup-daily-${userId}`,
        },
        "followUp",
      );
      pushed++;
    }),
  );

  return NextResponse.json({
    ok: true,
    companies: companyIds.length,
    dueLeads: dueLeads.length,
    staleLeads: staleLeads.length,
    recipients: perUser.size,
    pushed,
    timestamp: now.toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
