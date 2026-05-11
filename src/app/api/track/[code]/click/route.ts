import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Endpoint PÚBLICO de tracking de cliques INTERNOS (botões/CTAs dentro
// da página de destino de um TrackingLink).
//
// Fluxo:
//   1. Cliente abre  /r/CODE  →  redireciona pra `destination?lh_ref=CODE`
//   2. Snippet JS no site da proposta (data-lh-track="…") chama:
//        POST /api/track/CODE/click  { button: "Solicitar Proposta", url }
//   3. Aqui criamos ClickEvent { kind: INTERNAL } — aparece como
//      "Clique dentro do link" na timeline do Lead.
//
// CORS aberto (Allow-Origin: *) porque é chamado de outros domínios
// (azzagencia.com.br, sites de clientes etc). Sem auth — só PÚBLICO.
// Não há resposta sensível: só "ok" ou silêncio (nem confirma se o
// código existe, evita enumeration).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Limite anti-abuso: ClickEvents por TrackingLink por minuto.
// 60 cliques em 1 min de um único link é absurdo — provavelmente bot/loop.
const RATE_LIMIT_PER_MIN = 60;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Body é opcional — se vier malformado, segue sem ele.
  let button: string | null = null;
  let url: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.button === "string") button = body.button.slice(0, 120);
    if (typeof body?.url === "string")    url    = body.url.slice(0, 500);
  } catch {
    // Sem body / body inválido → registra clique sem rótulo.
  }

  try {
    const link = await prisma.trackingLink.findUnique({
      where: { code },
      select: { id: true, destination: true },
    });
    // Silencioso em vez de 404 — não confirma se código existe (enumeration).
    if (!link) {
      return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
    }

    // Rate-limit: conta cliques internos do último minuto.
    // Se passou do limite, ignora silenciosamente. Cheap query — só count.
    const since = new Date(Date.now() - 60 * 1000);
    const recent = await prisma.clickEvent.count({
      where: {
        trackingLinkId: link.id,
        kind: "INTERNAL",
        createdAt: { gte: since },
      },
    });
    if (recent >= RATE_LIMIT_PER_MIN) {
      return NextResponse.json({ ok: true, throttled: true }, { headers: CORS_HEADERS });
    }

    await prisma.clickEvent.create({
      data: {
        trackingLinkId: link.id,
        targetUrl: url ?? link.destination,
        targetLabel: button,
        kind: "INTERNAL",
      },
    });
  } catch {
    // Nunca quebra o snippet do cliente por erro nosso.
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
