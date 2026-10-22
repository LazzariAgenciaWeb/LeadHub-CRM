import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { loadEmailThread } from "@/lib/email-thread";
import { buildForwardBody, forwardSubject, type ForwardMsg } from "@/lib/email-forward";

const BODY_SELECT = {
  id: true, direction: true, fromEmail: true, fromName: true,
  toEmail: true, ccEmail: true, subject: true,
  textBody: true, htmlBody: true, snippet: true, sentAt: true,
} as const;

// GET /api/email/inbox/[id]/forward
// Devolve assunto, corpo e anexos prontos pro compositor encaminhar: a
// mensagem aberta MAIS as mensagens ligadas a ela (a conversa), porque quem
// recebe o encaminhamento precisa do fio inteiro pra resolver.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const accountScope = allowed ? { accountId: { in: allowed } } : {};

  const main = await prisma.inboxEmail.findFirst({
    where: { id, companyId, ...accountScope },
    select: {
      ...BODY_SELECT,
      attachments: { select: { id: true, filename: true, contentType: true, size: true } },
    },
  });
  if (!main) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });

  // Conversa: mesma montagem do painel do leitor (encadeamento + assunto),
  // já agrupada e respeitando as caixas do setor.
  const thread = await loadEmailThread(companyId, id, allowed);
  const outrosIds = (thread ?? [])
    .map((m) => m.id)
    .filter((tid) => tid !== main.id);

  const related = outrosIds.length
    ? await prisma.inboxEmail.findMany({
        where: { id: { in: outrosIds }, companyId },
        orderBy: { sentAt: "asc" },
        select: BODY_SELECT,
      })
    : [];

  const text = buildForwardBody(main as ForwardMsg, related as ForwardMsg[]);

  return NextResponse.json({
    subject: forwardSubject(main.subject),
    text,
    related: related.length,
    attachments: main.attachments,
  });
}
