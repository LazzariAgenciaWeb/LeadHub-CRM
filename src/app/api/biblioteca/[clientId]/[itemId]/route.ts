import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/storage/s3";
import { libraryAccess, normalizeFolder, normalizeUrl, LIBRARY_ITEM_SELECT } from "@/lib/client-library";

type Ctx = { params: Promise<{ clientId: string; itemId: string }> };

async function loadTeam(clientId: string, itemId: string) {
  const session = await getEffectiveSession();
  const acc = await libraryAccess(session, clientId);
  if (!acc.ok) return { res: NextResponse.json({ error: acc.error }, { status: acc.status }) };
  if (acc.role !== "team") return { res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  const item = await prisma.clientLibraryItem.findUnique({
    where: { id: itemId },
    select: { id: true, clientCompanyId: true, kind: true, storageObject: { select: { id: true, key: true } } },
  });
  if (!item || item.clientCompanyId !== clientId) {
    return { res: NextResponse.json({ error: "Item não encontrado" }, { status: 404 }) };
  }
  return { item };
}

// PATCH — título, pasta, descrição, link, "cliente vê".
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { clientId, itemId } = await params;
  const r = await loadTeam(clientId, itemId);
  if ("res" in r) return r.res;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim().slice(0, 200);
    if (!t) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });
    data.title = t;
  }
  if (body.folder !== undefined) data.folder = normalizeFolder(body.folder);
  if (body.description !== undefined) data.description = String(body.description ?? "").trim().slice(0, 2000) || null;
  if (body.visibleToClient !== undefined) data.visibleToClient = !!body.visibleToClient;
  if (body.url !== undefined && r.item.kind === "LINK") {
    const url = normalizeUrl(body.url);
    if (!url) return NextResponse.json({ error: "Link inválido" }, { status: 400 });
    data.url = url;
  }

  const item = await prisma.clientLibraryItem.update({ where: { id: itemId }, data, select: LIBRARY_ITEM_SELECT });
  return NextResponse.json({ item });
}

// DELETE — arquivo sai do MinIO junto (o item cai em cascata).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { clientId, itemId } = await params;
  const r = await loadTeam(clientId, itemId);
  if ("res" in r) return r.res;

  if (r.item.storageObject) {
    await deleteObject(r.item.storageObject.key).catch(() => {});
    await prisma.storageObject.delete({ where: { id: r.item.storageObject.id } });
  } else {
    await prisma.clientLibraryItem.delete({ where: { id: itemId } });
  }
  return NextResponse.json({ ok: true });
}
