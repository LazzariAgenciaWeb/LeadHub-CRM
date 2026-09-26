import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { storageEnabled } from "@/lib/storage/s3";
import {
  libraryAccess, normalizeFolder, normalizeUrl, LIBRARY_ITEM_SELECT, DEFAULT_FOLDERS,
} from "@/lib/client-library";

// GET /api/biblioteca/[clientId] — itens da biblioteca do cliente.
// Equipe vê tudo; o cliente só o que está liberado.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await getEffectiveSession();
  const { clientId } = await params;
  const acc = await libraryAccess(session, clientId);
  if (!acc.ok) return NextResponse.json({ error: acc.error }, { status: acc.status });

  const rows = await prisma.clientLibraryItem.findMany({
    where: { clientCompanyId: clientId, ...(acc.role === "client" ? { visibleToClient: true } : {}) },
    orderBy: [{ folder: "asc" }, { createdAt: "desc" }],
    select: LIBRARY_ITEM_SELECT,
  });
  // Arquivo que não terminou de subir não aparece.
  const items = rows.filter((r) => r.kind !== "FILE" || r.storageObject?.status === "READY");
  return NextResponse.json({
    items,
    role: acc.role,
    defaultFolders: DEFAULT_FOLDERS,
    storageEnabled: storageEnabled(),
  });
}

// POST /api/biblioteca/[clientId] — equipe adiciona um item.
// LINK: { kind:"LINK", title, url, folder?, description?, visibleToClient? }
// FILE: { kind:"FILE", storageObjectId, title?, folder?, description?, visibleToClient? }
//       (o arquivo já subiu via /api/storage com libraryCompanyId)
export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await getEffectiveSession();
  const { clientId } = await params;
  const acc = await libraryAccess(session, clientId);
  if (!acc.ok) return NextResponse.json({ error: acc.error }, { status: acc.status });
  if (acc.role !== "team") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind === "FILE" ? "FILE" : "LINK";
  const folder = normalizeFolder(body?.folder);
  const description = String(body?.description ?? "").trim().slice(0, 2000) || null;
  const visibleToClient = body?.visibleToClient !== false;
  const createdById = (session!.user as any)?.id ?? null;
  const createdByName = (session!.user as any)?.name ?? null;

  if (kind === "LINK") {
    const url = normalizeUrl(body?.url);
    if (!url) return NextResponse.json({ error: "Link inválido" }, { status: 400 });
    const title = String(body?.title ?? "").trim().slice(0, 200) || new URL(url).hostname;
    const item = await prisma.clientLibraryItem.create({
      data: { clientCompanyId: clientId, kind, folder, title, url, description, visibleToClient, createdById, createdByName },
      select: LIBRARY_ITEM_SELECT,
    });
    return NextResponse.json({ item }, { status: 201 });
  }

  const storageObjectId = String(body?.storageObjectId ?? "");
  const obj = storageObjectId
    ? await prisma.storageObject.findUnique({
        where: { id: storageObjectId },
        select: { id: true, fileName: true, status: true, libraryCompanyId: true },
      })
    : null;
  if (!obj || obj.libraryCompanyId !== clientId || obj.status !== "READY") {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }
  const title = String(body?.title ?? "").trim().slice(0, 200) || obj.fileName;
  const item = await prisma.clientLibraryItem.create({
    data: {
      clientCompanyId: clientId, kind, folder, title, description, visibleToClient,
      storageObjectId: obj.id, createdById, createdByName,
    },
    select: LIBRARY_ITEM_SELECT,
  });
  return NextResponse.json({ item }, { status: 201 });
}
