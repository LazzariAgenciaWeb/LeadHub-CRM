import { prisma } from "@/lib/prisma";

/**
 * Visibilidade de conversas do WhatsApp — instância privada + bloqueio.
 *
 * INSTÂNCIA PRIVADA (WhatsappInstance.ownerUserId): quando setado, as conversas
 * daquela instância só aparecem pro DONO. Escondidas de todo o resto da empresa,
 * INCLUSIVE outros admins/super admins. Serve pra número pessoal rodando no
 * LeadHub sem expor os chats pra equipe.
 *
 * BLOQUEIO (Conversation.syncBlocked): a conversa some da caixa (histórico
 * incluso) e o webhook para de sincronizar. Desbloquear traz de volta.
 *
 * IMPORTANTE (segurança): este filtro precisa ser aplicado em TODO ponto de
 * leitura de conversa/mensagem (lista, carregar-mais, busca, contador,
 * mensagens, mídia). Esquecer um ponto = vazamento. Use sempre este helper.
 */

/** IDs das instâncias privadas que o usuário NÃO pode ver (dono != ele). */
export async function getHiddenInstanceIds(session: any): Promise<string[]> {
  const userId = (session?.user as any)?.id as string | undefined;
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";

  // Super admin do sistema pode filtrar por empresa; ainda assim NÃO vê as
  // privadas de outro dono (privacidade vale inclusive contra super admin).
  const privates = await prisma.whatsappInstance.findMany({
    where: {
      ownerUserId: { not: null },
      ...(isSuperAdmin ? {} : companyId ? { companyId } : {}),
    },
    select: { id: true, ownerUserId: true },
  });
  return privates.filter((p) => p.ownerUserId !== userId).map((p) => p.id);
}

type BlockedMode = "exclude" | "only" | "include";

/**
 * Fragmento de `AND` pra mesclar no `where` de qualquer query de Conversation.
 * - hiddenIds: instâncias privadas escondidas (do getHiddenInstanceIds)
 * - blocked: "exclude" (padrão — some as bloqueadas) | "only" (só as bloqueadas,
 *   pra tela de gerenciar) | "include" (mostra ambas)
 *
 * Uso: where.AND = [ ...(where.AND ?? []), ...conversationVisibilityAnd({...}) ]
 */
export function conversationVisibilityAnd(opts: {
  hiddenIds: string[];
  blocked?: BlockedMode;
}): any[] {
  const and: any[] = [];
  if (opts.hiddenIds.length > 0) {
    // instanceId null (conversa antiga sem denormalização) permanece visível.
    and.push({ OR: [{ instanceId: null }, { instanceId: { notIn: opts.hiddenIds } }] });
  }
  const blocked = opts.blocked ?? "exclude";
  if (blocked === "exclude") and.push({ syncBlocked: false });
  else if (blocked === "only") and.push({ syncBlocked: true });
  return and;
}

/**
 * Pode este usuário ver ESTA conversa? Usado nos endpoints de mensagem/mídia,
 * onde o acesso é por id/phone e não por listagem.
 */
export async function canUserSeeConversation(
  session: any,
  conv: { instanceId: string | null; syncBlocked: boolean } | null,
  opts?: { allowBlocked?: boolean },
): Promise<boolean> {
  if (!conv) return false;
  if (conv.syncBlocked && !opts?.allowBlocked) return false;
  if (!conv.instanceId) return true; // sem instância denormalizada → visível
  const hidden = await getHiddenInstanceIds(session);
  return !hidden.includes(conv.instanceId);
}
