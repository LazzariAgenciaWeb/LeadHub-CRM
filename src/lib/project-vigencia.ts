import { prisma } from "@/lib/prisma";
import type { ProjectStatus } from "@/generated/prisma";
import { addScoreOnce } from "@/lib/gamification";

/**
 * Vigência do projeto: Ativo · Pausado · Encerrado.
 *
 * O andamento fino mora nas TAREFAS; o projeto só precisa dizer se está valendo.
 * Quando o projeto entrega contratos do cliente (ClientService.projectId), quem
 * manda é o contrato: o Financeiro encerrou a gestão de mídias → o projeto
 * arquiva sozinho. Sem contrato ligado (projeto interno, avulso), vale o
 * status manual de sempre.
 *
 * `SetorClickupList.status` continua existindo como CACHE da vigência — crons,
 * área do cliente e o assistente já filtram por ele (ENTREGUE/CANCELADO =
 * fora). Por isso, toda mudança de contrato chama syncProjectStatus.
 */

export type Vigencia = "ATIVO" | "PAUSADO" | "ENCERRADO";

const CONTRATO_VIVO = new Set(["ATIVO", "EM_IMPLANTACAO"]);

export function vigenciaDoStatus(status: string): Vigencia {
  if (status === "ENTREGUE" || status === "CANCELADO") return "ENCERRADO";
  if (status === "PAUSADO") return "PAUSADO";
  return "ATIVO";
}

/** null = projeto sem contrato ligado (vale o status manual). */
export function vigenciaDosContratos(statuses: string[]): Vigencia | null {
  if (!statuses.length) return null;
  if (statuses.some((s) => CONTRATO_VIVO.has(s))) return "ATIVO";
  if (statuses.some((s) => s === "PAUSADO")) return "PAUSADO";
  return "ENCERRADO";
}

/**
 * Recalcula o status-cache do projeto a partir dos contratos ligados.
 * Encerrado vira ENTREGUE se o projeto já foi entregue (botão Entregar), senão
 * CANCELADO. Pontos de gamificação NÃO saem daqui — só do Entregar.
 */
export async function syncProjectStatus(projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const p = await prisma.setorClickupList.findUnique({
    where:  { id: projectId },
    select: { status: true, deliveredAt: true, contracts: { select: { status: true } } },
  });
  if (!p) return;
  const v = vigenciaDosContratos(p.contracts.map((c) => c.status));
  if (!v) return;

  let next: ProjectStatus = p.status;
  if (v === "ATIVO") {
    if (p.status === "ENTREGUE" || p.status === "CANCELADO" || p.status === "PAUSADO") next = "EM_ANDAMENTO";
  } else if (v === "PAUSADO") {
    next = "PAUSADO";
  } else {
    next = p.status === "ENTREGUE" || p.deliveredAt ? "ENTREGUE" : "CANCELADO";
  }
  if (next !== p.status) {
    await prisma.setorClickupList.update({ where: { id: projectId }, data: { status: next } }).catch(() => {});
  }
}

export async function syncProjectsStatus(ids: (string | null | undefined)[]): Promise<void> {
  for (const id of new Set(ids.filter((x): x is string => !!x))) await syncProjectStatus(id);
}

/**
 * Pontos da entrega (idempotentes por projeto): membros do projeto, ou quem
 * entregou se não há membros. Bônus no prazo / penalidade de atraso pelo dueDate.
 */
export async function awardProjectDelivery(opts: {
  projectId: string; companyId: string | null; dueDate: Date | null; deliveredAt: Date; fallbackUserId?: string;
}): Promise<void> {
  if (!opts.companyId) return;
  const members = await prisma.projectMember.findMany({ where: { projectId: opts.projectId }, select: { userId: true } });
  const recipients = members.length ? members.map((m) => m.userId) : opts.fallbackUserId ? [opts.fallbackUserId] : [];
  const noPrazo  = !opts.dueDate || opts.deliveredAt <= opts.dueDate;
  for (const uid of recipients) {
    void addScoreOnce(uid, opts.companyId, "PROJETO_ENTREGUE", opts.projectId).catch(() => {});
    void addScoreOnce(uid, opts.companyId, noPrazo ? "PROJETO_ENTREGUE_NO_PRAZO" : "PROJETO_ATRASADO", opts.projectId).catch(() => {});
  }
}
