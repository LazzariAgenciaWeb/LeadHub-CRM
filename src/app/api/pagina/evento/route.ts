import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, extractIp } from "@/lib/webhook-auth";
import { bioTrackingFields, isBioClientEvent } from "@/lib/bio-page";

// POST /api/pagina/evento
// Público (sem sessão): a página /p/[slug] registra visita, clique em bloco e
// início/fim das perguntas. Vem por navigator.sendBeacon (text/plain), então o
// corpo é lido como texto. Sempre 204 pro navegador — evento é best-effort e o
// visitante não tem o que fazer com erro.
export async function POST(req: NextRequest) {
  const ip = extractIp(req);
  if (!checkRateLimit(`bio-evento:${ip}`, 120).ok) {
    return new NextResponse(null, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim().toLowerCase();
  const kind = body.kind;
  if (!slug || !isBioClientEvent(kind)) return new NextResponse(null, { status: 400 });

  const page = await prisma.bioPage.findFirst({
    where: { slug, published: true, company: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (!page) return new NextResponse(null, { status: 404 });

  // Clique: o rótulo vem do banco, não do navegador — e só de bloco desta página.
  let blockId: string | null = null;
  let targetLabel: string | null = null;
  if (kind === "CLICK") {
    const block = typeof body.blockId === "string"
      ? await prisma.bioBlock.findFirst({
          where: { id: body.blockId, pageId: page.id },
          select: { id: true, title: true },
        })
      : null;
    if (!block) return new NextResponse(null, { status: 400 });
    blockId = block.id;
    targetLabel = block.title;
  }

  await prisma.bioEvent.create({
    data: { pageId: page.id, kind, blockId, targetLabel, ...bioTrackingFields(body) },
  });

  return new NextResponse(null, { status: 204 });
}
