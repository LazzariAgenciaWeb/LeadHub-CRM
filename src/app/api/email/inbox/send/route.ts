import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { sendInboxEmail } from "@/lib/imap-inbox";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// POST /api/email/inbox/send
// { to, subject, text, replyToId?, leadId?, ticketId? }
// Envia pelo SMTP da empresa (CompanyEmailConfig) e registra em ENVIADOS.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const role = (session.user as any).role as string;
  const companyId = role === "SUPER_ADMIN"
    ? (body?.companyId ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const to = String(body?.to ?? "").trim();
  const subject = String(body?.subject ?? "").trim();
  const text = String(body?.text ?? "").trim();
  if (!EMAIL_RE.test(to)) return NextResponse.json({ error: "Destinatário inválido" }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Assunto obrigatório" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Mensagem obrigatória" }, { status: 400 });

  // Anexos do upload: máx 5 arquivos, 8MB no total (base64 ≈ +33%).
  const rawAtts = Array.isArray(body?.attachments) ? body.attachments : [];
  if (rawAtts.length > 5) return NextResponse.json({ error: "Máximo de 5 anexos por email" }, { status: 400 });
  let totalBytes = 0;
  const attachments = rawAtts.map((a: any) => {
    const contentBase64 = String(a?.contentBase64 ?? "");
    totalBytes += Math.floor(contentBase64.length * 0.75);
    return {
      filename: String(a?.filename ?? "anexo").slice(0, 200),
      contentType: String(a?.contentType ?? "application/octet-stream"),
      contentBase64,
    };
  }).filter((a: any) => a.contentBase64);
  if (totalBytes > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Anexos passam de 8MB no total" }, { status: 400 });
  }

  // Vínculos são sempre validados contra a empresa da sessão.
  let leadId: string | null = null;
  let ticketId: string | null = null;
  if (body?.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: body.leadId, companyId }, select: { id: true } });
    if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    leadId = lead.id;
  }
  if (body?.ticketId) {
    const ticket = await prisma.ticket.findFirst({ where: { id: body.ticketId, companyId }, select: { id: true } });
    if (!ticket) return NextResponse.json({ error: "Chamado não encontrado" }, { status: 404 });
    ticketId = ticket.id;
  }

  try {
    const record = await sendInboxEmail(companyId, {
      to,
      subject,
      text,
      attachments,
      accountId: body?.accountId ?? null,
      replyToId: body?.replyToId ?? null,
      leadId,
      ticketId,
    });
    return NextResponse.json({ ok: true, id: record.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha ao enviar" }, { status: 400 });
  }
}
