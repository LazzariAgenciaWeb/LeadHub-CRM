import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// Carrega o link garantindo que pertence à empresa da sessão (SUPER_ADMIN vê tudo).
async function findOwnedLink(id: string) {
  const session = await getEffectiveSession();
  if (!session) return { error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const companyId = (session.user as any)?.companyId as string | undefined;
  const link = await prisma.trackingLink.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!link || (!isSuperAdmin && link.companyId !== companyId)) {
    return { error: NextResponse.json({ error: "Link não encontrado" }, { status: 404 }) };
  }
  return { link };
}

// PATCH /api/tracking-links/[id]
// { isActive?, label?, destination?, destType?, ogTitle?, ogDescription?, ogImage? }
// O `code` nunca muda: o /r/CODE já pode estar divulgado.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owned = await findOwnedLink(id);
  if (owned.error) return owned.error;

  const body = await req.json().catch(() => ({}));
  const data: {
    isActive?: boolean; label?: string | null; destination?: string; destType?: string;
    ogTitle?: string | null; ogDescription?: string | null; ogImage?: string | null;
  } = {};
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if ("label" in body) data.label = body.label?.trim() || null;
  if ("destination" in body) {
    const destination = String(body.destination ?? "").trim();
    if (!destination) return NextResponse.json({ error: "Destino é obrigatório" }, { status: 400 });
    data.destination = destination;
  }
  if (body.destType === "url" || body.destType === "whatsapp") data.destType = body.destType;
  if ("ogTitle" in body) data.ogTitle = body.ogTitle?.trim() || null;
  if ("ogDescription" in body) data.ogDescription = body.ogDescription?.trim() || null;
  if ("ogImage" in body) data.ogImage = body.ogImage?.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada a atualizar" }, { status: 400 });
  }

  const updated = await prisma.trackingLink.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// DELETE /api/tracking-links/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owned = await findOwnedLink(id);
  if (owned.error) return owned.error;

  await prisma.trackingLink.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
