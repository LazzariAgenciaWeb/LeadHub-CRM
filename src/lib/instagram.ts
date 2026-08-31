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
  message?: { mid?: string; text?: string; is_echo?: boolean; quick_reply?: { payload?: string } };
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
  const select = {
    id: true,
    companyId: true,
    igUserId: true,
    username: true,
    status: true,
    accessTokenEnc: true,
  };
  // Prioriza o id primário (igUserId) — é o que o webhook usa de fato. O
  // igScopedId é só fallback (e pode coincidir com o igUserId de OUTRA conta,
  // então nunca deve ganhar de um match exato por igUserId).
  const byUserId = await prisma.instagramAccount.findFirst({ where: { igUserId: entryId }, select });
  if (byUserId) return byUserId;
  return prisma.instagramAccount.findFirst({ where: { igScopedId: entryId }, select });
}

/** Token em claro da conta (decifrado). Use só no servidor, nunca logar. */
export function decryptAccountToken(accessTokenEnc: string | null | undefined): string {
  return tokenCrypto.decrypt(accessTokenEnc);
}

// ─── Inbox: persistência de mensagens (DMs) ───────────────────────────────────

type IgMsgDir = "IN" | "OUT";
type IgMsgSrc = "ORGANIC" | "AUTOMATION" | "AGENT" | "EXTERNAL" | "AI";
type InboxChan = "INSTAGRAM" | "MESSENGER" | "FACEBOOK";

/**
 * Registra uma mensagem na inbox (cria/atualiza IgConversation + IgMessage).
 * Multi-canal: connectionId = InstagramAccount.id (IG) ou FacebookPage.pageId (FB).
 */
export async function recordIgMessage(opts: {
  companyId: string;
  channel?: InboxChan;
  connectionId: string;
  accountId?: string | null; // FK opcional, só pro canal INSTAGRAM
  participantId: string;
  username?: string | null;
  direction: IgMsgDir;
  source: IgMsgSrc;
  text?: string | null;
  mid?: string | null;
}): Promise<string | null> {
  // Idempotência por mid: o mesmo envio chega por dois caminhos (registro
  // direto no reply/automação + echo do webhook) e a Meta reentrega webhooks.
  // O primeiro grava; os demais são ignorados. Retorna o id da conversa.
  if (opts.mid) {
    const dupe = await prisma.igMessage.findFirst({
      where: { companyId: opts.companyId, mid: opts.mid },
      select: { conversationId: true },
    });
    if (dupe) return dupe.conversationId;
  }

  const now = new Date();
  const channel = opts.channel ?? "INSTAGRAM";
  // needsReply: vira true só quando o contato manda algo ORGÂNICO; qualquer
  // saída (automação/agente) zera.
  const needsReply = opts.direction === "IN" ? opts.source === "ORGANIC" : false;
  const convo = await prisma.igConversation.upsert({
    where: { connectionId_participantId: { connectionId: opts.connectionId, participantId: opts.participantId } },
    create: {
      companyId: opts.companyId,
      channel,
      connectionId: opts.connectionId,
      accountId: opts.accountId ?? null,
      participantId: opts.participantId,
      participantUsername: opts.username ?? null,
      lastMessageAt: now,
      lastMessageText: opts.text ?? null,
      lastDirection: opts.direction,
      needsReply,
      hadAutomation: opts.source === "AUTOMATION",
    },
    update: {
      participantUsername: opts.username ?? undefined,
      lastMessageAt: now,
      lastMessageText: opts.text ?? null,
      lastDirection: opts.direction,
      needsReply,
      ...(opts.source === "AUTOMATION" ? { hadAutomation: true } : {}),
    },
  });
  await prisma.igMessage.create({
    data: {
      conversationId: convo.id,
      companyId: opts.companyId,
      direction: opts.direction,
      source: opts.source,
      text: opts.text ?? null,
      mid: opts.mid ?? null,
    },
  });
  return convo.id;
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
export async function sendPrivateReply(commentId: string, text: string, token: string): Promise<string | null> {
  return postDm({ recipient: { comment_id: commentId }, message: { text } }, token, "private reply (DM)");
}

/** POST /me/messages. Retorna o mid da mensagem enviada (idempotência com o echo do webhook). */
async function postDm(payload: unknown, token: string, errLabel: string): Promise<string | null> {
  const r = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`${errLabel} falhou: ${r.status} ${await r.text()}`);
  const j: any = await r.json().catch(() => null);
  return j?.message_id ?? null;
}

