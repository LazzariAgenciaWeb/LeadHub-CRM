import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeTicket, canSeeProject } from "@/lib/visibility";

// Quem pode subir/ver arquivo é quem pode ver o "dono" do arquivo (chamado ou
// tarefa de projeto) — mesmas regras de empresa + visibilidade das rotas de
// chamado/projeto. Nunca autorizar pelo StorageObject sozinho.

export type StorageTarget =
  | { kind: "ticket"; ticketId: string }
  | { kind: "projectTask"; projectTaskId: string }
  | { kind: "library"; libraryCompanyId: string };

// asClient = quem acessa é o próprio cliente (só leitura, e só o que estiver
// liberado pra ele) — hoje só acontece na biblioteca.
type Ok = { ok: true; companyId: string; target: StorageTarget; asClient?: boolean };
type Fail = { ok: false; status: 400 | 403 | 404; error: string };

export function parseTarget(input: { ticketId?: unknown; projectTaskId?: unknown; libraryCompanyId?: unknown }): StorageTarget | null {
  if (typeof input.ticketId === "string" && input.ticketId) return { kind: "ticket", ticketId: input.ticketId };
  if (typeof input.libraryCompanyId === "string" && input.libraryCompanyId) {
    return { kind: "library", libraryCompanyId: input.libraryCompanyId };
  }
  if (typeof input.projectTaskId === "string" && input.projectTaskId) {
    return { kind: "projectTask", projectTaskId: input.projectTaskId };
  }
  return null;
}

/** Confere se a sessão enxerga o alvo. Devolve a empresa dona (consome a cota).
 *  write=true: subir arquivo — o cliente nunca grava na biblioteca. */
export async function authorizeTarget(
  session: any,
  target: StorageTarget,
  opts: { write?: boolean } = {},
): Promise<Ok | Fail> {
  const role = session?.user?.role as string | undefined;
  const userCompanyId = session?.user?.companyId as string | undefined;

  if (target.kind === "library") {
    const client = await prisma.company.findUnique({
      where: { id: target.libraryCompanyId },
      select: { id: true, parentCompanyId: true },
    });
    if (!client?.parentCompanyId) return { ok: false, status: 404, error: "Cliente não encontrado" };
    // Arquivo conta na agência (dona do trabalho), não no cliente.
    const agencyId = client.parentCompanyId;
    if (role === "SUPER_ADMIN" || userCompanyId === agencyId) {
      return { ok: true, companyId: agencyId, target };
    }
    if (userCompanyId === client.id && !opts.write) {
      return { ok: true, companyId: agencyId, target, asClient: true };
    }
    return { ok: false, status: 403, error: "Sem permissão" };
  }

  if (target.kind === "ticket") {
    const ticket = await prisma.ticket.findUnique({
      where: { id: target.ticketId },
      include: { accessUsers: { select: { userId: true } } },
    });
    if (!ticket) return { ok: false, status: 404, error: "Chamado não encontrado" };
    if (role !== "SUPER_ADMIN" && ticket.companyId !== userCompanyId) {
      return { ok: false, status: 403, error: "Sem permissão" };
    }
    const viewer = await getViewer(session);
    if (!canSeeTicket(viewer, { ...ticket, accessUserIds: ticket.accessUsers.map((a) => a.userId) })) {
      return { ok: false, status: 403, error: "Sem permissão" };
    }
    return { ok: true, companyId: ticket.companyId, target };
  }

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return { ok: false, status: 403, error: "Módulo Projetos não habilitado" };

  const task = await prisma.projectTask.findUnique({
    where: { id: target.projectTaskId },
    include: {
      project: {
        include: {
          setor:       { select: { companyId: true } },
          members:     { select: { userId: true } },
          accessUsers: { select: { userId: true } },
        },
      },
    },
  });
  if (!task) return { ok: false, status: 404, error: "Tarefa não encontrada" };
  const companyId = task.project.setor.companyId;
  if (role !== "SUPER_ADMIN" && companyId !== userCompanyId) {
    return { ok: false, status: 403, error: "Sem permissão" };
  }
  const viewer = await getViewer(session);
  if (!canSeeProject(viewer, {
    visibility: task.project.visibility,
    setorId: task.project.setorId,
    memberIds: task.project.members.map((m) => m.userId),
    accessUserIds: task.project.accessUsers.map((a) => a.userId),
  })) {
    return { ok: false, status: 403, error: "Sem permissão" };
  }
  return { ok: true, companyId, target };
}

/** Alvo de um arquivo já gravado. */
export function targetOf(obj: { ticketId: string | null; projectTaskId: string | null; libraryCompanyId?: string | null }): StorageTarget | null {
  if (obj.ticketId) return { kind: "ticket", ticketId: obj.ticketId };
  if (obj.libraryCompanyId) return { kind: "library", libraryCompanyId: obj.libraryCompanyId };
  if (obj.projectTaskId) return { kind: "projectTask", projectTaskId: obj.projectTaskId };
  return null;
}

// Executáveis/scripts ficam de fora — o resto (docs, planilhas, imagens,
// vídeos, zips, arquivos de design) passa.
const BLOCKED_EXT = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "vbe", "js", "jse",
  "wsf", "wsh", "ps1", "sh", "jar", "app", "dmg", "apk", "dll", "html", "htm", "svg",
]);

export function validateFileName(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (BLOCKED_EXT.has(ext)) return `Tipo de arquivo não permitido (.${ext})`;
  return null;
}

/** Nome seguro pra compor a chave no bucket (o nome original fica no banco). */
export function safeKeyName(fileName: string): string {
  const cleaned = fileName
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
  return cleaned || "arquivo";
}

export function isManager(session: any): boolean {
  const role = session?.user?.role as string | undefined;
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
