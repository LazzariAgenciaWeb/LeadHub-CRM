import { prisma } from "@/lib/prisma";
import { getCalendarData, resolveContactNames } from "@/lib/calendar-data";
import { endOfTodayInSystemTZ } from "@/lib/datetime";
import { type ToolDef, ok, appUrl, fmtDateTime, fmtDate } from "./types";

/**
 * Fila do dia — a "próxima ação" de tudo que está vivo. Fonte única usada
 * pela ferramenta `fila_do_dia`, pela home do Assistente e pelo resumo das 8h
 * no WhatsApp. Não é painel: cada bloco é uma lista de coisas pra FAZER.
 */

export interface FilaItem {
  id: string;
  kind: "whatsapp" | "chamado" | "tarefa" | "followup" | "lembrete" | "pessoal" | "projeto_parado" | "financeiro";
  title: string;
  sub?: string;
  when?: Date | null;
  overdue?: boolean;
  link?: string;
}

export interface FilaDoDia {
  esperandoPorMim: FilaItem[];   // WhatsApp sem resposta + chamados meus
  hoje: FilaItem[];              // tarefas (lead/projeto/pessoal) e lembretes com prazo até hoje
  followUps: FilaItem[];         // retornos vencidos + leads esfriando
  semProximaAcao: FilaItem[];    // projetos ativos sem tarefa aberta
  financeiro: FilaItem[];        // atrasadas + a faturar
  bloquinho: FilaItem[];         // tarefas pessoais sem data + ideias recentes
  generatedAt: string;
}

const STALE_PROJECT_DAYS = 7;

// Links seguem as convenções do resto do app: inbox abre por telefone
// (`?abrir=`), lead abre na página do SEU pipeline (`?lead=`).
const PIPELINE_HREF: Record<string, string> = { PROSPECCAO: "/crm/prospeccao", LEADS: "/crm/leads", OPORTUNIDADES: "/crm/oportunidades" };
function leadHref(l: { id: string; pipeline?: string | null }): string {
  return appUrl(`${PIPELINE_HREF[l.pipeline ?? ""] ?? "/crm/leads"}?lead=${l.id}`);
}
function convHref(phone: string): string {
  return appUrl(`/whatsapp?abrir=${encodeURIComponent(phone)}`);
}
function fmtPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return p.includes("@g.us") ? "Grupo" : p;
}

