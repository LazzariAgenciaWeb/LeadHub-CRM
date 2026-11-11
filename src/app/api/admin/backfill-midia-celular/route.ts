import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Backfill idempotente (2026-11-11): mensagem enviada DO CELULAR da equipe era
 * gravada sem mediaType — áudio e foto viravam só o texto "🎵 Áudio" /
 * "🖼️ Imagem", sem player, sem abrir a imagem e sem nada pra transcrever.
 *
 * O rawPayload do webhook guarda a mensagem inteira, então dá pra recuperar o
 * mime do histórico. A mídia em si continua sendo buscada sob demanda pelo
 * /media — aqui só carimbamos o tipo.
 *
 * ?transcribe=1 também enfileira a transcrição dos áudios recuperados (chamada
 * paga: ~US$ 0,006 por minuto). Sem o parâmetro, só destrava o player e o
 * botão "Transcrever" da conversa.
 *
 * Protegido por CRON_SECRET, igual aos demais jobs internos.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const alsoTranscribe = req.nextUrl.searchParams.get("transcribe") === "1";
  const limit = Math.min(1000, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "500", 10) || 500));

  // Candidatas: nossas, sem mediaType, com cara de mídia no corpo.
  const candidatas = await prisma.message.findMany({
    where: {
      direction: "OUTBOUND",
      mediaType: null,
      OR: [{ body: { contains: "Áudio" } }, { body: { contains: "Imagem" } }],
    },
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: { id: true, companyId: true, rawPayload: true },
  });

  let audios = 0;
  let imagens = 0;
  const paraTranscrever: { id: string; companyId: string }[] = [];

  for (const m of candidatas) {
    const raw = m.rawPayload as any;
    const message = raw?.data?.message ?? raw?.message;
    if (!message) continue;

    const audio = message.audioMessage ?? message.pttMessage;
    const imagem = message.imageMessage;
    const mediaType: string | null = audio
      ? (audio.mimetype ?? "audio/ogg; codecs=opus")
      : imagem
        ? (imagem.mimetype ?? "image/jpeg")
        : null;
    if (!mediaType) continue;

    await prisma.message.update({ where: { id: m.id }, data: { mediaType } }).catch(() => {});
    if (audio) {
      audios++;
      paraTranscrever.push({ id: m.id, companyId: m.companyId });
    } else {
      imagens++;
    }
  }

  let transcritos = 0;
  if (alsoTranscribe && paraTranscrever.length) {
    const { transcribeAudioMessage } = await import("@/lib/transcribe");
    for (const a of paraTranscrever) {
      const r = await transcribeAudioMessage(a.id);
      if (r.ok && r.transcript) transcritos++;
    }
  }

  return NextResponse.json({
    ok: true,
    analisadas: candidatas.length,
    audios,
    imagens,
    transcritos,
    restam: candidatas.length === limit ? "rode de novo — veio o lote cheio" : 0,
  });
}
