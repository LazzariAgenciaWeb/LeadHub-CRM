/**
 * Central do Cliente — tudo o que aconteceu com um cliente, da negociação à
 * entrega, num lugar só.
 *
 * A linha do tempo é DERIVADA das fontes (venda/contrato, cobranças,
 * projetos, chamados, emails marcados, documentos, anotações), não gravada à
 * parte: assim ela nunca diverge do que está nas telas e não precisa de
 * backfill. Usada pela página do cliente e pela ferramenta
 * linha_do_tempo_cliente do Claude.
 */

import { prisma } from "./prisma";
import { isImpersonating } from "./effective-session";
import type { ClientRecordAccess } from "./permissions";
import { phoneKeys } from "./conversation-client";
import { ACCEPTANCE_LABEL, CONTRACT_STATUS_LABEL, productionBlocker, type SoldService } from "./sale-contract";

export const TIMELINE_TYPES = [
  "LEAD", "PROPOSTA", "VENDA", "CONTRATO", "FATURAMENTO", "COBRANCA",
  "PROJETO", "CHAMADO", "WHATSAPP", "EMAIL", "DOCUMENTO", "NOTA",
] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

export const TIMELINE_LABEL: Record<TimelineType, string> = {
  LEAD: "Lead", PROPOSTA: "Proposta", VENDA: "Venda", CONTRATO: "Contrato", FATURAMENTO: "Faturamento",
  COBRANCA: "Cobrança", PROJETO: "Projeto", CHAMADO: "Chamado", WHATSAPP: "WhatsApp", EMAIL: "E-mail", DOCUMENTO: "Documento", NOTA: "Anotação",
};

export interface TimelineEvent {
  at: string; // ISO
  type: TimelineType;
  title: string;
  summary?: string | null;
  link?: string | null; // interno (/…) ou externo (https://…)
  by?: string | null;
}

export const DOC_TYPE_LABEL: Record<string, string> = {
  PROPOSTA: "Proposta", CONTRATO: "Contrato", TERMO: "Termo", ADITIVO: "Aditivo",
  BRIEFING: "Briefing", ENTREGA: "Entrega", OUTRO: "Outro",
};

/**
 * Quem pode abrir a Central deste cliente: equipe da agência dona (não o
 * próprio cliente) ou o super admin fora de impersonação.
 */
export async function clientCentralScope(session: any, clientId: string) {
  const role = session?.user?.role as string | undefined;
  if (!role || role === "CLIENT") return null;
  const client = await prisma.company.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, parentCompanyId: true, driveFolderUrl: true, clickupListUrl: true },
  });
  if (!client?.parentCompanyId) return null;
  const userCompanyId = session.user.companyId as string | undefined;
  const superAdmin = role === "SUPER_ADMIN" && !isImpersonating(session);
  if (!superAdmin && client.parentCompanyId !== userCompanyId) return null;
  return { client, agencyId: client.parentCompanyId };
}

