import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncOportunidadeToClickup } from "@/lib/clickup";
import { createConversationEvent } from "@/lib/conversation-events";
import { linkEmailsByAddress } from "@/lib/lead-email-link";
import { findCopyIds } from "@/lib/email-copies";

const PIPELINES = ["PROSPECCAO", "LEADS", "OPORTUNIDADES"];

// POST /api/email/inbox/[id]/create-lead
// { name?, email?, phone?, pipeline?, value?, notes? }
// Cria uma negociação a partir de um email e já vincula os dois. Além deste
// email, puxa o resto do histórico trocado com o mesmo endereço que ainda não
// está em negociação nenhuma — quem cria o lead pelo email quer a conversa
// inteira lá, não só a mensagem aberta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const perms = await getUserPermissions(session);
  if (!perms) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!perms.isAdmin && !perms.canCreateLeads) {
    return NextResponse.json({ error: "Sem permissão para criar leads" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const email = await prisma.inboxEmail.findFirst({
    where: { id, companyId },
    select: {
      id: true, direction: true, subject: true, snippet: true, textBody: true,
      fromEmail: true, fromName: true, toEmail: true, sentAt: true,
      leadId: true, accountId: true, messageId: true, aiSummary: true,
    },
  });
  if (!email) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });
  const allowed = perms.isAdmin ? null : perms.emailAccountIds;
  if (allowed && (!email.accountId || !allowed.includes(email.accountId))) {
    return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });
  }
  if (email.leadId) {
    return NextResponse.json({ error: "Este email já está vinculado a uma negociação" }, { status: 400 });
  }

  // Contato: no recebido é o remetente; no enviado, o primeiro destinatário.
  const contactEmail = String(
    body?.email ?? (email.direction === "IN" ? email.fromEmail : email.toEmail.split(",")[0] ?? ""),
  ).trim().toLowerCase();
  const name = String(body?.name ?? email.fromName ?? "").trim() || contactEmail.split("@")[0] || null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const pipeline = PIPELINES.includes(body?.pipeline) ? body.pipeline : "LEADS";
  const value = typeof body?.value === "number" && Number.isFinite(body.value) ? body.value : null;

  if (!name && !phone) {
    return NextResponse.json({ error: "Informe ao menos o nome ou o telefone" }, { status: 400 });
  }

  // Sem etapa informada, entra na primeira do pipeline (igual POST /api/leads).
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId, pipeline },
    orderBy: { order: "asc" },
    select: { name: true },
  });

  const notes = String(body?.notes ?? "").trim() ||
    `📧 Criada a partir de email.\nAssunto: ${email.subject || "(sem assunto)"}\nData: ${email.sentAt.toLocaleString("pt-BR")}${email.aiSummary ? `\nResumo IA: ${email.aiSummary}` : ""}`;

  const lead = await prisma.lead.create({
    data: {
      name,
      phone,
      email: contactEmail || null,
      source: "Email",
      notes,
      value,
      companyId,
      pipeline,
      pipelineStage: firstStage?.name ?? null,
    },
    select: { id: true, name: true, email: true, phone: true, pipeline: true, pipelineStage: true, value: true, notes: true },
  });

  // Vincula o email aberto e as cópias dele em outras caixas.
  await prisma.inboxEmail.update({ where: { id: email.id }, data: { leadId: lead.id } });
  const copyIds = await findCopyIds(companyId, [email]);
  if (copyIds.length) {
    await prisma.inboxEmail.updateMany({ where: { id: { in: copyIds } }, data: { leadId: lead.id } });
  }

  // Resto do histórico com o mesmo endereço (só o que está sem vínculo).
  let linked = 1;
  if (contactEmail) {
    linked = await linkEmailsByAddress(companyId, lead.id, contactEmail).catch(() => 0);
    linked += 1; // o email aberto já foi vinculado acima
  }

  // ClickUp só espelha Oportunidades — mesmo critério do POST /api/leads.
  if (pipeline === "OPORTUNIDADES") {
    try {
      const settings = await getClickupSettings(companyId);
      if (settings?.oportunidadesListId) {
        const taskId = await syncOportunidadeToClickup({
          settings,
          leadId: lead.id,
          name: lead.name ?? lead.phone,
          notes: lead.notes,
          value: lead.value,
          pipelineStage: lead.pipelineStage,
        });
        if (taskId) await prisma.lead.update({ where: { id: lead.id }, data: { clickupTaskId: taskId } });
      }
    } catch (e) {
      console.warn("[create-lead] sync ClickUp falhou (lead criado mesmo assim)", e);
    }
  }

  // Bolha na timeline da conversa só existe quando há telefone.
  if (lead.phone) {
    const isOpp = pipeline === "OPORTUNIDADES";
    void createConversationEvent({
      companyId,
      phone: lead.phone,
      type: isOpp ? "OPP_CREATED" : "LEAD_CREATED",
      message: `${isOpp ? "Oportunidade" : "Lead"} criada a partir de email: ${lead.name ?? lead.phone}`,
      authorId: (session.user as any).id ?? null,
      authorName: session.user?.name ?? null,
      meta: { leadId: lead.id, inboxEmailId: email.id },
    });
  }

  return NextResponse.json({
    ok: true,
    leadId: lead.id,
    lead: { id: lead.id, name: lead.name, email: lead.email, pipeline: lead.pipeline },
    linked,
  });
}
