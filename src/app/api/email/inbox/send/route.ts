import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
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

  // Restrição por setor: CLIENT só envia pelas caixas liberadas.
  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;
  let accountId: string | null = body?.accountId ?? null;
  if (allowed) {
    if (!allowed.length) return NextResponse.json({ error: "Nenhuma caixa de email liberada pro seu setor" }, { status: 403 });
    if (accountId && !allowed.includes(accountId)) {
      return NextResponse.json({ error: "Caixa não liberada pro seu setor" }, { status: 403 });
    }
    if (!accountId) accountId = allowed[0];
  }

  // Listas de endereço: aceita vários separados por vírgula/ponto-e-vírgula.
  const parseAddrList = (v: unknown): { ok: true; value: string | null } | { ok: false; bad: string } => {
    const items = String(v ?? "").split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!items.length) return { ok: true, value: null };
    for (const item of items) if (!EMAIL_RE.test(item)) return { ok: false, bad: item };
    return { ok: true, value: items.join(", ") };
  };

  const toParsed = parseAddrList(body?.to);
  if (!toParsed.ok) return NextResponse.json({ error: `Destinatário inválido: ${toParsed.bad}` }, { status: 400 });
  const to = toParsed.value ?? "";
  const ccParsed = parseAddrList(body?.cc);
  if (!ccParsed.ok) return NextResponse.json({ error: `Cc inválido: ${ccParsed.bad}` }, { status: 400 });
  const bccParsed = parseAddrList(body?.bcc);
  if (!bccParsed.ok) return NextResponse.json({ error: `Cco inválido: ${bccParsed.bad}` }, { status: 400 });
  const subject = String(body?.subject ?? "").trim();
  const text = String(body?.text ?? "").trim();
  if (!to) return NextResponse.json({ error: "Destinatário inválido" }, { status: 400 });
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
      cc: ccParsed.value,
      bcc: bccParsed.value,
      subject,
      text,
      attachments,
      accountId,
      replyToId: body?.replyToId ?? null,
      leadId,
      ticketId,
    });
    return NextResponse.json({ ok: true, id: record.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha ao enviar" }, { status: 400 });
  }
}
