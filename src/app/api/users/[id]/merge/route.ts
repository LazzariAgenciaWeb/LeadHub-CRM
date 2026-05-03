import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/users/[id]/merge
 * Body: { targetUserId: string }
 *
 * Funde o usuário [id] (origem) no targetUserId (alvo). Reatribui todas as
 * relações importantes (tickets, conversations, contatos, setores, atividades)
 * pra alvo e deleta a origem.
 *
 * Permissão: SUPER_ADMIN sempre; ADMIN só se ambos pertencem à sua empresa.
 *
 * NOTA: dados pessoais (vault challenges, google connections, scores, badges)
 * são deletados em cascade junto com a origem — assumimos que o "duplicado"
 * é descartável. Se o alvo já tinha esses dados, ficam intactos.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const { id: sourceId } = await params;
  const body = await req.json().catch(() => ({}));
  const targetId = body.targetUserId as string | undefined;

  if (!targetId) return NextResponse.json({ error: "targetUserId é obrigatório" }, { status: 400 });
  if (sourceId === targetId) return NextResponse.json({ error: "Origem e alvo são iguais" }, { status: 400 });

  const [source, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: sourceId } }),
    prisma.user.findUnique({ where: { id: targetId } }),
  ]);
  if (!source) return NextResponse.json({ error: "Usuário origem não encontrado" }, { status: 404 });
  if (!target) return NextResponse.json({ error: "Usuário alvo não encontrado" }, { status: 404 });

  // Permissão: SUPER_ADMIN ok; ADMIN só dentro da própria empresa
  const isAuthorized =
    role === "SUPER_ADMIN" ||
    (role === "ADMIN" && !!userCompanyId && source.companyId === userCompanyId && target.companyId === userCompanyId);
  if (!isAuthorized) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  // Reassign + cleanup numa única transação. Ordem importa por causa de
  // unique constraints (CompanyContact.userId, SetorUser).
  await prisma.$transaction(async (tx) => {
    // 1. Tickets
    await tx.ticket.updateMany({ where: { assigneeId: sourceId  }, data: { assigneeId: targetId  } });
    await tx.ticket.updateMany({ where: { createdById: sourceId }, data: { createdById: targetId } });

    // 2. Conversations
    await tx.conversation.updateMany({ where: { assigneeId: sourceId }, data: { assigneeId: targetId } });

    // 3. Activities (authorId é string, sem FK, mas atualizamos pra rastreio)
    await tx.activity.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } });

    // 4. CompanyContact.userId é @unique — só pode haver 1 contato por user.
    //    Se o source tinha contato e o target não, transferimos.
    //    Se ambos tinham contato (raro), desvincula o do source pra evitar conflito.
    const sourceContact = await tx.companyContact.findUnique({ where: { userId: sourceId } });
    const targetContact = await tx.companyContact.findUnique({ where: { userId: targetId } });
    if (sourceContact && !targetContact) {
      await tx.companyContact.update({ where: { id: sourceContact.id }, data: { userId: targetId } });
    } else if (sourceContact && targetContact) {
      await tx.companyContact.update({ where: { id: sourceContact.id }, data: { userId: null, hasAccess: false } });
    }

    // 5. SetorUser tem @@unique([setorId, userId]) — só transfere quando alvo
    //    ainda não está no setor; senão remove o do source pra evitar dup.
    const sourceSetores = await tx.setorUser.findMany({ where: { userId: sourceId } });
    for (const su of sourceSetores) {
      const targetIn = await tx.setorUser.findUnique({
        where: { setorId_userId: { setorId: su.setorId, userId: targetId } },
      });
      if (targetIn) {
        await tx.setorUser.delete({
          where: { setorId_userId: { setorId: su.setorId, userId: sourceId } },
        });
      } else {
        // chave composta inclui userId — recriamos em vez de update
        await tx.setorUser.delete({
          where: { setorId_userId: { setorId: su.setorId, userId: sourceId } },
        });
        await tx.setorUser.create({ data: { setorId: su.setorId, userId: targetId } });
      }
    }

    // 6. Delete source — cascades em vault/google/scores/badges/challenges são aceitáveis
    //    (são dados pessoais do duplicado). companyContact ficou desvinculado acima.
    await tx.user.delete({ where: { id: sourceId } });
  });

  return NextResponse.json({ ok: true, mergedInto: targetId });
}
