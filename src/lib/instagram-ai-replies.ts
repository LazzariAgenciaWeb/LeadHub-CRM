/**
 * instagram-ai-replies.ts — respostas a comentários com IA (modo AI da IgAutomation).
 *
 * Fluxo:
 *   webhook / "puxar comentários antigos" → IgAiReply QUEUED
 *   cron (processAiReplyQueue):
 *     1. QUEUED → a IA lê comentário + legenda do post + jeito do dono e decide:
 *          brincadeira/elogio/pergunta/interesse → escreve a resposta
 *            → AWAITING_APPROVAL (aiApproval) ou SCHEDULED (sai em alguns minutos)
 *          crítica/ataque → NEEDS_YOU (com sugestão; não publica sozinho)
 *          spam/golpe     → HIDDEN (oculta) ou SKIPPED
 *          só emoji/"kkk" → responde só uma parte, pra não parecer robô
 *     2. SCHEDULED vencido → publica, respeitando o teto por hora da conta.
 *        Pergunta/interesse + automação com DM → manda a DM da automação.
 *
 * Por que fila e não responder na hora: 300 respostas em 5 minutos é padrão de
 * robô (e o Instagram pune). O ritmo é o produto aqui.
 *
 * Custo: cada comentário que passa pela IA consome 1 interação da cota de IA da
 * empresa (runAssistant). "kkk"/emoji pulado pelo filtro não gasta.
 */

import { prisma } from "@/lib/prisma";
import { runAssistant } from "@/lib/assistant";
import {
  decryptAccountToken,
  enqueueAiReply,
  hideComment,
  igGraphBase,
  igWithRetry,
  replyToComment,
  runAutomationDm,
} from "@/lib/instagram";
import type { IgCommentIntent } from "@/generated/prisma";

/** Quantos comentários a IA analisa por rodada (controle de custo/tempo). */
const MAX_ANALYZE_PER_TICK = 15;
/** Quantas respostas uma conta publica por rodada (o cron roda a cada ~60s). */
const MAX_SEND_PER_ACCOUNT_PER_TICK = 2;
/** Chance de responder um comentário só de emoji/risada/marcação. */
const LOW_EFFORT_REPLY_CHANCE = 0.3;
/** Mesma pessoa não ganha 2 respostas de brincadeira nesse intervalo. */
const SAME_PERSON_COOLDOWN_MS = 6 * 60 * 60_000;
/** Espera "humana" antes de publicar um comentário novo (min–max). */
const HUMAN_DELAY_MIN_MS = 60_000;
const HUMAN_DELAY_MAX_MS = 6 * 60_000;
/** Limite do "puxar comentários antigos". */
const BACKFILL_MAX = 400;

const LEAD_INTENTS: IgCommentIntent[] = ["QUESTION", "INTEREST"];
const VALID_INTENTS: IgCommentIntent[] = ["JOKE", "PRAISE", "QUESTION", "INTEREST", "LOW_EFFORT", "CRITICISM", "SPAM"];

// ─── Heurísticas baratas (antes de gastar IA) ────────────────────────────────

/**
 * Comentário sem conteúdo: só emoji, risada ("kkkk", "rsrs", "hahaha"),
 * marcação de amigo ou pontuação.
 */
export function isLowEffort(text: string | null | undefined): boolean {
  const t = (text ?? "")
    .toLowerCase()
    .replace(/@[\w.]+/g, " ")
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}|‍|️/gu, " ")
    .replace(/\b(k{2,}|(rs)+|(ha)+h?|(he)+|(hu)+(a)*|kkk\w*|lol|aff|mds|top|demais)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return t.length === 0;
}

function humanDelay(): Date {
  const ms = HUMAN_DELAY_MIN_MS + Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS);
  return new Date(Date.now() + ms);
}

