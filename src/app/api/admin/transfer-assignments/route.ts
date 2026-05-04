import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/transfer-assignments
 * Body: { fromUserId?: string; toUserId?: string; fromEmail?: string; toEmail?: string; apply?: boolean }
 *
 * Reatribui Conversations, Tickets e Activities do user origem pro alvo.
 * NÃO deleta o user origem (diferente de /api/users/[id]/merge).
 *
 * Caso de uso: Diego Lazzari (SUPER_ADMIN) pegou conversas atribuídas a si
 * por engano, e quer transferir tudo pra Diego R. Lazzari (ADMIN da AZZ).
 *
 * Body sem `apply: true` → modo dry-run, retorna contagens sem aplicar.
 *
 * Acesso: apenas SUPER_ADMIN.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session || role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { fromUserId, toUserId, fromEmail, toEmail, apply } = body;

  const sup = fromUserId
    ? await prisma.user.findUnique({ where: { id: fromUserId } })
    : fromEmail
    ? await prisma.user.findUnique({ where: { email: fromEmail } })
    : null;
  const tgt = toUserId
    ? await prisma.user.findUnique({ where: { id: toUserId } })
    : toEmail
    ? await prisma.user.findUnique({ where: { email: toEmail } })
    : null;

  if (!sup) return NextResponse.json({ error: "Usuário origem não encontrado" }, { status: 404 });
  if (!tgt) return NextResponse.json({ error: "Usuário alvo não encontrado" }, { status: 404 });
  if (sup.id === tgt.id) return NextResponse.json({ error: "Origem e alvo são iguais" }, { status: 400 });

  const [convs, ticketsA, ticketsC, acts] = await Promise.all([
    prisma.conversation.count({ where: { assigneeId: sup.id } }),
    prisma.ticket.count({ where: { assigneeId: sup.id } }),
    prisma.ticket.count({ where: { createdById: sup.id } }),
    prisma.activity.count({ where: { authorId: sup.id } }),
  ]);

  const counts = {
    conversations: convs,
    ticketsAssignee: ticketsA,
    ticketsCreatedBy: ticketsC,
    activities: acts,
  };

  if (!apply) {
    return NextResponse.json({
      dryRun: true,
      from: { id: sup.id, name: sup.name, email: sup.email, role: sup.role },
      to: { id: tgt.id, name: tgt.name, email: tgt.email, role: tgt.role },
      counts,
    });
  }

  const result = await prisma.$transaction([
    prisma.conversation.updateMany({ where: { assigneeId: sup.id }, data: { assigneeId: tgt.id } }),
    prisma.ticket.updateMany({ where: { assigneeId: sup.id }, data: { assigneeId: tgt.id } }),
    prisma.ticket.updateMany({ where: { createdById: sup.id }, data: { createdById: tgt.id } }),
    prisma.activity.updateMany({ where: { authorId: sup.id }, data: { authorId: tgt.id, authorName: tgt.name } }),
  ]);

  return NextResponse.json({
    applied: true,
    from: { id: sup.id, email: sup.email },
    to: { id: tgt.id, email: tgt.email },
    transferred: {
      conversations: result[0].count,
      ticketsAssignee: result[1].count,
      ticketsCreatedBy: result[2].count,
      activities: result[3].count,
    },
  });
}