/**
 * Checa se o usuário segue a conta (follow-gate). Só funciona quando o igsid
 * está em contexto de mensagem (ex: depois que a pessoa respondeu no DM).
 * Retorna true/false, ou null quando não dá pra determinar.
 */
export async function getUserFollowStatus(igsid: string, token: string): Promise<boolean | null> {
  const params = new URLSearchParams({ fields: "is_user_follow_business", access_token: token });
  const r = await fetch(`${GRAPH}/${igsid}?${params.toString()}`);
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => null);
  return j && typeof j.is_user_follow_business === "boolean" ? j.is_user_follow_business : null;
}

/** Busca nome/username do participante de um DM (User Profile API). Best-effort. */
export async function getIgUserProfile(igsid: string, token: string): Promise<{ username: string | null; name: string | null }> {
  try {
    const params = new URLSearchParams({ fields: "name,username", access_token: token });
    const r = await fetch(`${GRAPH}/${igsid}?${params.toString()}`);
    if (!r.ok) return { username: null, name: null };
    const j: any = await r.json();
    return { username: j.username ?? null, name: j.name ?? null };
  } catch {
    return { username: null, name: null };
  }
}

/** Manda DM a um usuário pelo IGSID (janela de 24h). POST /me/messages recipient.id */
export async function sendMessageToUser(igsid: string, text: string, token: string): Promise<string | null> {
  return postDm({ recipient: { id: igsid }, message: { text } }, token, "DM (recipient.id)");
}

// ─── Mensagens com botões (quick replies) ────────────────────────────────────

export type IgButton = { title: string; payload: string };

function quickReplies(buttons: IgButton[]) {
  // Instagram limita o título a ~20 chars.
  return buttons.map((b) => ({ content_type: "text", title: b.title.slice(0, 20), payload: b.payload }));
}

/** Private reply (comment_id) com botões clicáveis. */
export async function sendPrivateReplyWithButtons(commentId: string, text: string, buttons: IgButton[], token: string): Promise<string | null> {
  return postDm(
    { recipient: { comment_id: commentId }, message: { text, quick_replies: quickReplies(buttons) } },
    token,
    "private reply c/ botão",
  );
}

/** DM a um usuário (recipient.id) com botões clicáveis. */
export async function sendMessageWithButtons(igsid: string, text: string, buttons: IgButton[], token: string): Promise<string | null> {
  return postDm({ recipient: { id: igsid }, message: { text, quick_replies: quickReplies(buttons) } }, token, "DM c/ botão");
}

// Payloads dos botões (postback/quick_reply). Formato: PREFIX:automationId
const CTA_PREFIX = "IG_CTA:";        // botão "quero receber" da DM de abertura
const FOLLOWED_PREFIX = "IG_FOLLOWED:"; // botão "já te segui"
const DEFAULT_CTA_LABEL = "Quero receber";
const DEFAULT_FOLLOWED_LABEL = "Já te segui ✅";
const DEFAULT_ASK_FOLLOW = 'Pra liberar o link, é só me seguir e responder "ok" aqui no direct que eu te mando 🚀';

/** Anexa o link do perfil à mensagem de "me segue" (facilita ir e voltar). */
function withProfileLink(text: string, username?: string | null): string {
  if (!username) return text;
  const url = `https://instagram.com/${username}`;
  return text.includes(url) ? text : `${text}\n👉 ${url}`;
}