function parseJson(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// ─── Graph API ───────────────────────────────────────────────────────────────

async function fetchCaption(mediaId: string, token: string): Promise<string> {
  try {
    const params = new URLSearchParams({ fields: "caption", access_token: token });
    const r = await fetch(`${igGraphBase}/${mediaId}?${params.toString()}`);
    if (!r.ok) return "";
    const j: any = await r.json();
    return typeof j?.caption === "string" ? j.caption : "";
  } catch {
    return "";
  }
}

// ─── IA ──────────────────────────────────────────────────────────────────────

type AutomationForAi = {
  id: string;
  sendDm: boolean;
  aiPersona: string | null;
  aiExamples: string | null;
};

export type AiDecision =
  | { ok: true; intent: IgCommentIntent; reply: boolean; text: string; reason: string }
  | { ok: false; code: "QUOTA" | "NO_CONFIG" | "AI_ERROR"; error: string };

/** A IA classifica o comentário e escreve a resposta no tom do dono. */
export async function decideReply(opts: {
  companyId: string;
  ownerUsername: string | null;
  automation: AutomationForAi;
  caption: string;
  commentText: string;
  commenterUsername: string | null;
  recentReplies: string[];
}): Promise<AiDecision> {
  const { automation: a } = opts;
  const dmLine = a.sendDm
    ? "- Em QUESTION/INTEREST você pode dizer que vai mandar mais detalhes no direct (o sistema manda a DM). Nos outros tipos, NUNCA fale de direct."
    : "- NUNCA fale de direct, link ou 'chama no privado'.";

  const system = [
    `Você responde comentários do Instagram${opts.ownerUsername ? ` de @${opts.ownerUsername}` : ""} COMO SE FOSSE a própria pessoa, de próprio punho.`,
    a.aiPersona?.trim() ? `Quem é e como fala:\n${a.aiPersona.trim()}` : "",
    a.aiExamples?.trim() ? `Respostas reais dessa pessoa (copie o JEITO, não as frases):\n${a.aiExamples.trim()}` : "",
    "Regras:",
    "- Curta: no máximo ~120 caracteres, 1 frase. Português do Brasil, informal, natural. No máximo 1–2 emojis (às vezes nenhum).",
    "- Entre no clima: se é brincadeira, brinque de volta com leveza. Sem deboche que humilhe, sem palavrão pesado.",
    "- Nada de cara de robô: proibido 'Obrigado pelo comentário', 'Ficamos felizes', 'Agradecemos'. Não comece com o @ da pessoa. Varie a abertura — não repita a estrutura das respostas recentes.",
    "- Coerente com o post (legenda abaixo). Não invente fato, número, preço, prazo nem promessa.",
    "- Não peça pra seguir.",
    dmLine,
    "- Política, religião, tragédia, saúde ou qualquer assunto delicado: responder=false.",
    "Classifique o comentário em UM tipo:",
    "JOKE (brincadeira/zoeira), PRAISE (elogio), QUESTION (dúvida sobre o assunto), INTEREST (interesse comercial: preço, contratar, 'faz pra empresa?'), LOW_EFFORT (só emoji, risada, marcação de amigo), CRITICISM (crítica, reclamação, ataque), SPAM (golpe, 'ganhe seguidores', link suspeito, divulgação).",
    "responder=false para SPAM e quando não há nada bom a dizer. Para CRITICISM, responder=false MAS escreva em 'resposta' uma sugestão serena (o dono decide se usa).",
    'Responda SOMENTE com JSON: {"tipo": "<TIPO>", "responder": true|false, "resposta": "<texto>", "motivo": "<1 frase curta em português>"}',
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Legenda do post:\n${opts.caption.trim().slice(0, 1500) || "(sem legenda)"}`,
    opts.recentReplies.length
      ? `Suas respostas mais recentes neste post (não repita):\n${opts.recentReplies.map((r) => `- ${r}`).join("\n")}`
      : "",
    `Comentário de @${opts.commenterUsername ?? "alguém"}:\n${opts.commentText.slice(0, 800)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await runAssistant({
    companyId: opts.companyId,
    endpoint: "ig-comment-reply",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.9,
    maxTokens: 250,
  });
  if (!res.ok) return res;

  const j = parseJson(res.text);
  const tipo = String(j?.tipo ?? "").toUpperCase() as IgCommentIntent;
  const intent: IgCommentIntent = VALID_INTENTS.includes(tipo) ? tipo : "JOKE";
  const text = typeof j?.resposta === "string" ? j.resposta.trim().replace(/^["']|["']$/g, "").slice(0, 300) : "";
  const reason = typeof j?.motivo === "string" ? j.motivo.trim().slice(0, 300) : "";
  const reply = j?.responder === true && !!text && intent !== "SPAM" && intent !== "CRITICISM";
  return { ok: true, intent, reply, text, reason };
}

async function recentRepliesFor(automationId: string | null, mediaId: string | null): Promise<string[]> {
  if (!automationId) return [];
  const rows = await prisma.igAiReply.findMany({
    where: { automationId, mediaId: mediaId ?? undefined, replyText: { not: null }, status: { in: ["SENT", "SCHEDULED", "AWAITING_APPROVAL"] } },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { replyText: true },
  });
  return rows.map((r) => r.replyText!).filter(Boolean);
}

// ─── Etapa 1: analisar a fila ────────────────────────────────────────────────

type AnalyzeSummary = { analyzed: number; skippedCheap: number; quotaBlocked: number; failed: number };

async function analyzeQueued(): Promise<AnalyzeSummary> {
  const sum: AnalyzeSummary = { analyzed: 0, skippedCheap: 0, quotaBlocked: 0, failed: 0 };
  const items = await prisma.igAiReply.findMany({
    where: { status: "QUEUED" },
    orderBy: [{ likeCount: "desc" }, { createdAt: "asc" }],
    take: MAX_ANALYZE_PER_TICK * 3,
    include: {
      automation: true,
      account: { select: { id: true, username: true, accessTokenEnc: true, status: true } },
    },
  });

  const captions = new Map<string, string>();
  const blockedCompanies = new Set<string>();
  let used = 0;

  for (const it of items) {
    if (used >= MAX_ANALYZE_PER_TICK) break;

    const a = it.automation;
    if (!a || a.replyMode !== "AI" || !a.enabled || it.account.status !== "ACTIVE") {
      await prisma.igAiReply.update({ where: { id: it.id }, data: { status: "SKIPPED", reason: "Automação desligada ou fora do modo IA" } });
      continue;
    }

    // Filtro barato: só emoji / risada / marcação. Responde uma parte; o resto
    // nem passa pela IA (não gasta cota).
    const lowEffort = isLowEffort(it.commentText);
    if (lowEffort) {
      const recentSamePerson = it.igCommenterId
        ? await prisma.igAiReply.count({
            where: { accountId: it.accountId, igCommenterId: it.igCommenterId, status: "SENT", sentAt: { gt: new Date(Date.now() - SAME_PERSON_COOLDOWN_MS) } },
          })
        : 0;
      if (recentSamePerson > 0 || Math.random() > LOW_EFFORT_REPLY_CHANCE) {
        await prisma.igAiReply.update({
          where: { id: it.id },
          data: { status: "SKIPPED", intent: "LOW_EFFORT", reason: "Só emoji/risada/marcação — pulado pra não parecer robô" },
        });
        sum.skippedCheap++;
        continue;
      }
    }

    // Empresa sem cota/config de IA nesta rodada: o resto dela espera a próxima.
    if (blockedCompanies.has(it.companyId)) continue;

    const token = decryptAccountToken(it.account.accessTokenEnc);
    let caption = "";
    if (it.mediaId && token) {
      if (!captions.has(it.mediaId)) captions.set(it.mediaId, await fetchCaption(it.mediaId, token));
      caption = captions.get(it.mediaId) ?? "";
    }

    used++;
    const d = await decideReply({
      companyId: it.companyId,
      ownerUsername: it.account.username,
      automation: a,
      caption,
      commentText: it.commentText ?? "",
      commenterUsername: it.username,
      recentReplies: await recentRepliesFor(it.automationId, it.mediaId),
    });

    if (!d.ok) {
      if (d.code === "QUOTA" || d.code === "NO_CONFIG") {
        // Fica na fila; volta quando a cota/config for resolvida.
        blockedCompanies.add(it.companyId);
        await prisma.igAiReply.update({ where: { id: it.id }, data: { errorDetail: d.error } });
        sum.quotaBlocked++;
      } else {
        await prisma.igAiReply.update({ where: { id: it.id }, data: { status: "FAILED", errorDetail: d.error } });
        sum.failed++;
      }
      continue;
    }
    sum.analyzed++;
    await applyDecision(it, a, d, token);
  }
  return sum;
}

async function applyDecision(
  it: { id: string; accountId: string; igCommenterId: string | null; commentId: string; source: string },
  a: { aiApproval: boolean; aiHideSpam: boolean },
  d: Extract<AiDecision, { ok: true }>,
  token: string,
) {
  const base = { intent: d.intent, reason: d.reason || null, replyText: d.text || null, errorDetail: null };

  if (d.intent === "SPAM") {
    if (a.aiHideSpam && token) {
      try {
        await igWithRetry(() => hideComment(it.commentId, token));
        await prisma.igAiReply.update({ where: { id: it.id }, data: { ...base, status: "HIDDEN" } });
        return;
      } catch (e: any) {
        await prisma.igAiReply.update({ where: { id: it.id }, data: { ...base, status: "SKIPPED", errorDetail: e?.message?.slice(0, 500) } });
        return;
      }
    }
    await prisma.igAiReply.update({ where: { id: it.id }, data: { ...base, status: "SKIPPED" } });
    return;
  }
  if (d.intent === "CRITICISM") {
    await prisma.igAiReply.update({ where: { id: it.id }, data: { ...base, status: "NEEDS_YOU" } });
    return;
  }
  if (!d.reply) {
    await prisma.igAiReply.update({ where: { id: it.id }, data: { ...base, status: "SKIPPED" } });
    return;
  }

  // Mesma pessoa comentando várias vezes: responde a pergunta, mas não cada piada.
  if (!LEAD_INTENTS.includes(d.intent) && it.igCommenterId) {
    const recent = await prisma.igAiReply.count({
      where: {
        accountId: it.accountId,
        igCommenterId: it.igCommenterId,
        id: { not: it.id },
        status: { in: ["SENT", "SCHEDULED", "AWAITING_APPROVAL"] },
        updatedAt: { gt: new Date(Date.now() - SAME_PERSON_COOLDOWN_MS) },
      },
    });
    if (recent > 0) {
      await prisma.igAiReply.update({
        where: { id: it.id },
        data: { ...base, status: "SKIPPED", reason: "Já respondemos essa pessoa há pouco" },
      });
      return;
    }
  }

  await prisma.igAiReply.update({
    where: { id: it.id },
    data: a.aiApproval
      ? { ...base, status: "AWAITING_APPROVAL" }
      : { ...base, status: "SCHEDULED", scheduledAt: it.source === "BACKFILL" ? new Date() : humanDelay() },
  });
}

// ─── Etapa 2: publicar no ritmo ──────────────────────────────────────────────

type SendSummary = { sent: number; dms: number; failed: number; capped: number };

async function sendDue(): Promise<SendSummary> {
  const sum: SendSummary = { sent: 0, dms: 0, failed: 0, capped: 0 };
  const now = new Date();
  const due = await prisma.igAiReply.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: [{ scheduledAt: "asc" }, { likeCount: "desc" }],
    take: 100,
    include: {
      automation: true,
      account: { select: { id: true, companyId: true, username: true, accessTokenEnc: true, status: true } },
    },
  });

  const perAccount = new Map<string, typeof due>();
  for (const it of due) {
    const list = perAccount.get(it.accountId) ?? [];
    list.push(it);
    perAccount.set(it.accountId, list);
  }

  for (const [accountId, list] of perAccount) {
    const account = list[0].account;
    if (account.status !== "ACTIVE") continue;
    const token = decryptAccountToken(account.accessTokenEnc);
    if (!token) continue;

    const maxPerHour = Math.max(1, Math.min(...list.map((i) => i.automation?.aiMaxPerHour ?? 40)));
    const lastHour = await prisma.igAiReply.count({
      where: { accountId, status: "SENT", sentAt: { gt: new Date(Date.now() - 60 * 60_000) } },
    });
    const allowance = Math.min(MAX_SEND_PER_ACCOUNT_PER_TICK, maxPerHour - lastHour);
    if (allowance <= 0) {
      sum.capped += list.length;
      continue;
    }

    for (const it of list.slice(0, allowance)) {
      const a = it.automation;
      if (!a || !a.enabled || a.replyMode !== "AI" || !it.replyText) {
        await prisma.igAiReply.update({ where: { id: it.id }, data: { status: "SKIPPED", reason: "Automação desligada antes de publicar" } });
        continue;
      }
      // Trava otimista: só quem virar SCHEDULED→SENT publica (evita 2 ticks simultâneos).
      const lock = await prisma.igAiReply.updateMany({
        where: { id: it.id, status: "SCHEDULED" },
        data: { status: "SENT", sentAt: new Date() },
      });
      if (lock.count === 0) continue;

      try {
        await igWithRetry(() => replyToComment(it.commentId, it.replyText!, token));
        sum.sent++;
      } catch (e: any) {
        sum.failed++;
        await prisma.igAiReply.update({
          where: { id: it.id },
          data: { status: "FAILED", sentAt: null, errorDetail: e?.message?.slice(0, 500) ?? "erro" },
        });
        continue;
      }

      // Pergunta/interesse + automação com DM → manda a DM (com follow-gate, se ligado).
      if (a.sendDm && it.intent && LEAD_INTENTS.includes(it.intent) && it.igCommenterId) {
        try {
          const run = await prisma.igAutomationRun.upsert({
            where: { automationId_commentId: { automationId: a.id, commentId: it.commentId } },
            create: {
              companyId: it.companyId,
              accountId: it.accountId,
              automationId: a.id,
              igCommenterId: it.igCommenterId,
              username: it.username,
              mediaId: it.mediaId,
              commentId: it.commentId,
              commentText: it.commentText,
              status: "COMMENT_REPLIED",
            },
            update: {},
          });
          if (run.status === "COMMENT_REPLIED" || run.status === "PENDING") {
            await runAutomationDm(account, a, run.id, it.commentId, it.igCommenterId, token);
            sum.dms++;
          }
        } catch (e: any) {
          console.error(`[IG IA] DM falhou p/ comentário ${it.commentId}:`, e?.message);
          await prisma.igAutomationRun
            .updateMany({
              where: { automationId: a.id, commentId: it.commentId },
              data: { status: "FAILED", errorDetail: e?.message?.slice(0, 500) ?? "erro" },
            })
            .catch(() => {});
        }
      }
    }
    if (list.length > allowance) sum.capped += list.length - allowance;
  }
  return sum;
}

/** Uma rodada do worker (chamada pelo cron a cada ~60s). Nunca lança. */
export async function processAiReplyQueue() {
  const analyze = await analyzeQueued().catch((e) => {
    console.error("[IG IA] análise falhou:", e?.message);
    return null;
  });
  const send = await sendDue().catch((e) => {
    console.error("[IG IA] envio falhou:", e?.message);
    return null;
  });
  return { analyze, send };
}

// ─── Ações do painel ─────────────────────────────────────────────────────────

/** Gera outra resposta pra um item (botão "outra resposta" no painel). */
export async function regenerateReply(id: string, companyId: string): Promise<{ ok: boolean; error?: string; replyText?: string }> {
  const it = await prisma.igAiReply.findFirst({
    where: { id, companyId },
    include: { automation: true, account: { select: { username: true, accessTokenEnc: true } } },
  });
  if (!it || !it.automation) return { ok: false, error: "Item não encontrado" };
  const token = decryptAccountToken(it.account.accessTokenEnc);
  const caption = it.mediaId && token ? await fetchCaption(it.mediaId, token) : "";
  const recent = await recentRepliesFor(it.automationId, it.mediaId);
  const d = await decideReply({
    companyId,
    ownerUsername: it.account.username,
    automation: it.automation,
    caption,
    commentText: it.commentText ?? "",
    commenterUsername: it.username,
    recentReplies: [...(it.replyText ? [it.replyText] : []), ...recent].slice(0, 8),
  });
  if (!d.ok) return { ok: false, error: d.error };
  if (!d.text) return { ok: false, error: "A IA não sugeriu resposta pra esse comentário" };
  await prisma.igAiReply.update({ where: { id }, data: { replyText: d.text, intent: d.intent, reason: d.reason || null } });
  return { ok: true, replyText: d.text };
}

/**
 * Puxa os comentários que já existem no post e põe na fila (os que ainda não
 * respondemos). Os mais curtidos vão primeiro — é a vitrine do post.
 */
export async function backfillMediaComments(automationId: string, companyId: string): Promise<{ ok: boolean; error?: string; found?: number; queued?: number }> {
  const a = await prisma.igAutomation.findFirst({
    where: { id: automationId, companyId },
    include: { account: { select: { id: true, igUserId: true, username: true, accessTokenEnc: true } } },
  });
  if (!a) return { ok: false, error: "Automação não encontrada" };
  if (a.replyMode !== "AI") return { ok: false, error: "Só funciona no modo IA" };
  if (!a.mediaId) return { ok: false, error: "Escolha um post específico na automação pra puxar os comentários" };
  const token = decryptAccountToken(a.account.accessTokenEnc);
  if (!token) return { ok: false, error: "Conta sem token — reconecte o Instagram" };

  const own = (a.account.username ?? "").toLowerCase();
  let url: string | null =
    `${igGraphBase}/${a.mediaId}/comments?` +
    new URLSearchParams({
      fields: "id,text,username,from,like_count,timestamp,replies.limit(50){username}",
      limit: "50",
      access_token: token,
    }).toString();

  let found = 0;
  let queued = 0;
  while (url && found < BACKFILL_MAX) {
    const r: Response = await fetch(url);
    if (!r.ok) {
      if (found === 0) return { ok: false, error: `Instagram recusou a listagem (${r.status})` };
      break;
    }
    const j: any = await r.json();
    for (const c of j?.data ?? []) {
      found++;
      const username: string | null = c.username ?? c.from?.username ?? null;
      if (username && username.toLowerCase() === own) continue; // comentário nosso
      const alreadyReplied = (c.replies?.data ?? []).some((rep: any) => String(rep?.username ?? "").toLowerCase() === own);
      if (alreadyReplied) continue;
      const ok = await enqueueAiReply({
        companyId: a.companyId,
        accountId: a.accountId,
        automationId: a.id,
        commentId: c.id,
        mediaId: a.mediaId,
        igCommenterId: c.from?.id ?? null,
        username,
        commentText: c.text ?? null,
        likeCount: Number(c.like_count) || 0,
        source: "BACKFILL",
      });
      if (ok) queued++;
    }
    url = j?.paging?.next ?? null;
  }
  return { ok: true, found, queued };
}
