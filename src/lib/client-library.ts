import { prisma } from "./prisma";

// Biblioteca de arquivos do cliente (ClientLibraryItem).
// Equipe da agência (empresa-mãe do cliente) gerencia; o cliente só lê o que
// estiver com visibleToClient.

export const DEFAULT_FOLDERS = ["Logos", "Redes sociais", "Impressos", "Vídeos", "Documentos"];

export type LibraryAccess =
  | { ok: true; role: "team" | "client"; clientId: string; agencyId: string; clientName: string }
  | { ok: false; status: 401 | 403 | 404; error: string };

export async function libraryAccess(session: any, clientId: string): Promise<LibraryAccess> {
  if (!session) return { ok: false, status: 401, error: "Não autorizado" };
  const role = session.user?.role as string | undefined;
  const userCompanyId = session.user?.companyId as string | undefined;

  const client = await prisma.company.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, parentCompanyId: true },
  });
  if (!client?.parentCompanyId) return { ok: false, status: 404, error: "Cliente não encontrado" };

  const base = { clientId: client.id, agencyId: client.parentCompanyId, clientName: client.name };
  if (role === "SUPER_ADMIN" || userCompanyId === client.parentCompanyId) return { ok: true, role: "team", ...base };
  if (userCompanyId === client.id) return { ok: true, role: "client", ...base };
  return { ok: false, status: 403, error: "Sem permissão" };
}

export function normalizeFolder(raw: unknown): string {
  const v = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return v || "Geral";
}

export function normalizeUrl(raw: unknown): string | null {
  let v = String(raw ?? "").trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const LIBRARY_ITEM_SELECT = {
  id: true, folder: true, kind: true, title: true, description: true, url: true,
  visibleToClient: true, createdByName: true, createdAt: true, updatedAt: true,
  storageObject: { select: { id: true, fileName: true, mimeType: true, size: true, status: true } },
} as const;
