import { prisma } from "./prisma";

/**
 * O que ainda espera o CLIENTE, pros dois links públicos que ele recebe: o
 * chamado (/acompanhar/[token]) e a peça (/aprovar/[token]).
 *
 * Quem abre o link é anônimo — o token vale só pra aquele item. Então o alerta
 * é da EMPRESA-CLIENTE, não da pessoa: peças esperando aprovação e chamados em
 * aberto que ele acompanha, menos o item que ele já está vendo. Chamado
 * interno / projeto sem cliente não tem o que listar.
 */

export type ItemPendente = { title: string; url: string; sub: string | null };

export type Pendencias = {
  aprovacoes: ItemPendente[];
  chamados: ItemPendente[];
  /** Alguém da empresa-cliente já tem login no portal (/meu-espaco)? */
  temAcesso: boolean;
  agencia: { name: string; phone: string | null };
};

const PROJETO_MORTO = ["ENTREGUE", "CANCELADO", "PAUSADO"] as const;
const LIMITE = 6;

const STATUS_CHAMADO: Record<string, string> = {
  OPEN:        "Aberto",
  IN_PROGRESS: "Em andamento",
};

export async function clientePendencias(args: {
  /** Empresa-dona (agência) — identidade mostrada no alerta. */
  agencyCompanyId: string;
  clientCompanyId: string | null;
  /** Item que o cliente já está vendo nesta tela (não repete no alerta). */
  exceto?: { ticketId?: string; taskId?: string };
}): Promise<Pendencias> {
  const { agencyCompanyId, clientCompanyId, exceto } = args;

  const [agencia, tasks, tickets, usuarios] = await Promise.all([
    prisma.company.findUnique({
      where:  { id: agencyCompanyId },
      select: { name: true, tradeName: true, phone: true },
    }),
    clientCompanyId
      ? prisma.projectTask.findMany({
          where: {
            status:         "AGUARDANDO_CLIENTE",
            approvalToken:  { not: null },
            approvalSentAt: { not: null },
            ignoredAt:      null,
            ...(exceto?.taskId ? { id: { not: exceto.taskId } } : {}),
            project: { clientCompanyId, status: { notIn: [...PROJETO_MORTO] } },
          },
          orderBy: { approvalSentAt: "asc" },
          take:    LIMITE,
          select:  { title: true, approvalToken: true, project: { select: { name: true } } },
        })
      : [],
    clientCompanyId
      ? prisma.ticket.findMany({
          where: {
            clientCompanyId,
            companyId:   agencyCompanyId,
            publicToken: { not: null },
            isInternal:  false,
            status:      { in: ["OPEN", "IN_PROGRESS"] },
            ...(exceto?.ticketId ? { id: { not: exceto.ticketId } } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take:    LIMITE,
          select:  { title: true, status: true, publicToken: true },
        })
      : [],
    // SUPER_ADMIN é o dono da plataforma (ver AGENTS.md), não acesso do cliente.
    clientCompanyId
      ? prisma.user.count({ where: { companyId: clientCompanyId, role: { not: "SUPER_ADMIN" } } })
      : 0,
  ]);

  return {
    aprovacoes: tasks.map((t) => ({
      title: t.title,
      url:   `/aprovar/${t.approvalToken}`,
      sub:   t.project.name,
    })),
    chamados: tickets.map((t) => ({
      title: t.title,
      url:   `/acompanhar/${t.publicToken}`,
      sub:   STATUS_CHAMADO[t.status] ?? null,
    })),
    temAcesso: usuarios > 0,
    agencia: {
      name:  agencia?.tradeName || agencia?.name || "a agência",
      phone: agencia?.phone ?? null,
    },
  };
}
