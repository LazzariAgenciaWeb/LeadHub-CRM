import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { evolutionFetchProfilePicture } from "@/lib/evolution";
import { getHiddenInstanceIds, conversationVisibilityAnd } from "@/lib/whatsapp-visibility";

// GET /api/whatsapp/avatar?phone=...
// Serve a foto de perfil PELO NOSSO domínio, em vez de apontar o <img> direto
// pro CDN da Meta (pps.whatsapp.net). Motivo: bloqueador de rastreador —
// Opera GX, Brave, uBlock e afins cortam requisição pra domínio da Meta, e a
// foto simplesmente não carregava, mesmo com a URL válida no banco.
//
// Bônus: a URL do CDN expira. Aqui, se o CDN recusar, a gente repergunta à
// Evolution e tenta de novo — o navegador nunca vê URL velha.

export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return new NextResponse(null, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return new NextResponse(null, { status: 403 });

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin  = userRole === "SUPER_ADMIN";

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone") ?? "";
  if (!phone) return new NextResponse(null, { status: 400 });

  const companyId = isSuperAdmin ? (searchParams.get("companyId") ?? "") : (userCompanyId ?? "");

  const hiddenInstanceIds = await getHiddenInstanceIds(session);
  const conv = await prisma.conversation.findFirst({
    where: {
      phone,
      ...(companyId ? { companyId } : {}),
      AND: conversationVisibilityAnd({ hiddenIds: hiddenInstanceIds }),
    },
    select: {
      id: true, phone: true, companyId: true, avatarUrl: true,
      instance: { select: { instanceName: true, instanceToken: true, status: true } },
    },
  });
  if (!conv) return new NextResponse(null, { status: 404 });

  async function renovarUrl(): Promise<string | null> {
    if (!conv) return null;
    let inst: { instanceName: string; instanceToken: string | null } | null =
      conv.instance?.status === "CONNECTED"
        ? { instanceName: conv.instance.instanceName, instanceToken: conv.instance.instanceToken }
        : null;
    if (!inst) {
      inst = await prisma.whatsappInstance.findFirst({
        where: { companyId: conv.companyId, status: "CONNECTED" },
        select: { instanceName: true, instanceToken: true },
      });
    }
    if (!inst) return null;
    const alvo = conv.phone.includes("@") ? conv.phone : conv.phone.replace(/\D/g, "");
    const nova = await evolutionFetchProfilePicture(inst.instanceName, alvo, inst.instanceToken);
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { avatarUrl: nova, avatarCheckedAt: new Date() },
    }).catch(() => {});
    return nova;
  }

  async function baixar(url: string) {
    try {
      return await fetch(url, { cache: "no-store" });
    } catch {
      return null;
    }
  }

  let url = conv.avatarUrl;
  let res = url ? await baixar(url) : null;

  // URL expirada (o CDN devolve 403/404) → repergunta e tenta uma vez
  if (!res || !res.ok) {
    url = await renovarUrl();
    res = url ? await baixar(url) : null;
  }
  if (!res || !res.ok) return new NextResponse(null, { status: 404 });

  const buf = Buffer.from(await res.arrayBuffer());
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
      // Privado (é foto de contato de cliente) e curto — a pessoa pode trocar
      // a foto; meia hora é tempo de sobra pra poupar as idas ao CDN.
      "Cache-Control": "private, max-age=1800",
    },
  });
}