function pickRandom(arr: string[]): string | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Repete uma ação quando o erro é transitório. O webhook do Instagram chega
 * antes do comentário ficar consultável na API ("Object does not exist" /
 * subcode 33 / "unknown error"), então tentamos de novo com pequena espera.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 2500): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? "");
      const transient = /does not exist|cannot be loaded|missing permissions|unknown error|"code":\s*1\b|error_subcode":\s*33/i.test(msg);
      if (i < attempts - 1 && transient) {
        await sleep(delayMs);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
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
    orderBy: { createdAt: "asc" },
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

  // Só a PRIMEIRA automação que casa age neste comentário. O Instagram permite
  // apenas 1 private reply por comentário — disparar várias geraria erro 500 na
  // 2ª. (Regra "primeiro match vence", estilo ManyChat.)
  for (const a of matched.slice(0, 1)) {
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
          await withRetry(() => replyToComment(commentId, reply, token));
          await prisma.igAutomationRun.update({
            where: { id: run.id },
            data: { status: "COMMENT_REPLIED" },
          });
        }
      }

      // 5. DM. Dois fluxos:
      //    (a) BOTÃO (dmButtonLabel preenchido): manda a abertura + botão CTA;
      //        a checagem de follow e a entrega acontecem no CLIQUE do botão
      //        (handleMessageEvent → resolveCtaClick).
      //    (b) SIMPLES: manda o conteúdo direto (follow-gate por texto "ok").
      if (a.sendDm && a.dmButtonLabel) {
        const opening = a.dmText || "Toca no botão abaixo pra receber 👇";
        const mid = await withRetry(() =>
          sendPrivateReplyWithButtons(commentId, opening, [{ title: a.dmButtonLabel!, payload: CTA_PREFIX + a.id }], token),
        );
        await outAuto(account, commenterId, opening, mid);
        await prisma.igAutomationRun.update({ where: { id: run.id }, data: { status: "DM_SENT" } });
      } else if (a.sendDm) {
        const fullDm = [a.dmText, a.dmLinkUrl].filter(Boolean).join("\n");

        if (a.requireFollow) {
          // Tenta saber se já segue (só funciona em contexto de DM; do comentário
          // costuma vir null → tratamos como "ainda não confirmado").
          const follows = await getUserFollowStatus(commenterId, token);
          if (follows === true && fullDm) {
            const mid = await withRetry(() => sendPrivateReply(commentId, fullDm, token));
            await outAuto(account, commenterId, fullDm, mid);
            await prisma.igAutomationRun.update({
              where: { id: run.id },
              data: { status: "COMPLETED", followState: "FOLLOWING" },
            });
          } else {
            // Pede pra seguir (com link do perfil); libera o link quando responder no DM.
            const ask = withProfileLink(a.notFollowingText || DEFAULT_ASK_FOLLOW, account.username);
            const mid = await withRetry(() => sendPrivateReply(commentId, ask, token));
            await outAuto(account, commenterId, ask, mid);
            await prisma.igAutomationRun.update({
              where: { id: run.id },
              data: {
                status: "AWAITING_FOLLOW",
                followState: follows === false ? "NOT_FOLLOWING" : "UNKNOWN",
              },
            });
          }
        } else if (fullDm) {
          const mid = await withRetry(() => sendPrivateReply(commentId, fullDm, token));
          await outAuto(account, commenterId, fullDm, mid);
          await prisma.igAutomationRun.update({
            where: { id: run.id },
            data: { status: "COMPLETED" },
          });
        } else {
          await prisma.igAutomationRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
        }
      } else {
        await prisma.igAutomationRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
      }
      console.log(`[IG] automação ${a.id} processada p/ comentário ${commentId}`);
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
  // Echo = mensagem que NÓS enviamos (app do Instagram, Business Suite ou API).
  // Persiste como OUT pra thread da inbox ficar completa. O mid deduplica
  // contra o registro feito no envio (reply da inbox / automação); sem match,
  // a mensagem foi enviada fora do LeadHub → source EXTERNAL.
  if (msg.message?.is_echo) {
    const participantId = msg.recipient?.id;
    if (!participantId || participantId === account.igUserId) return;
    const convoId = await recordIgMessage({
      companyId: account.companyId,
      channel: "INSTAGRAM",
      connectionId: account.id,
      accountId: account.id,
      participantId,
      direction: "OUT",
      source: "EXTERNAL",
      text: msg.message?.text ?? null,
      mid: msg.message?.mid ?? null,
    }).catch((e) => {
      console.error("[IG] persist echo:", e?.message);
      return null;
    });
    // Humano respondeu pelo app antes do debounce do agente vencer → o time
    // chegou primeiro; cancela a resposta automática pendente.
    if (convoId) {
      const { cancelIgAutoAgent } = await import("./ig-auto-agent");
      cancelIgAutoAgent(convoId);
    }
    return;
  }
  const senderId = msg.sender?.id;
  if (!senderId || senderId === account.igUserId) return;

  const payload = msg.message?.quick_reply?.payload || msg.postback?.payload || "";
  console.log(`[IG] DM empresa=${account.companyId} de=${senderId} payload=${payload || "-"} texto=${JSON.stringify(msg.message?.text)}`);
  recordIgWebhookEvent({
    type: "message",
    accountIgUserId: account.igUserId,
    companyId: account.companyId,
    from: senderId,
    text: msg.message?.text ?? payload ?? null,
    note: payload ? "botão" : null,
  });

  const token = decryptAccountToken(account.accessTokenEnc);

  // Busca o @username do participante (pra inbox mostrar o @ em vez do ID).
  let username: string | null = null;
  if (token) {
    const prof = await getIgUserProfile(senderId, token);
    username = prof.username ?? prof.name ?? null;
  }

  // Persiste o DM recebido na inbox (com botão → automação; senão → orgânico).
  const convoId = await recordIgMessage({
    companyId: account.companyId,
    channel: "INSTAGRAM",
    connectionId: account.id,
    accountId: account.id,
    participantId: senderId,
    username,
    direction: "IN",
    source: payload ? "AUTOMATION" : "ORGANIC",
    text: msg.message?.text ?? (payload ? `[botão] ${payload}` : null),
    mid: msg.message?.mid ?? null,
  }).catch((e) => {
    console.error("[IG] persist inbound:", e?.message);
    return null;
  });

  if (!token) return;

  try {
    // Clique no botão CTA da DM de abertura ("quero receber").
    if (payload.startsWith(CTA_PREFIX)) {
      await resolveButtonClick(account, senderId, payload.slice(CTA_PREFIX.length), token);
      return;
    }
    // Clique no botão "já te segui".
    if (payload.startsWith(FOLLOWED_PREFIX)) {
      await resolveButtonClick(account, senderId, payload.slice(FOLLOWED_PREFIX.length), token);
      return;
    }
    // Prospect da rotina respondeu? Promove PROSPECCAO → LEADS pelo @ (best-
    // effort, independente do agente responder).
    if (username) {
      const { promoteIgProspectOnReply } = await import("./ig-auto-agent");
      promoteIgProspectOnReply(account.companyId, username).catch((e: any) =>
        console.error("[IG] promote prospect:", e?.message),
      );
    }
    // Texto comum: resolve o follow-gate do fluxo SIMPLES (responder "ok").
    const gateConsumed = await resolveTextFollowGate(account, senderId, token);
    // DM orgânica sem automação pendente → agente IA do Direct (se a conta
    // tiver agente vinculado; o motor refaz todos os guards antes de responder).
    if (!gateConsumed && convoId) {
      const { scheduleIgAutoAgent } = await import("./ig-auto-agent");
      scheduleIgAutoAgent(convoId);
    }
  } catch (e: any) {
    console.error(`[IG] handleMessageEvent erro:`, e?.message);
  }
}

