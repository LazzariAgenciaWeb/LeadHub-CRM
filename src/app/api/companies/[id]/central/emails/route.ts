import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { getUserPermissions } from "@/lib/user-permissions";
import { clientCentralScope } from "@/lib/client-central";
import { linkPastEmailsForClient, setEmailClient } from "@/lib/client-email-link";
import { ContractError, confirmBilling, recordAcceptance } from "@/lib/sale-contract";

const SELECT = {
  id: true, direction: true, folder: true, fromEmail: true, fromName: true, toEmail: true,
  subject: true, snippet: true, aiSummary: true, sentAt: true, clientCompanyId: true,
  clientLinkSource: true, clientMark: true, suspicious: true,
  clientCompany: { select: { id: true, name: true } },
  _count: { select: { attachments: true } },
} as const;

async function allowedAccounts(session: any): Promise<string[] | null> {
  const perms = await getUserPermissions(session);
  return perms && !perms.isAdmin ? perms.emailAccountIds : null;
}

// GET /api/companies/[id]/central/emails
//   ?q=texto&dir=IN|OUT     → e-mails ligados a este cliente
//   ?mode=search&q=texto     → busca na caixa inteira, pra ligar à mão
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const scope = await clientCentralScope(session, id);
  if (!scope) return NextResponse.json({ error: "Sem acesso a este cliente" }, { status: 403 });

  const contas = await allowedAccounts(session);
  if (contas && contas.length === 0) return NextResponse.json({ emails: [], noAccess: true });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const search = sp.get("mode") === "search";
  const dir = sp.get("dir");

  const where: any = {
    companyId: scope.agencyId,
    folder: { notIn: ["TRASH", "SPAM"] },
    ...(contas ? { accountId: { in: contas } } : {}),
    ...(search ? {} : { clientCompanyId: id }),
    ...(dir === "IN" || dir === "OUT" ? { direction: dir } : {}),
  };
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { fromEmail: { contains: q, mode: "insensitive" } },
      { fromName: { contains: q, mode: "insensitive" } },
      { toEmail: { contains: q, mode: "insensitive" } },
      { snippet: { contains: q, mode: "insensitive" } },
    ];
  } else if (search) {
    return NextResponse.json({ emails: [] });
  }

  const emails = await prisma.inboxEmail.findMany({
    where, orderBy: { sentAt: "desc" }, take: search ? 30 : 150, select: SELECT,
  });
  return NextResponse.json({
    emails: emails.map((e) => ({ ...e, sentAt: e.sentAt.toISOString(), attachments: e._count.attachments })),
  });
}

// POST /api/companies/[id]/central/emails
// { action: "link" | "unlink" | "mark" | "unmark" | "backfill", emailId?, mark?, saleId? }
//   mark ACEITE      → registra o aceite do contrato (saleId) a partir do email
//   mark FATURAMENTO → confirma o faturamento do contrato (saleId) pelo email
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const scope = await clientCentralScope(session, id);
  if (!scope) return NextResponse.json({ error: "Sem acesso a este cliente" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const emailId = body?.emailId ? String(body.emailId) : null;

  if (action === "backfill") {
    const linked = await linkPastEmailsForClient(scope.agencyId, id);
    return NextResponse.json({ linked });
  }
  if (!emailId) return NextResponse.json({ error: "emailId obrigatório" }, { status: 400 });

  // Só mexe em email de caixa que o usuário pode ler.
  const contas = await allowedAccounts(session);
  const email = await prisma.inboxEmail.findFirst({
    where: { id: emailId, companyId: scope.agencyId, ...(contas ? { accountId: { in: contas } } : {}) },
    select: { id: true, clientCompanyId: true },
  });
  if (!email) return NextResponse.json({ error: "E-mail não encontrado" }, { status: 404 });

  try {
    if (action === "link") {
      const r = await setEmailClient(scope.agencyId, emailId, id);
      return NextResponse.json({ email: r });
    }
    if (action === "unlink") {
      if (email.clientCompanyId !== id) return NextResponse.json({ error: "E-mail não está ligado a este cliente" }, { status: 400 });
      const r = await setEmailClient(scope.agencyId, emailId, null);
      return NextResponse.json({ email: r });
    }
    if (action === "unmark") {
      await prisma.inboxEmail.update({ where: { id: emailId }, data: { clientMark: null } });
      return NextResponse.json({ ok: true });
    }
    if (action === "mark") {
      const role = (session.user as any)?.role as string;
      if (role !== "SUPER_ADMIN" && role !== "ADMIN" && !can(session, "canViewFinanceiro")) {
        return NextResponse.json({ error: "Marcar aceite/faturamento exige acesso ao Financeiro" }, { status: 403 });
      }
      const mark = String(body?.mark ?? "");
      const saleId = body?.saleId ? String(body.saleId) : null;
      if (!saleId) return NextResponse.json({ error: "Escolha o contrato (venda)" }, { status: 400 });
      const sale = await prisma.sale.findFirst({ where: { id: saleId, clientCompanyId: id, companyId: scope.agencyId }, select: { id: true } });
      if (!sale) return NextResponse.json({ error: "Contrato não é deste cliente" }, { status: 400 });
      if (email.clientCompanyId !== id) await setEmailClient(scope.agencyId, emailId, id);
      const actor = { session };
      if (mark === "ACEITE") {
        // Email recebido já diz quem aceitou; enviado (nosso "segue o
        // combinado") precisa que a pessoa informe.
        await recordAcceptance(saleId, {
          acceptanceType: "EMAIL", emailId,
          acceptedByName: body?.acceptedByName ?? null, acceptedByEmail: body?.acceptedByEmail ?? null,
        }, scope.agencyId, actor);
      } else if (mark === "FATURAMENTO") {
        await confirmBilling(saleId, { emailId, confirmedBy: body?.confirmedBy ?? null }, scope.agencyId, actor);
      } else {
        return NextResponse.json({ error: "Marca inválida (ACEITE ou FATURAMENTO)" }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    if (e instanceof ContractError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
