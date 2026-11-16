import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { clientRecordAccess } from "@/lib/permissions";
import { clientCentralScope, loadClientContracts } from "@/lib/client-central";

// GET /api/companies/[id]/central — contratos (com aceite/faturamento e a
// negociação de origem), documentos e links fixos (Drive, ClickUp).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const scope = await clientCentralScope(session, id);
  if (!scope) return NextResponse.json({ error: "Sem acesso a este cliente" }, { status: 403 });
  const access = clientRecordAccess(session);

  const [contracts, documents, catalog] = await Promise.all([
    access.financeiro || access.negociacoes ? loadClientContracts(id, scope.agencyId) : Promise.resolve([]),
    prisma.clientDocument.findMany({
      where: { clientCompanyId: id },
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
      include: {
        sale: { select: { id: true, title: true } },
        storageObject: { select: { fileName: true, mimeType: true, size: true } },
      },
    }),
    prisma.service.findMany({
      where: { companyId: scope.agencyId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return NextResponse.json({
    canEditContracts: access.financeiro,
    links: { driveFolderUrl: scope.client.driveFolderUrl, clickupListUrl: scope.client.clickupListUrl },
    contracts,
    documents: documents.map((d) => ({
      id: d.id, type: d.type, title: d.title, url: d.url, notes: d.notes,
      fileUrl: d.storageObjectId ? `/api/storage/${d.storageObjectId}` : null,
      fileName: d.storageObject?.fileName ?? null,
      sale: d.sale, documentDate: d.documentDate?.toISOString() ?? null,
      createdByName: d.createdByName, createdAt: d.createdAt.toISOString(),
    })),
    catalog,
  });
}

function cleanUrl(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) throw new Error("O link precisa começar com http:// ou https://");
  return s.slice(0, 1000);
}

// PATCH /api/companies/[id]/central — { driveFolderUrl?, clickupListUrl? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const scope = await clientCentralScope(session, id);
  if (!scope) return NextResponse.json({ error: "Sem acesso a este cliente" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  let driveFolderUrl: string | null | undefined;
  let clickupListUrl: string | null | undefined;
  try {
    driveFolderUrl = cleanUrl(body?.driveFolderUrl);
    clickupListUrl = cleanUrl(body?.clickupListUrl);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const updated = await prisma.company.update({
    where: { id },
    data: {
      ...(driveFolderUrl !== undefined ? { driveFolderUrl } : {}),
      ...(clickupListUrl !== undefined ? { clickupListUrl } : {}),
    },
    select: { driveFolderUrl: true, clickupListUrl: true },
  });
  return NextResponse.json({ links: updated });
}
