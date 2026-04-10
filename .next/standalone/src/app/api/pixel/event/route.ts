import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Permite CORS para o script rodar em qualquer site
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// POST /api/pixel/event — público, sem auth
// Body: { linkCode, targetUrl, targetLabel }
export async function POST(req: NextRequest) {
  try {
    const { linkCode, targetUrl, targetLabel } = await req.json();
    if (!linkCode || !targetUrl) {
      return NextResponse.json({ ok: false }, { status: 400, headers: corsHeaders() });
    }

    const link = await prisma.trackingLink.findUnique({ where: { code: linkCode } });
    if (!link) {
      return NextResponse.json({ ok: false }, { status: 404, headers: corsHeaders() });
    }

    await prisma.clickEvent.create({
      data: {
        trackingLinkId: link.id,
        targetUrl,
        targetLabel: targetLabel || null,
      },
    });

    return NextResponse.json({ ok: true }, { headers: corsHeaders() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500, headers: corsHeaders() });
  }
}
