import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, extractIp } from "@/lib/webhook-auth";
import { isValidWaPhone, normalizeWaPhone } from "@/lib/whatsapp-link-tool";
import { BIO_LEAD_SOURCE, bioTrackingFields } from "@/lib/bio-page";

// POST /api/pagina/contato
// Público (sem sessão): o visitante da /p/[slug] respondeu as perguntas e
// deixou o contato. Vira lead no funil LEADS da empresa dona da página.
//
// As respostas ficam SÓ no BioSubmission (relatório dos admins) — não vão pras
// observações do lead, que o cliente enxerga no CRM. Decisão de produto: no
// grátis o cliente vê nome e telefone; o detalhe é argumento do Starter.

const NOTE = "Página do Negócio — deixou o contato pela página.";

interface AnswerIn { questionId?: unknown; answer?: unknown }

export async function POST(req: NextRequest) {
  const ip = extractIp(req);
  if (!checkRateLimit(`bio-contato:${ip}`, 8, 10 * 60_000).ok) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo em alguns minutos." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Campo-armadilha: invisível pra gente, robô preenche. Finge sucesso.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  const slug = String(body.slug ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim().slice(0, 120);
  const phone = normalizeWaPhone(String(body.phone ?? ""));
  const emailRaw = String(body.email ?? "").trim().toLowerCase().slice(0, 200);

  if (!slug) return NextResponse.json({ error: "Página não informada" }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 });
  if (!isValidWaPhone(phone)) return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json({ error: "É preciso concordar com o uso dos dados" }, { status: 400 });
  }
  const email = emailRaw || null;

  const page = await prisma.bioPage.findFirst({
    where: { slug, published: true, company: { status: "ACTIVE" } },
    select: {
      id: true,
      companyId: true,
      questions: { where: { active: true }, select: { id: true, text: true, options: true } },
    },
  });
  if (!page) return NextResponse.json({ error: "Página não encontrada" }, { status: 404 });

  // Snapshot das respostas: só pergunta desta página e opção que existe nela.
  const byId = new Map(page.questions.map((q) => [q.id, q]));
  const answers: { questionId: string; question: string; answer: string }[] = [];
  for (const a of Array.isArray(body.answers) ? (body.answers as AnswerIn[]) : []) {
    const q = typeof a?.questionId === "string" ? byId.get(a.questionId) : undefined;
    const answer = typeof a?.answer === "string" ? a.answer : "";
    if (!q || !q.options.includes(answer) || answers.some((x) => x.questionId === q.id)) continue;
    answers.push({ questionId: q.id, question: q.text, answer });
  }

  const tracking = bioTrackingFields(body);
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;
  const clientIp = ip === "unknown" ? null : ip;

  // Mesmo telefone já no CRM (qualquer funil): completa nome/e-mail que faltam
  // e anota a origem uma vez, sem mover de etapa nem duplicar.
  const existing = await prisma.lead.findFirst({
    where: { companyId: page.companyId, phone },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, notes: true },
  });

  let leadId: string;
  if (existing) {
    leadId = existing.id;
    await prisma.lead.update({
      where: { id: existing.id },
      data: {
        name: existing.name || name,
        email: existing.email || email,
        notes: existing.notes?.includes(NOTE)
          ? existing.notes
          : existing.notes ? `${existing.notes}\n\n${NOTE}` : NOTE,
      },
    });
  } else {
    const firstStage = await prisma.pipelineStageConfig.findFirst({
      where: { companyId: page.companyId, pipeline: "LEADS" },
      orderBy: { order: "asc" },
      select: { name: true },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: page.companyId,
        name,
        phone,
        email,
        source: BIO_LEAD_SOURCE,
        status: "NEW",
        pipeline: "LEADS",
        pipelineStage: firstStage?.name ?? null,
        notes: NOTE,
        clientIp,
        clientUserAgent: userAgent,
        eventSourceUrl: req.headers.get("referer") || null,
      },
      select: { id: true },
    });
    leadId = lead.id;
  }

  await prisma.$transaction([
    prisma.bioSubmission.create({
      data: {
        pageId: page.id,
        leadId,
        answers,
        name,
        phone,
        email,
        consent: true,
        clientIp,
        userAgent,
        ...tracking,
      },
    }),
    prisma.bioEvent.create({
      data: { pageId: page.id, kind: "LEAD", ...tracking },
    }),
  ]);

  return NextResponse.json({ ok: true }, { status: 201 });
}
