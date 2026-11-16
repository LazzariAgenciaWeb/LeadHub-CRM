import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { clientCentralScope } from "@/lib/client-central";
import { createClientDocument, DocumentError } from "@/lib/client-documents";

// POST /api/companies/[id]/central/documentos
// Body: { type, title, url?, storageObjectId?, saleId?, documentDate?, notes? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const scope = await clientCentralScope(session, id);
  if (!scope) return NextResponse.json({ error: "Sem acesso a este cliente" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  try {
    const doc = await createClientDocument({
      agencyId: scope.agencyId,
      clientCompanyId: id,
      type: body?.type,
      title: body?.title,
      url: body?.url,
      storageObjectId: body?.storageObjectId,
      saleId: body?.saleId,
      documentDate: body?.documentDate ? new Date(String(body.documentDate)) : null,
      notes: body?.notes,
      createdById: (session.user as any)?.id ?? null,
      createdByName: (session.user as any)?.name ?? (session.user as any)?.email ?? null,
    });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (e) {
    if (e instanceof DocumentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

// DELETE /api/companies/[id]/central/documentos?docId=…
// Apaga o registro. Arquivo no MinIO continua (apagar o binário é pela tela
// de arquivos) — documento de contrato é prova, não some num clique.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const scope = await clientCentralScope(session, id);
  if (!scope) return NextResponse.json({ error: "Sem acesso a este cliente" }, { status: 403 });
  const docId = req.nextUrl.searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "docId obrigatório" }, { status: 400 });
  const r = await prisma.clientDocument.deleteMany({ where: { id: docId, clientCompanyId: id } });
  if (r.count === 0) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
