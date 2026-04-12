import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Permite CORS para o script rodar em qualquer site.
// Usa a origem real do request (não wildcard) pois alguns browsers enviam
// credentials (cookies) no sendBeacon, e wildcard é inválido com credentials.
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

// POST /api/pixel/event — público, sem auth
// Body: { linkCode, targetUrl, targetLabel }
// Aceita application/json e text/plain (sendBeacon cross-origin usa text/plain)
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const text = await req.text();
    const { linkCode, targetUrl, targetLabel } = JSON.parse(text);
    if (!linkCode || !targetUrl) {
      return NextResponse.json({ ok: false }, { status: 400, headers: corsHeaders(origin) });
    }

    const link = await prisma.trackingLink.findUnique({ where: { code: linkCode } });
    if (!link) {
      return NextResponse.json({ ok: false }, { status: 404, headers: corsHeaders(origin) });
    }

    await prisma.clickEvent.create({
      data: {
        trackingLinkId: link.id,
        targetUrl,
        targetLabel: targetLabel || null,
      },
    });

    return NextResponse.json({ ok: true }, { headers: corsHeaders(origin) });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500, headers: corsHeaders(origin) });
  }
}
