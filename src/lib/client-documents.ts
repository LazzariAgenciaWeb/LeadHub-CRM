import { prisma } from "./prisma";
import { DOCUMENT_TYPES } from "./sale-contract";

export class DocumentError extends Error {}

/**
 * Anexa um documento ao cliente (link ou arquivo já enviado ao MinIO).
 * Usado pela Central do Cliente e pela ferramenta anexar_documento.
 */
export async function createClientDocument(i: {
  agencyId: string;
  clientCompanyId: string;
  type: unknown;
  title: unknown;
  url?: unknown;
  storageObjectId?: unknown;
  saleId?: unknown;
  documentDate?: Date | null;
  notes?: unknown;
  createdById?: string | null;
  createdByName?: string | null;
}) {
  const type = String(i.type ?? "").trim().toUpperCase();
  if (!DOCUMENT_TYPES.includes(type as any)) {
    throw new DocumentError(`Tipo inválido. Use: ${DOCUMENT_TYPES.join(", ")}.`);
  }
  const title = String(i.title ?? "").trim().slice(0, 200);
  if (!title) throw new DocumentError("Dê um título ao documento.");

  const url = i.url ? String(i.url).trim() : "";
  if (url && !/^https?:\/\//i.test(url)) throw new DocumentError("O link precisa começar com http:// ou https://");
  const storageObjectId = i.storageObjectId ? String(i.storageObjectId) : null;
  if (!url && !storageObjectId) throw new DocumentError("Informe o link ou envie o arquivo.");

  if (storageObjectId) {
    // Só arquivo enviado pra ESTE cliente (upload com libraryCompanyId).
    const obj = await prisma.storageObject.findFirst({
      where: { id: storageObjectId, libraryCompanyId: i.clientCompanyId, status: "READY" },
      select: { id: true },
    });
    if (!obj) throw new DocumentError("Arquivo não encontrado (ou ainda não terminou de subir).");
  }

  let saleId: string | null = null;
  if (i.saleId) {
    const s = await prisma.sale.findFirst({
      where: { id: String(i.saleId), companyId: i.agencyId, clientCompanyId: i.clientCompanyId },
      select: { id: true },
    });
    if (!s) throw new DocumentError("Venda/contrato não pertence a este cliente.");
    saleId = s.id;
  }

  if (i.documentDate && Number.isNaN(i.documentDate.getTime())) throw new DocumentError("Data do documento inválida.");

  return prisma.clientDocument.create({
    data: {
      companyId: i.agencyId,
      clientCompanyId: i.clientCompanyId,
      type,
      title,
      url: url || null,
      storageObjectId,
      saleId,
      documentDate: i.documentDate ?? null,
      notes: i.notes ? String(i.notes).slice(0, 2000) : null,
      createdById: i.createdById ?? null,
      createdByName: i.createdByName ?? null,
    },
  });
}