function findOpenRun(accountId: string, igCommenterId: string, automationId: string) {
  return prisma.igAutomationRun.findFirst({
    where: { accountId, igCommenterId, automationId, status: { notIn: ["COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    include: { automation: true },
  });
}

/** Conteúdo final entregue depois do gate (texto + link). */
function deliveredContent(a: { deliveredText: string | null; dmLinkUrl: string | null }): string {
  return [a.deliveredText, a.dmLinkUrl].filter(Boolean).join("\n") || "Aqui está! 🎉";
}

/** Registra na inbox uma DM de saída enviada pela automação. */
function outAuto(account: ResolvedAccount, participantId: string, text: string, mid?: string | null) {
  return recordIgMessage({
    companyId: account.companyId,
    channel: "INSTAGRAM",
    connectionId: account.id,
    accountId: account.id,
    participantId,
    direction: "OUT",
    source: "AUTOMATION",
    text,
    mid: mid ?? null,
  }).catch((e: any) => console.error("[IG] persist out:", e?.message));
}

/** Resolve clique de botão (CTA "quero receber" ou "já te segui"): checa follow e entrega. */
async function resolveButtonClick(account: ResolvedAccount, senderId: string, automationId: string, token: string) {
  const run = await findOpenRun(account.id, senderId, automationId);
  if (!run || !run.automation) return;
  const a = run.automation;

  // Sem follow-gate → entrega direto.
  if (!a.requireFollow) {
    const mid = await sendMessageToUser(senderId, deliveredContent(a), token);
    await outAuto(account, senderId, deliveredContent(a), mid);
    await prisma.igAutomationRun.update({ where: { id: run.id }, data: { status: "COMPLETED", followState: "FOLLOWING" } });
    return;
  }

  const follows = await getUserFollowStatus(senderId, token);
  if (follows === true) {
    const mid = await sendMessageToUser(senderId, deliveredContent(a), token);
    await outAuto(account, senderId, deliveredContent(a), mid);
    await prisma.igAutomationRun.update({ where: { id: run.id }, data: { status: "COMPLETED", followState: "FOLLOWING" } });
    console.log(`[IG] follow-gate (botão) liberado p/ ${senderId} (run ${run.id})`);
  } else {
    // Pede pra seguir com link do perfil + botão "já te segui".
    const ask = withProfileLink(a.notFollowingText || DEFAULT_ASK_FOLLOW, account.username);
    const mid = await sendMessageWithButtons(senderId, ask, [{ title: DEFAULT_FOLLOWED_LABEL, payload: FOLLOWED_PREFIX + a.id }], token);
    await outAuto(account, senderId, ask, mid);
    await prisma.igAutomationRun.update({
      where: { id: run.id },
      data: { status: "AWAITING_FOLLOW", followState: follows === false ? "NOT_FOLLOWING" : "UNKNOWN" },
    });
  }
}

/**
 * Fluxo SIMPLES (sem botão): pessoa respondeu texto enquanto run está
 * AWAITING_FOLLOW. Retorna true quando a mensagem foi consumida pelo gate
 * (havia automação pendente) — o agente IA não deve responder por cima.
 */
async function resolveTextFollowGate(account: ResolvedAccount, senderId: string, token: string): Promise<boolean> {
  const run = await prisma.igAutomationRun.findFirst({
    where: { accountId: account.id, igCommenterId: senderId, status: "AWAITING_FOLLOW" },
    orderBy: { createdAt: "desc" },
    include: { automation: true },
  });
  if (!run || !run.automation) return false;
  const a = run.automation;
  const follows = await getUserFollowStatus(senderId, token);

  if (follows === true) {
    const fullDm = [a.deliveredText || a.dmText, a.dmLinkUrl].filter(Boolean).join("\n");
    if (fullDm) {
      const mid = await sendMessageToUser(senderId, fullDm, token);
      await outAuto(account, senderId, fullDm, mid);
    }
    await prisma.igAutomationRun.update({ where: { id: run.id }, data: { status: "COMPLETED", followState: "FOLLOWING" } });
    console.log(`[IG] follow-gate (texto) liberado p/ ${senderId} (run ${run.id})`);
  } else {
    const ask = withProfileLink(a.notFollowingText || DEFAULT_ASK_FOLLOW, account.username);
    const mid = await sendMessageToUser(senderId, ask, token);
    await outAuto(account, senderId, ask, mid);
    await prisma.igAutomationRun.update({
      where: { id: run.id },
      data: { followState: follows === false ? "NOT_FOLLOWING" : "UNKNOWN" },
    });
  }
  return true;
}

// Reexport util pra Fase 2 (montar chamadas à Graph API).
export const igGraphBase = instagramConfig.graphBase;
