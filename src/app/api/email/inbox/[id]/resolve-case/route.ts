import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { findCopyIds } from "@/lib/email-copies";
import { loadEmailThread } from "@/lib/email-thread";
import { caseKeyOf, CASE_WINDOW_DAYS, senderDomain, PUBLIC_EMAIL_DOMAINS } from "@/lib/email-cases";

// POST /api/email/inbox/[id]/resolve-case   { folder?: "ARCHIVE" | "TRASH" }
// Resolve a COISA, não a mensagem. Arquiva (ou descarta) de uma vez:
//   · as cópias do email em outras caixas da empresa;
//   · as outras mensagens do mesmo caso — aviso, lembrete, renovação e fatura
//     do mesmo domínio/boleto (ver email-cases.ts);
//   · a conversa: inclui o encaminhamento que você mandou e a resposta de quem
//     resolveu ("está pronto"), porque elas estão no mesmo fio.
// Só mexe no que está em aberto (Entrada/Importante) — não ressuscita nem
// re-arquiva o que já foi tratado.
const ABERTOS = ["INBOX", "IMPORTANT"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;
  if (allowed && allowed.length === 0) {
    return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const destino = body?.folder === "TRASH" ? "TRASH" : "ARCHIVE";

  const accountScope = allowed ? { accountId: { in: allowed } } : {};
  const email = await prisma.inboxEmail.findFirst({
    where: { id, companyId, ...accountScope },
    select: { id: true, fromEmail: true, subject: true, sentAt: true, messageId: true, accountId: true },
  });
  if (!email) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });

  const ids = new Set<string>([email.id]);

  // 1. Cópias do próprio email em outras caixas (inclusive as que este
  //    usuário não enxerga: resolveu pra empresa).
  for (const cid of await findCopyIds(companyId, [email])) ids.add(cid);

  // 2. Conversa: encadeamento + mesmo assunto. É o que traz o encaminhamento
  //    e a resposta de quem executou.
  const thread = await loadEmailThread(companyId, email.id, allowed);
  for (const m of thread ?? []) ids.add(m.id);

  // 3. Mesmo caso: mesma chave (remetente + identificador do assunto) dentro
  //    da janela. A chave é calculada em memória, então buscamos os
  //    candidatos do mesmo remetente/domínio na janela e filtramos.
  const chave = caseKeyOf(email);
  if (chave) {
    const dominio = senderDomain(email.fromEmail);
    const porDominio = !!dominio && !PUBLIC_EMAIL_DOMAINS.has(dominio);
    const desde = new Date(email.sentAt.getTime() - CASE_WINDOW_DAYS * 86_400_000);
    const ate = new Date(email.sentAt.getTime() + CASE_WINDOW_DAYS * 86_400_000);

    const candidatos = await prisma.inboxEmail.findMany({
      where: {
        companyId,
        direction: "IN",
        folder: { in: [...ABERTOS] },
        sentAt: { gte: desde, lte: ate },
        ...(porDominio
          ? { fromEmail: { endsWith: `@${dominio}`, mode: "insensitive" } }
          : { fromEmail: { equals: email.fromEmail, mode: "insensitive" } }),
      },
      select: { id: true, fromEmail: true, subject: true, sentAt: true },
      take: 200,
    });
    for (const c of candidatos) if (caseKeyOf(c) === chave) ids.add(c.id);
  }

  // Cópias das mensagens que entraram pelo caso/conversa também vão junto.
  const extras = await prisma.inboxEmail.findMany({
    where: { id: { in: [...ids] }, companyId },
    select: { id: true, fromEmail: true, subject: true, sentAt: true, messageId: true, accountId: true },
  });
  for (const cid of await findCopyIds(companyId, extras)) ids.add(cid);

  const resultado = await prisma.inboxEmail.updateMany({
    where: { id: { in: [...ids] }, companyId, folder: { in: [...ABERTOS] } },
    data: { folder: destino },
  });

  return NextResponse.json({
    ok: true,
    folder: destino,
    resolvidos: resultado.count,
    considerados: ids.size,
  });
}