export async function buildFilaDoDia(params: { userId: string; companyId: string; isManager: boolean }): Promise<FilaDoDia> {
  const { userId, companyId, isManager } = params;
  const now = new Date();
  const todayEnd = endOfTodayInSystemTZ(now);
  const staleCut = new Date(now); staleCut.setDate(staleCut.getDate() - STALE_PROJECT_DAYS);
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const setores = await prisma.setorUser.findMany({ where: { userId }, select: { setorId: true } });
  const userSetorIds = setores.map((s) => s.setorId);

  const [cal, leadTasks, projTasks, notes, staleProjects, overdueInv, services, billed, skips] = await Promise.all([
    getCalendarData({ companyId, userId, isManager, userSetorIds }),
    prisma.task.findMany({
      where: { companyId, done: false, dueAt: { lte: todayEnd }, OR: [{ assigneeId: userId }, { assigneeId: null }] },
      select: { id: true, title: true, dueAt: true, lead: { select: { id: true, name: true, phone: true, pipeline: true } } },
      orderBy: { dueAt: "asc" }, take: 20,
    }),
    prisma.projectTask.findMany({
      where: { done: false, ignoredAt: null, assigneeId: userId, dueDate: { not: null, lte: todayEnd }, project: { setor: { companyId } } },
      select: { id: true, title: true, dueDate: true, project: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" }, take: 20,
    }),
    prisma.assistantNote.findMany({
      where: { userId, done: false },
      select: { id: true, kind: true, title: true, dueAt: true, createdAt: true },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 40,
    }),
    prisma.setorClickupList.findMany({
      where: {
        setor: { companyId },
        status: { in: ["PLANEJAMENTO", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE"] },
        internalTasks: { none: { done: false, ignoredAt: null } },
        tickets: { none: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
        updatedAt: { lt: staleCut },
        ...(isManager ? {} : { members: { some: { userId } } }),
      },
      select: { id: true, name: true, status: true, updatedAt: true, clientCompany: { select: { name: true } } },
      orderBy: { updatedAt: "asc" }, take: 10,
    }),
    isManager
      ? prisma.clientInvoice.findMany({
          where: { status: "ABERTO", dueDate: { lt: now }, clientCompany: { parentCompanyId: companyId } },
          select: { id: true, description: true, amountCents: true, dueDate: true, clientCompany: { select: { id: true, name: true } } },
          orderBy: { dueDate: "asc" }, take: 10,
        })
      : Promise.resolve([]),
    isManager
      ? prisma.clientService.findMany({
          where: { status: "ATIVO", isRecurring: true, amountCents: { gt: 0 }, clientCompany: { parentCompanyId: companyId } },
          select: { id: true, label: true, amountCents: true, status: true, isRecurring: true, billingCycle: true, renewsAt: true, startedAt: true, endedAt: true, clientCompany: { select: { name: true } } },
        })
      : Promise.resolve([]),
    isManager
      ? prisma.clientInvoice.findMany({ where: { referenceMonth: month, status: { not: "CANCELADO" }, clientServiceId: { not: null } }, select: { clientServiceId: true } })
      : Promise.resolve([]),
    isManager ? prisma.billingSkip.findMany({ where: { month }, select: { clientServiceId: true } }) : Promise.resolve([]),
  ]);

  // Nome do contato: lead → contato da empresa → telefone formatado.
  const contactNames = await resolveContactNames(cal.unansweredConvs.map((c) => ({ companyId: c.companyId, phone: c.phone })));
  const esperandoPorMim: FilaItem[] = [];
  // Grupos ficam de fora: raramente é "alguém esperando VOCÊ", só barulho.
  for (const c of cal.unansweredConvs.filter((c) => !c.isGroup).slice(0, 10)) {
    const name = (c as any).leads?.[0]?.name ?? contactNames[`${c.companyId}|${c.phone}`] ?? fmtPhone(c.phone);
    esperandoPorMim.push({ id: c.id, kind: "whatsapp", title: `${name} está esperando resposta`, sub: (c as any).lastMessageBody?.slice(0, 60), when: (c as any).lastMessageAt, link: convHref(c.phone) });
  }
  for (const t of cal.myTickets) {
    esperandoPorMim.push({ id: t.id, kind: "chamado", title: t.title, sub: t.clientCompany?.name ?? (t.type === "INTERNAL" ? "interno" : undefined), when: t.dueDate, overdue: !!t.dueDate && t.dueDate < now, link: appUrl(`/chamados/${t.id}`) });
  }

  const hoje: FilaItem[] = [];
  for (const t of leadTasks) hoje.push({ id: t.id, kind: "tarefa", title: t.title, sub: `Lead ${t.lead.name ?? fmtPhone(t.lead.phone)}`, when: t.dueAt, overdue: t.dueAt < now, link: leadHref(t.lead) });
  for (const t of projTasks) hoje.push({ id: t.id, kind: "tarefa", title: t.title, sub: `Projeto ${t.project.name}`, when: t.dueDate, overdue: !!t.dueDate && t.dueDate < now, link: appUrl(`/projetos/${t.project.id}`) });
  for (const n of notes) {
    if (!n.dueAt || n.dueAt > todayEnd) continue;
    hoje.push({ id: n.id, kind: n.kind === "REMINDER" ? "lembrete" : "pessoal", title: n.title, when: n.dueAt, overdue: n.dueAt < now, link: appUrl("/assistente?aba=bloquinho") });
  }
  hoje.sort((a, b) => (a.when?.getTime() ?? 0) - (b.when?.getTime() ?? 0));

  const followUps: FilaItem[] = [];
  for (const l of cal.leadsFollowUp.slice(0, 10)) followUps.push({ id: l.id, kind: "followup", title: `Retornar para ${l.name ?? fmtPhone(l.phone)}`, when: (l as any).expectedReturnAt, overdue: true, link: leadHref(l) });
  for (const l of cal.staleLeads.slice(0, 5)) followUps.push({ id: l.id, kind: "followup", title: `${l.name ?? fmtPhone(l.phone)} esfriando (sem contato há dias)`, link: leadHref(l) });

  const semProximaAcao: FilaItem[] = staleProjects.map((p) => ({
    id: p.id, kind: "projeto_parado", title: p.name, sub: `${p.clientCompany?.name ?? "sem cliente"} · sem tarefa aberta desde ${fmtDate(p.updatedAt)}`, when: p.updatedAt, link: appUrl(`/projetos/${p.id}`),
  }));

  const financeiro: FilaItem[] = [];
  for (const i of overdueInv) financeiro.push({ id: i.id, kind: "financeiro", title: `${i.clientCompany.name}: ${(i.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} atrasado`, sub: i.description, when: i.dueDate, overdue: true, link: appUrl(`/empresas/${i.clientCompany.id}?aba=financeiro`) });
  if (services.length) {
    const { dueInMonth } = await import("@/app/(admin)/financeiro/lib");
    const billedSet = new Set(billed.map((b) => b.clientServiceId));
    const skipSet = new Set(skips.map((s) => s.clientServiceId));
    const pend = services.filter((s) => dueInMonth(s as any, month) && !billedSet.has(s.id) && !skipSet.has(s.id));
    if (pend.length) financeiro.push({ id: `faturar-${month}`, kind: "financeiro", title: `${pend.length} contrato(s) a faturar em ${month}`, sub: pend.slice(0, 4).map((s) => s.clientCompany.name).join(", ") + (pend.length > 4 ? "…" : ""), link: appUrl("/financeiro/lancamentos") });
  }

  const bloquinho: FilaItem[] = notes
    .filter((n) => !n.dueAt || n.dueAt > todayEnd)
    .slice(0, 12)
    .map((n) => ({ id: n.id, kind: n.kind === "REMINDER" ? "lembrete" : "pessoal", title: `${n.kind === "IDEA" ? "💡 " : n.kind === "NOTE" ? "📝 " : n.kind === "REMINDER" ? "⏰ " : "☑️ "}${n.title}`, when: n.dueAt, link: appUrl("/assistente?aba=bloquinho") }));

  return { esperandoPorMim, hoje, followUps, semProximaAcao, financeiro, bloquinho, generatedAt: now.toISOString() };
}

/** Texto compacto da fila (WhatsApp / contexto da IA). */
export function formatFila(f: FilaDoDia, opts?: { max?: number }): string {
  const max = opts?.max ?? 6;
  const sec = (title: string, items: FilaItem[]) => {
    if (!items.length) return null;
    const lines = items.slice(0, max).map((i) => `• ${i.overdue ? "⚠️ " : ""}${i.title}${i.sub ? ` — ${i.sub}` : ""}${i.when ? ` (${fmtDateTime(i.when)})` : ""}`);
    if (items.length > max) lines.push(`  …e mais ${items.length - max}`);
    return `*${title}* (${items.length})\n${lines.join("\n")}`;
  };
  const blocks = [
    sec("⏳ Esperando por você", f.esperandoPorMim),
    sec("📅 Hoje", f.hoje),
    sec("🔁 Follow-ups", f.followUps),
    sec("🕳️ Sem próxima ação", f.semProximaAcao),
    sec("💰 Financeiro", f.financeiro),
  ].filter(Boolean);
  return blocks.length ? blocks.join("\n\n") : "Nada pendente. Dia limpo. ✅";
}

export const filaDoDia: ToolDef<Record<string, never>> = {
  name: "fila_do_dia",
  description:
    "A fila de próximas ações do usuário AGORA: conversas de WhatsApp esperando resposta, chamados dele, tarefas e lembretes com prazo até hoje, follow-ups vencidos, projetos ativos sem nenhuma tarefa aberta, cobranças atrasadas e contratos a faturar. Use pra 'o que tenho pra hoje', 'resumo', 'o que estou esquecendo'.",
  input_schema: { type: "object", properties: {} },
  run: async (_i, ctx) => {
    const f = await buildFilaDoDia({ userId: ctx.userId, companyId: ctx.companyId, isManager: ctx.isAdmin });
    return ok(formatFila(f, { max: 8 }), { data: f });
  },
};
