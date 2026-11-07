import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, extractIp } from "@/lib/webhook-auth";
import { bioSnapshotAnswers, bioTrackingFields } from "@/lib/bio-page";

// POST /api/pagina/progresso
// Público (sem sessão): a /p/[slug] manda as respostas a cada etapa das
// perguntas, pra quem desiste antes do contato ainda contar o que queria.
// Só respostas (anônimo, por visitorId) — nome/telefone só vão no envio, com
// consentimento. Vem por sendBeacon (text/plain); sempre 204, best-effort.
export async function POST(req: NextRequest) {
  const ip = extractIp(req);
  if (!checkRateLimit(`bio-progresso:${ip}`, 60, 10 * 60_000).ok) {
    return new NextResponse(null, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim().toLowerCase();
  const tracking = bioTrackingFields(body);
  if (!slug || !tracking.visitorId) return new NextResponse(null, { status: 400 });

  const page = await prisma.bioPage.findFirst({
    where: { slug, published: true, company: { status: "ACTIVE" } },
    select: { id: true, questions: { where: { active: true }, select: { id: true, text: true, options: true, multiple: true } } },
  });
  if (!page) return new NextResponse(null, { status: 404 });

  const answers = bioSnapshotAnswers(page.questions, body.answers);
  const reachedForm = body.reachedForm === true;
  if (answers.length === 0 && !reachedForm) return new NextResponse(null, { status: 204 });

  const where = { pageId_visitorId: { pageId: page.id, visitorId: tracking.visitorId } };
  const prev = await prisma.bioProgress.findUnique({ where, select: { convertedAt: true } });
  // Já virou contato e voltou a responder: o novo questionário começa do zero.
  const restart = !!prev?.convertedAt;
  await prisma.bioProgress.upsert({
    where,
    create: {
      pageId: page.id,
      visitorId: tracking.visitorId,
      answers,
      reachedForm,
      referrer: tracking.referrer,
      utmSource: tracking.utmSource,
      utmMedium: tracking.utmMedium,
      utmCampaign: tracking.utmCampaign,
    },
    update: restart
      ? { answers, reachedForm, convertedAt: null, submissionId: null }
      : { answers, ...(reachedForm ? { reachedForm: true } : {}) },
  });

  return new NextResponse(null, { status: 204 });
}
