/**
 * instagram.ts — núcleo do módulo de automação do Instagram (estilo ManyChat).
 *
 * Responsabilidades:
 *  - Resolver a conta IG (e a empresa dona) a partir do webhook.
 *  - (Fase 2) Casar comentários com IgAutomation por palavra-chave + post.
 *  - (Fase 2) Responder o comentário publicamente e mandar DM (private reply).
 *  - (Fase 3) Follow-gate: checar is_user_follow_business antes de liberar o link.
 *
 * FASE 1 (atual): recebe o webhook, valida tenant e LOGA o evento. As ações
 * (responder/DM) ficam como ganchos explícitos para a Fase 2 — sem efeitos
 * colaterais ainda, pra podermos conectar a conta e confirmar que os eventos
 * chegam antes de mexer na conta do cliente.
 */

import { prisma } from "@/lib/prisma";
import { instagramConfig, tokenCrypto } from "@/lib/instagram-oauth";

// ─── Tipos do payload do webhook ──────────────────────────────────────────────

export interface IgCommentValue {
  id: string; // id do comentário
  from?: { id: string; username?: string };
  media?: { id: string; media_product_type?: string };
  text?: string;
  parent_id?: string; // se for resposta a outro comentário
}

export interface IgChange {
  field: string; // "comments" | "mentions" | ...
  value: IgCommentValue & Record<string, any>;
}

export interface IgMessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
  postback?: { mid?: string; title?: string; payload?: string };
  reaction?: { mid?: string; action?: string };
}

export interface IgWebhookEntry {
  id: string; // id da conta IG (igUserId) — chave do tenant
  time?: number;
  changes?: IgChange[];
  messaging?: IgMessagingEvent[];
}

export interface IgWebhookBody {
  object?: string; // "instagram"
  entry?: IgWebhookEntry[];
}

// ─── Resolução de tenant ──────────────────────────────────────────────────────

/** Acha a conta IG conectada (+ empresa) pelo id numérico que vem no webhook. */
export async function findAccountByIgUserId(igUserId: string) {
  return prisma.instagramAccount.findUnique({
    where: { igUserId },
    select: {
      id: true,
      companyId: true,
      igUserId: true,
      username: true,
      status: true,
      accessTokenEnc: true,
    },
  });
}

/** Token em claro da conta (decifrado). Use só no servidor, nunca logar. */
export function decryptAccountToken(accessTokenEnc: string | null | undefined): string {
  return tokenCrypto.decrypt(accessTokenEnc);
}

// ─── Ponto de entrada do webhook ──────────────────────────────────────────────

/**
 * Processa o corpo do webhook. Itera as entries, resolve o tenant e despacha
 * para o handler de comentário ou mensagem.
 */
export async function processInstagramWebhook(body: IgWebhookBody): Promise<void> {
  if (body?.object !== "instagram" || !Array.isArray(body.entry)) {
    console.log(`[IG] ignorando payload object=${body?.object}`);
    return;
  }

  for (const entry of body.entry) {
    const account = await findAccountByIgUserId(entry.id);
    if (!account) {
      console.warn(`[IG] conta ${entry.id} não conectada a nenhuma empresa — ignorando`);
      continue;
    }
    if (account.status !== "ACTIVE") {
      console.warn(`[IG] conta ${entry.id} status=${account.status} — ignorando`);
      continue;
    }

    // Comentários (e menções) chegam em `changes`.
    for (const change of entry.changes ?? []) {
      if (change.field === "comments") {
        await handleCommentEvent(account, change.value);
      } else {
        console.log(`[IG] change field=${change.field} (empresa=${account.companyId}) — não tratado`);
      }
    }

    // DMs e postbacks chegam em `messaging`.
    for (const msg of entry.messaging ?? []) {
      await handleMessageEvent(account, msg);
    }
  }
}

type ResolvedAccount = NonNullable<Awaited<ReturnType<typeof findAccountByIgUserId>>>;

// ─── Handlers (Fase 1: log; Fase 2/3: ações) ──────────────────────────────────

async function handleCommentEvent(account: ResolvedAccount, value: IgCommentValue): Promise<void> {
  // Ignora comentários da própria conta (auto-resposta gera echo).
  if (value.from?.id && value.from.id === account.igUserId) return;

  console.log(
    `[IG] comentário empresa=${account.companyId} media=${value.media?.id} ` +
      `de=@${value.from?.username ?? value.from?.id} texto=${JSON.stringify(value.text)}`,
  );

  // TODO Fase 2:
  //   1. Buscar IgAutomation enabled da conta que casa (mediaId == value.media.id
  //      ou mediaId null) e cujo gatilho bate (KEYWORD vs texto, ou ANY).
  //   2. Idempotência: upsert IgAutomationRun por (automationId, commentId).
  //   3. Se replyToComment → POST /{comment-id}/replies (resposta pública).
  //   4. Se sendDm → private reply (POST /{igUserId}/messages, recipient.comment_id).
  //   5. Se requireFollow → estado AWAITING_FOLLOW; libera link só após confirmar
  //      is_user_follow_business no contexto de DM (handleMessageEvent).
}

async function handleMessageEvent(account: ResolvedAccount, msg: IgMessagingEvent): Promise<void> {
  if (msg.message?.is_echo) return; // mensagem que NÓS enviamos
  const senderId = msg.sender?.id;
  if (!senderId || senderId === account.igUserId) return;

  console.log(
    `[IG] DM empresa=${account.companyId} de=${senderId} ` +
      `texto=${JSON.stringify(msg.message?.text)} postback=${msg.postback?.payload ?? "-"}`,
  );

  // TODO Fase 3:
  //   1. Se há IgAutomationRun em AWAITING_FOLLOW para este senderId →
  //      GET /{igUserId}?fields=is_user_follow_business (User Profile API).
  //   2. Se segue → manda dmText + dmLinkUrl, run = COMPLETED, followState=FOLLOWING.
  //   3. Se não segue → reenvia notFollowingText, mantém AWAITING_FOLLOW.
  //   4. (Opcional) virar Lead no CRM quando converter.
}

// Reexport util pra Fase 2 (montar chamadas à Graph API).
export const igGraphBase = instagramConfig.graphBase;
