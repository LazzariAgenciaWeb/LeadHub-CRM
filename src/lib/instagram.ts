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
import { recordIgWebhookEvent } from "@/lib/instagram-debug";

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

/**
 * Acha a conta IG conectada (+ empresa) pelo id que vem no webhook (entry.id).
 * O Instagram pode mandar tanto o `user_id` quanto o `id` app-scoped, então
 * casamos contra os dois campos.
 */
export async function findAccountByWebhookId(entryId: string) {
  return prisma.instagramAccount.findFirst({
    where: { OR: [{ igUserId: entryId }, { igScopedId: entryId }] },
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

// ─── Ações na Graph API ───────────────────────────────────────────────────────

const GRAPH = instagramConfig.graphBase;

/** Responde publicamente a um comentário. POST /{comment-id}/replies */
export async function replyToComment(commentId: string, message: string, token: string): Promise<void> {
  const params = new URLSearchParams({ message, access_token: token });
  const r = await fetch(`${GRAPH}/${commentId}/replies?${params.toString()}`, { method: "POST" });
  if (!r.ok) throw new Error(`reply ao comentário falhou: ${r.status} ${await r.text()}`);
}

/**
 * Manda DM (private reply) ao autor de um comentário. Janela de 7 dias, 1x por
 * comentário. POST /me/messages com recipient.comment_id.
 */
export async function sendPrivateReply(commentId: string, text: string, token: string): Promise<void> {
  const r = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  if (!r.ok) throw new Error(`private reply (DM) falhou: ${r.status} ${await r.text()}`);
}

function pickRandom(arr: string[]): string | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
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
    const account = await findAccountByWebhookId(entry.id);
    if (!account) {
      console.warn(`[IG] conta ${entry.id} não conectada a nenhuma empresa — ignorando`);
      recordIgWebhookEvent({ type: "no_account", accountIgUserId: entry.id, note: "conta não conectada" });
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

type ResolvedAccount = NonNullable<Awaited<ReturnType<typeof findAccountByWebhookId>>>;

// ─── Handlers (Fase 1: log; Fase 2/3: ações) ──────────────────────────────────

async function handleCommentEvent(account: ResolvedAccount, value: IgCommentValue): Promise<void> {
  // Ignora comentários da própria conta (auto-resposta gera echo).
  if (value.from?.id && value.from.id === account.igUserId) return;

  console.log(
    `[IG] comentário empresa=${account.companyId} media=${value.media?.id} ` +
      `de=@${value.from?.username ?? value.from?.id} texto=${JSON.stringify(value.text)}`,
  );
  recordIgWebhookEvent({
    type: "comment",
    accountIgUserId: account.igUserId,
    companyId: account.companyId,
    from: value.from?.id ?? null,
    username: value.from?.username ?? null,
    text: value.text ?? null,
    mediaId: value.media?.id ?? null,
  });

  const commentId = value.id;
  const mediaId = value.media?.id ?? null;
  const commenterId = value.from?.id;
  if (!commentId || !commenterId) return;

  // 1. Automações ativas da conta que se aplicam a este post (mediaId igual ou
  //    null = qualquer post).
  const automations = await prisma.igAutomation.findMany({
    where: {
      accountId: account.id,
      enabled: true,
      OR: [{ mediaId }, { mediaId: null }],
    },
  });

  // 2. Filtra por gatilho (ANY = sempre; KEYWORD = texto contém alguma palavra).
  const text = (value.text ?? "").toLowerCase();
  const matched = automations.filter((a) => {
    if (a.triggerType === "ANY") return true;
    return a.keywords.some((k) => k && text.includes(k.toLowerCase()));
  });
  if (!matched.length) return;

  const token = decryptAccountToken(account.accessTokenEnc);
  if (!token) {
    console.error(`[IG] sem token pra conta ${account.id} — não dá pra agir`);
    return;
  }

  for (const a of matched) {
    // 3. Idempotência: 1 run por (automação, comentário).
    const existing = await prisma.igAutomationRun.findUnique({
      where: { automationId_commentId: { automationId: a.id, commentId } },
    });
    if (existing && existing.status !== "PENDING" && existing.status !== "FAILED") {
      continue; // já tratado
    }
    const run =
      existing ??
      (await prisma.igAutomationRun.create({
        data: {
          companyId: account.companyId,
          accountId: account.id,
          automationId: a.id,
          igCommenterId: commenterId,
          username: value.from?.username ?? null,
          mediaId,
          commentId,
          commentText: value.text ?? null,
          status: "PENDING",
        },
      }));

    try {
      // 4. Resposta pública ao comentário.
      if (a.replyToComment) {
        const reply = pickRandom(a.commentReplies);
        if (reply) {
          await replyToComment(commentId, reply, token);
          await prisma.igAutomationRun.update({
            where: { id: run.id },
            data: { status: "COMMENT_REPLIED" },
          });
        }
      }

      // 5. DM (private reply) com texto + link.
      //    Follow-gate (requireFollow) fica pra Fase 3 — por ora manda direto.
      if (a.sendDm) {
        const dm = [a.dmText, a.dmLinkUrl].filter(Boolean).join("\n");
        if (dm) {
          await sendPrivateReply(commentId, dm, token);
          await prisma.igAutomationRun.update({
            where: { id: run.id },
            data: { status: "DM_SENT" },
          });
        }
      }

      await prisma.igAutomationRun.update({
        where: { id: run.id },
        data: { status: "COMPLETED" },
      });
      console.log(`[IG] automação ${a.id} executada p/ comentário ${commentId}`);
    } catch (e: any) {
      console.error(`[IG] falha na automação ${a.id}:`, e?.message);
      await prisma.igAutomationRun.update({
        where: { id: run.id },
        data: { status: "FAILED", errorDetail: e?.message?.slice(0, 500) ?? "erro" },
      });
    }
  }
}

async function handleMessageEvent(account: ResolvedAccount, msg: IgMessagingEvent): Promise<void> {
  if (msg.message?.is_echo) return; // mensagem que NÓS enviamos
  const senderId = msg.sender?.id;
  if (!senderId || senderId === account.igUserId) return;

  console.log(
    `[IG] DM empresa=${account.companyId} de=${senderId} ` +
      `texto=${JSON.stringify(msg.message?.text)} postback=${msg.postback?.payload ?? "-"}`,
  );
  recordIgWebhookEvent({
    type: "message",
    accountIgUserId: account.igUserId,
    companyId: account.companyId,
    from: senderId,
    text: msg.message?.text ?? msg.postback?.payload ?? null,
    note: msg.postback ? "postback" : null,
  });

  // TODO Fase 3:
  //   1. Se há IgAutomationRun em AWAITING_FOLLOW para este senderId →
  //      GET /{igUserId}?fields=is_user_follow_business (User Profile API).
  //   2. Se segue → manda dmText + dmLinkUrl, run = COMPLETED, followState=FOLLOWING.
  //   3. Se não segue → reenvia notFollowingText, mantém AWAITING_FOLLOW.
  //   4. (Opcional) virar Lead no CRM quando converter.
}

// Reexport util pra Fase 2 (montar chamadas à Graph API).
export const igGraphBase = instagramConfig.graphBase;
