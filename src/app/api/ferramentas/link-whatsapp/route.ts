import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  WA_TOOL_MAX_MESSAGE,
  WA_TOOL_SOURCE,
  isValidWaPhone,
  normalizeWaPhone,
} from "@/lib/whatsapp-link-tool";

// POST /api/ferramentas/link-whatsapp
// Endpoint público (sem sessão) chamado pela página /ferramentas/link-whatsapp/[slug]
// no momento em que o visitante copia o link gerado. O número e a mensagem que
// ele configurou viram um lead no funil LEADS da empresa dona da página.
//
// Identificação da empresa pelo slug (público por natureza) — o webhookToken
// fica fora da URL de propósito: ele dá escrita ampla no CRM, esta rota só
// cria lead com origem fixa.
export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim().toLowerCase();
  const phone = normalizeWaPhone(String(body.phone ?? ""));
  const message = String(body.message ?? "").trim().slice(0, WA_TOOL_MAX_MESSAGE);

  if (!slug) return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
  if (!isValidWaPhone(phone)) {
    return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });
  }

  const company = await prisma.company.findFirst({
    where: { slug, status: "ACTIVE" },
    select: { id: true },
  });
  if (!company) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });

  const note = message
    ? `Gerador de link do WhatsApp — mensagem configurada:\n"${message}"`
    : "Gerador de link do WhatsApp — gerou link sem mensagem.";

  // Mesmo número já no CRM (qualquer funil): só anexa a mensagem nova às
  // observações, sem mover de etapa nem duplicar.
  const existing = await prisma.lead.findFirst({
    where: { companyId: company.id, phone },
    orderBy: { createdAt: "desc" },
    select: { id: true, notes: true },
  });

  if (existing) {
    const alreadyLogged = existing.notes?.includes(note) ?? false;
    if (!alreadyLogged) {
      await prisma.lead.update({
        where: { id: existing.id },
        data: { notes: existing.notes ? `${existing.notes}\n\n${note}` : note },
      });
    }
    return NextResponse.json({ ok: true, leadId: existing.id, updated: true });
  }

  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId: company.id, pipeline: "LEADS" },
    orderBy: { order: "asc" },
    select: { name: true },
  });

  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      phone,
      source: WA_TOOL_SOURCE,
      status: "NEW",
      pipeline: "LEADS",
      pipelineStage: firstStage?.name ?? null,
      notes: note,
      hasWhatsapp: true,
      clientIp,
      clientUserAgent: req.headers.get("user-agent") || null,
      eventSourceUrl: req.headers.get("referer") || null,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, leadId: lead.id, created: true }, { status: 201 });
}