/** Tipos que cada permissão de setor libera na linha do tempo. */
function allowedTypes(access?: ClientRecordAccess | null): Set<TimelineType> {
  if (!access) return new Set(TIMELINE_TYPES);
  const s = new Set<TimelineType>(["EMAIL", "DOCUMENTO", "NOTA"]);
  if (access.negociacoes || access.financeiro) { s.add("LEAD"); s.add("PROPOSTA"); s.add("VENDA"); }
  if (access.financeiro) { s.add("CONTRATO"); s.add("FATURAMENTO"); s.add("COBRANCA"); }
  if (access.projetos || access.financeiro) s.add("PROJETO");
  if (access.chamados) s.add("CHAMADO");
  if (access.chamados || access.negociacoes) s.add("WHATSAPP");
  return s;
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function buildClientTimeline(
  clientId: string,
  agencyId: string,
  opts: {
    since?: Date | null;
    types?: TimelineType[] | null;
    access?: ClientRecordAccess | null;
    viewerUserId?: string | null;
    /** Caixas de email que o usuário pode ler. null = todas. */
    emailAccountIds?: string[] | null;
    includeInternalTickets?: boolean;
    limit?: number;
  } = {},
): Promise<TimelineEvent[]> {
  const allowed = allowedTypes(opts.access);
  const want = (t: TimelineType) => allowed.has(t) && (!opts.types?.length || opts.types.includes(t));
  const now = new Date();

  const [sales, documents, invoices, projects, tickets, emails, notes, conversations] = await Promise.all([
    want("LEAD") || want("VENDA") || want("CONTRATO") || want("FATURAMENTO") || want("PROJETO")
      ? prisma.sale.findMany({
          where: { clientCompanyId: clientId, companyId: agencyId },
          include: { lead: { select: { id: true, name: true, createdAt: true, pipeline: true } } },
        })
      : Promise.resolve([]),
    want("PROPOSTA") || want("DOCUMENTO")
      ? prisma.clientDocument.findMany({ where: { clientCompanyId: clientId } })
      : Promise.resolve([]),
    want("COBRANCA")
      ? prisma.clientInvoice.findMany({
          where: { clientCompanyId: clientId },
          select: { id: true, description: true, amountCents: true, dueDate: true, status: true, paidAt: true, createdAt: true },
        })
      : Promise.resolve([]),
    want("PROJETO")
      ? prisma.setorClickupList.findMany({
          where: { clientCompanyId: clientId, setor: { companyId: agencyId } },
          select: { id: true, name: true, createdAt: true, deliveredAt: true, status: true },
        })
      : Promise.resolve([]),
    want("CHAMADO")
      ? prisma.ticket.findMany({
          where: { clientCompanyId: clientId, ...(opts.includeInternalTickets ? {} : { isInternal: false }) },
          select: { id: true, title: true, status: true, createdAt: true, updatedAt: true, assignee: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
    want("EMAIL")
      ? prisma.inboxEmail.findMany({
          where: {
            companyId: agencyId,
            clientCompanyId: clientId,
            folder: { notIn: ["TRASH", "SPAM"] },
            OR: [{ clientMark: { not: null } }, { aiImportance: "ALTA" }],
            ...(opts.emailAccountIds ? { accountId: { in: opts.emailAccountIds } } : {}),
          },
          select: { id: true, subject: true, direction: true, fromName: true, fromEmail: true, sentAt: true, clientMark: true, aiSummary: true, snippet: true },
          orderBy: { sentAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
    want("NOTA") && opts.viewerUserId
      ? prisma.assistantNote.findMany({
          where: { clientCompanyId: clientId, userId: opts.viewerUserId, archivedAt: null },
          select: { id: true, title: true, body: true, kind: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
    want("WHATSAPP") ? clientConversations(clientId, agencyId) : Promise.resolve([]),
  ]);

  const ev: TimelineEvent[] = [];
  const push = (e: Omit<TimelineEvent, "at"> & { at: Date | null | undefined }) => {
    if (!e.at || !want(e.type)) return;
    ev.push({ ...e, at: e.at.toISOString() });
  };

  for (const s of sales) {
    if (s.lead) {
      push({
        at: s.lead.createdAt, type: "LEAD", title: `Lead criado: ${s.lead.name ?? s.title}`,
        link: `/crm/oportunidades?lead=${s.lead.id}`,
      });
    }
    push({
      at: s.closedAt, type: "VENDA", title: `Venda ganha: ${s.title}`,
      summary: `${brl(s.valueCents)} · ${s.kind === "RECORRENTE" ? "recorrente" : "pontual"}`,
      by: s.sellerName, link: "/financeiro/esteira",
    });
    push({
      at: s.contractSentAt, type: "CONTRATO",
      title: `${s.contractDocType === "TERMO" ? "Termo" : "Contrato"} enviado — ${s.title}`,
    });
    push({
      at: s.acceptedAt, type: "CONTRATO", title: `Contrato aceito — ${s.title}`,
      summary: `via ${ACCEPTANCE_LABEL[s.acceptanceType ?? ""] ?? s.acceptanceType ?? "?"}${s.acceptedByName || s.acceptedByEmail ? ` por ${[s.acceptedByName, s.acceptedByEmail].filter(Boolean).join(" · ")}` : ""}`,
      link: s.acceptanceUrl, by: s.acceptanceRecordedBy,
    });
    push({ at: s.contractEndedAt, type: "CONTRATO", title: `Contrato encerrado — ${s.title}` });
    push({
      at: s.billingConfirmedAt, type: "FATURAMENTO", title: `Faturamento confirmado — ${s.title}`,
      summary: s.billingInstructions ? s.billingInstructions.slice(0, 200) : null,
      by: s.billingConfirmedBy, link: s.billingConfirmationUrl,
    });
    push({
      at: s.releasedAt, type: "PROJETO", title: `Produção liberada — ${s.title}`,
      link: s.projectId ? `/projetos/${s.projectId}` : null,
    });
    push({ at: s.deliveredAt, type: "PROJETO", title: `Venda entregue — ${s.title}` });
  }

  for (const d of documents) {
    const proposta = d.type === "PROPOSTA";
    push({
      at: d.documentDate ?? d.createdAt, type: proposta ? "PROPOSTA" : "DOCUMENTO",
      title: proposta ? `Proposta enviada: ${d.title}` : `${DOC_TYPE_LABEL[d.type] ?? d.type} anexado: ${d.title}`,
      link: d.url ?? (d.storageObjectId ? `/api/storage/${d.storageObjectId}` : null), by: d.createdByName,
    });
  }

  for (const i of invoices) {
    push({ at: i.createdAt, type: "COBRANCA", title: `Cobrança lançada: ${i.description}`, summary: `${brl(i.amountCents)} · vence ${i.dueDate.toLocaleDateString("pt-BR")}` });
    if (i.paidAt) push({ at: i.paidAt, type: "COBRANCA", title: `Cobrança paga: ${i.description}`, summary: brl(i.amountCents) });
    if (i.status === "ABERTO" && i.dueDate < now) {
      push({ at: i.dueDate, type: "COBRANCA", title: `Cobrança atrasada: ${i.description}`, summary: brl(i.amountCents) });
    }
  }

  for (const p of projects) {
    push({ at: p.createdAt, type: "PROJETO", title: `Projeto criado: ${p.name}`, link: `/projetos/${p.id}` });
    push({ at: p.deliveredAt, type: "PROJETO", title: `Projeto entregue: ${p.name}`, link: `/projetos/${p.id}` });
  }

  for (const t of tickets) {
    push({ at: t.createdAt, type: "CHAMADO", title: `Chamado aberto: ${t.title}`, link: `/chamados/${t.id}`, by: t.assignee?.name ?? null });
    if (t.status === "RESOLVED" || t.status === "CLOSED") {
      push({ at: t.updatedAt, type: "CHAMADO", title: `Chamado resolvido: ${t.title}`, link: `/chamados/${t.id}` });
    }
  }

  for (const e of emails) {
    const mark = e.clientMark === "ACEITE" ? " (aceite)" : e.clientMark === "FATURAMENTO" ? " (confirmação de faturamento)" : "";
    push({
      at: e.sentAt, type: "EMAIL",
      title: `${e.direction === "OUT" ? "E-mail enviado" : "E-mail recebido"}${mark}: ${e.subject || "(sem assunto)"}`,
      summary: (e.aiSummary || e.snippet || "").slice(0, 200) || null,
      by: e.direction === "IN" ? e.fromName || e.fromEmail : null,
      link: `/emails?email=${e.id}`,
    });
  }

  for (const c of conversations) {
    push({
      at: c.lastMessageAt, type: "WHATSAPP",
      title: `${c.isGroup ? "Grupo" : "Conversa"} no WhatsApp: ${c.name ?? c.phone}`,
      summary: c.lastMessageBody ? c.lastMessageBody.slice(0, 200) : null,
      link: `/whatsapp?abrir=${encodeURIComponent(c.phone)}`,
    });
  }

  for (const n of notes) {
    push({ at: n.createdAt, type: "NOTA", title: n.title, summary: n.body?.slice(0, 200) ?? null });
  }

  const since = opts.since?.getTime() ?? 0;
  return ev
    .filter((e) => new Date(e.at).getTime() >= since)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, opts.limit ?? 500);
}

/**
 * Contratos (vendas) do cliente com tudo do aceite/faturamento e a
 * negociação de origem (lead, histórico, propostas, serviços vendidos).
 */
export async function loadClientContracts(clientId: string, agencyId: string) {
  const sales = await prisma.sale.findMany({
    where: { clientCompanyId: clientId, companyId: agencyId },
    orderBy: { closedAt: "desc" },
    include: {
      project: { select: { id: true, name: true, status: true } },
      contractDocument: { select: { id: true, title: true, url: true, storageObjectId: true } },
      lead: {
        select: {
          id: true, name: true, phone: true, email: true, pipeline: true, pipelineStage: true,
          value: true, createdAt: true, wonAt: true,
          comments: { orderBy: { createdAt: "desc" }, take: 30, select: { id: true, body: true, authorName: true, createdAt: true } },
          activities: { orderBy: { createdAt: "desc" }, take: 30, select: { id: true, type: true, body: true, authorName: true, createdAt: true, meta: true } },
        },
      },
      documents: { select: { id: true, type: true, title: true, url: true, storageObjectId: true, documentDate: true, createdAt: true } },
    },
  });
  return sales.map((s) => ({
    id: s.id,
    title: s.title,
    valueCents: s.valueCents,
    kind: s.kind,
    closedAt: s.closedAt.toISOString(),
    sellerName: s.sellerName,
    contractStatus: s.contractStatus,
    contractStatusLabel: CONTRACT_STATUS_LABEL[s.contractStatus] ?? s.contractStatus,
    billingStatus: s.billingStatus,
    productionStatus: s.productionStatus,
    contractDocType: s.contractDocType,
    contractDocument: s.contractDocument,
    contractSentAt: s.contractSentAt?.toISOString() ?? null,
    acceptanceType: s.acceptanceType,
    acceptanceUrl: s.acceptanceUrl,
    acceptedAt: s.acceptedAt?.toISOString() ?? null,
    acceptedByName: s.acceptedByName,
    acceptedByEmail: s.acceptedByEmail,
    acceptanceRecordedBy: s.acceptanceRecordedBy,
    billingConfirmed: s.billingConfirmed,
    billingConfirmedBy: s.billingConfirmedBy,
    billingConfirmedAt: s.billingConfirmedAt?.toISOString() ?? null,
    billingConfirmationUrl: s.billingConfirmationUrl,
    billingInstructions: s.billingInstructions,
    soldServices: (Array.isArray(s.soldServices) ? s.soldServices : []) as unknown as SoldService[],
    productionBlocker: s.productionStatus === "PENDENTE" ? productionBlocker(s) : null,
    project: s.project,
    lead: s.lead
      ? {
          id: s.lead.id, name: s.lead.name, phone: s.lead.phone, email: s.lead.email,
          pipeline: s.lead.pipeline, pipelineStage: s.lead.pipelineStage, value: s.lead.value,
          createdAt: s.lead.createdAt.toISOString(), wonAt: s.lead.wonAt?.toISOString() ?? null,
          history: [
            ...s.lead.comments.map((c) => ({ id: c.id, at: c.createdAt.toISOString(), kind: "COMENTARIO", text: c.body, by: c.authorName })),
            ...s.lead.activities.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), kind: a.type, text: a.body ?? describeActivity(a.type, a.meta), by: a.authorName })),
          ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40),
        }
      : null,
    proposals: s.documents.filter((d) => d.type === "PROPOSTA").map((d) => ({
      id: d.id, title: d.title, url: d.url ?? (d.storageObjectId ? `/api/storage/${d.storageObjectId}` : null),
      at: (d.documentDate ?? d.createdAt).toISOString(),
    })),
  }));
}

function describeActivity(type: string, meta: unknown): string {
  const m = (meta ?? {}) as Record<string, unknown>;
  const de = m.from ?? m.de ?? m.old;
  const para = m.to ?? m.para ?? m.new;
  const label: Record<string, string> = {
    STATUS_CHANGED: "Status alterado", STAGE_CHANGED: "Etapa alterada", PIPELINE_CHANGED: "Pipeline alterado",
    VALUE_CHANGED: "Valor alterado", ASSIGNEE_CHANGED: "Responsável alterado", NOTE_ADDED: "Anotação",
  };
  const base = label[type] ?? type.toLowerCase();
  return de || para ? `${base}: ${de ?? "—"} → ${para ?? "—"}` : base;
}

/**
 * Conversas do WhatsApp da agência com os contatos/grupos cadastrados no
 * cliente (número com as variações 55/9º dígito; grupo pelo JID exato).
 */
export async function clientConversations(clientId: string, agencyId: string) {
  const contacts = await prisma.companyContact.findMany({
    where: { companyId: clientId },
    select: { phone: true, name: true, isGroup: true },
  });
  if (contacts.length === 0) return [];
  const keys = [...new Set(contacts.flatMap((c) => phoneKeys(c.phone)))];
  const convs = await prisma.conversation.findMany({
    where: { companyId: agencyId, phone: { in: keys }, syncBlocked: false },
    select: { id: true, phone: true, isGroup: true, lastMessageAt: true, lastMessageBody: true },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 100,
  });
  return convs.map((c) => {
    const contact = contacts.find((k) => phoneKeys(k.phone).includes(c.phone));
    return { ...c, isGroup: c.isGroup || c.phone.includes("@g.us"), name: contact?.name ?? null };
  });
}
