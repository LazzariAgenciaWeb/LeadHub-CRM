/**
 * Caixa de Email IMAP por empresa — grupo Atender.
 *
 * Par do `src/lib/company-email.ts` (que cuida só do ENVIO via SMTP):
 * aqui fica o RECEBIMENTO. O poller (/api/cron/imap-sync) chama
 * `syncCompanyInbox()` pra cada empresa com config ativa; a triagem
 * (importante/spam/lixeira) é local no LeadHub — não escrevemos flags
 * de volta no servidor IMAP.
 */
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "./prisma";
import { encryptSecret, tryDecryptSecret } from "./crypto";
import { sendCompanyMail } from "./company-email";
import type { InboxEmailFolder } from "@/generated/prisma";

export interface CompanyImapConfigInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string; // opcional no update (mantém a antiga se vazio)
  active?: boolean;
}

/** Quantos emails puxar na primeira sincronização (caixa nova). */
const FIRST_SYNC_COUNT = 50;
/** Máximo de emails importados por tick (não travar o handler do cron). */
const MAX_PER_SYNC = 100;

/** Salva/atualiza a config IMAP da empresa. Senha em AES-256-GCM. */
export async function upsertCompanyImapConfig(companyId: string, input: CompanyImapConfigInput) {
  const existing = await prisma.companyImapConfig.findUnique({ where: { companyId } });

  let passEnc = existing?.passEnc ?? "";
  if (input.pass && input.pass.trim()) {
    passEnc = encryptSecret(input.pass.trim());
  }
  if (!passEnc) throw new Error("Senha IMAP obrigatória na primeira configuração");

  const data = {
    host: input.host.trim(),
    port: input.port,
    secure: input.secure,
    user: input.user.trim(),
    passEnc,
    active: input.active ?? true,
  };
  return prisma.companyImapConfig.upsert({
    where: { companyId },
    create: { companyId, ...data },
    // Mudou config → precisa verificar de novo; zera o cursor só se trocou de conta.
    update: {
      ...data,
      verified: false,
      lastError: null,
      ...(existing && (existing.host !== data.host || existing.user !== data.user)
        ? { lastUid: null, uidValidity: null }
        : {}),
    },
  });
}

interface ResolvedImap {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

async function getResolvedImapConfig(companyId: string): Promise<ResolvedImap | null> {
  const cfg = await prisma.companyImapConfig.findUnique({ where: { companyId } });
  if (!cfg) return null;
  const pass = tryDecryptSecret(cfg.passEnc) ?? "";
  if (!cfg.host || !cfg.user || !pass) return null;
  return { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass };
}

function buildClient(cfg: ResolvedImap): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
}

/** Testa conexão IMAP da empresa. Atualiza verified/lastError. */
export async function verifyCompanyImap(companyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await getResolvedImapConfig(companyId);
  if (!cfg) return { ok: false, error: "IMAP não configurado" };
  try {
    const client = buildClient(cfg);
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    lock.release();
    await client.logout();
    await prisma.companyImapConfig.update({
      where: { companyId },
      data: { verified: true, lastVerifiedAt: new Date(), lastError: null },
    });
    return { ok: true };
  } catch (e: any) {
    const error = e?.responseText ?? e?.message ?? "Falha ao conectar";
    await prisma.companyImapConfig
      .update({ where: { companyId }, data: { verified: false, lastError: error } })
      .catch(() => null);
    return { ok: false, error };
  }
}

function makeSnippet(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

/**
 * Resolve vínculo automático do email recebido:
 *  1. In-Reply-To aponta pra um email já registrado (enviado de dentro de um
 *     lead/chamado) → herda leadId/ticketId.
 *  2. Remetente bate com Lead.email da empresa → vincula ao lead mais recente.
 */
async function resolveIncomingLink(
  companyId: string,
  inReplyTo: string | null,
  fromEmail: string
): Promise<{ leadId: string | null; ticketId: string | null }> {
  if (inReplyTo) {
    const original = await prisma.inboxEmail.findUnique({
      where: { companyId_messageId: { companyId, messageId: inReplyTo } },
      select: { leadId: true, ticketId: true },
    });
    if (original && (original.leadId || original.ticketId)) {
      return { leadId: original.leadId, ticketId: original.ticketId };
    }
  }
  if (fromEmail) {
    const lead = await prisma.lead.findFirst({
      where: { companyId, email: { equals: fromEmail, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (lead) return { leadId: lead.id, ticketId: null };
  }
  return { leadId: null, ticketId: null };
}

async function storeIncoming(companyId: string, uid: number, parsed: ParsedMail) {
  const fromAddr = parsed.from?.value?.[0];
  const fromEmail = (fromAddr?.address ?? "").toLowerCase();
  const toText = Array.isArray(parsed.to)
    ? parsed.to.map((t) => t.text).join(", ")
    : parsed.to?.text ?? "";
  const messageId = parsed.messageId ?? null;
  const inReplyTo = parsed.inReplyTo ?? null;

  // Dedup por Message-ID (re-sync após reset de uidValidity, por exemplo).
  if (messageId) {
    const dup = await prisma.inboxEmail.findUnique({
      where: { companyId_messageId: { companyId, messageId } },
      select: { id: true },
    });
    if (dup) return false;
  }

  const link = await resolveIncomingLink(companyId, inReplyTo, fromEmail);

  await prisma.inboxEmail.create({
    data: {
      companyId,
      direction: "IN",
      folder: "INBOX",
      messageId,
      imapUid: uid,
      fromEmail: fromEmail || "desconhecido",
      fromName: fromAddr?.name || null,
      toEmail: toText,
      subject: parsed.subject ?? "",
      snippet: makeSnippet(parsed.text),
      textBody: parsed.text ?? null,
      htmlBody: typeof parsed.html === "string" ? parsed.html : null,
      inReplyTo,
      leadId: link.leadId,
      ticketId: link.ticketId,
      sentAt: parsed.date ?? new Date(),
    },
  });
  return true;
}

/**
 * Sincroniza a INBOX da empresa (incremental por UID).
 * Retorna quantos emails novos foram importados.
 */
export async function syncCompanyInbox(companyId: string): Promise<{ imported: number }> {
  const stored = await prisma.companyImapConfig.findUnique({ where: { companyId } });
  if (!stored || !stored.active) return { imported: 0 };
  const cfg = await getResolvedImapConfig(companyId);
  if (!cfg) throw new Error("IMAP não configurado (senha ilegível ou incompleta)");

  const client = buildClient(cfg);
  let imported = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      if (!mailbox || typeof mailbox === "boolean") throw new Error("INBOX indisponível");

      const currentValidity = mailbox.uidValidity ?? BigInt(0);
      // uidValidity mudou → UIDs antigos não valem mais; recomeça do fim.
      const validCursor =
        stored.lastUid != null && stored.uidValidity != null && stored.uidValidity === currentValidity;

      // Coleta os UIDs alvo. Primeira sync (ou reset): últimos FIRST_SYNC_COUNT
      // por sequência. Incremental: UID > lastUid.
      const uids: number[] = [];
      if (validCursor) {
        const found = await client.search({ uid: `${stored.lastUid! + 1}:*` }, { uid: true });
        for (const uid of found || []) {
          // `N:*` sempre inclui a última mensagem mesmo se UID < N — filtra.
          if (uid > stored.lastUid!) uids.push(uid);
        }
      } else if (mailbox.exists > 0) {
        const startSeq = Math.max(1, mailbox.exists - FIRST_SYNC_COUNT + 1);
        const found = await client.search({ seq: `${startSeq}:*` }, { uid: true });
        for (const uid of found || []) uids.push(uid);
      }
      uids.sort((a, b) => a - b);
      const batch = uids.slice(0, MAX_PER_SYNC);

      let maxUid = validCursor ? stored.lastUid! : 0;
      for (const uid of batch) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const created = await storeIncoming(companyId, uid, parsed);
        if (created) imported++;
        if (uid > maxUid) maxUid = uid;
      }

      await prisma.companyImapConfig.update({
        where: { companyId },
        data: {
          lastUid: maxUid || stored.lastUid || null,
          uidValidity: currentValidity,
          lastSyncedAt: new Date(),
          verified: true,
          lastVerifiedAt: new Date(),
          lastError: null,
        },
      });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e: any) {
    try {
      client.close();
    } catch {}
    const error = e?.responseText ?? e?.message ?? "Falha na sincronização";
    await prisma.companyImapConfig
      .update({ where: { companyId }, data: { lastError: error } })
      .catch(() => null);
    throw e;
  }
  return { imported };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SendInboxEmailInput {
  to: string;
  subject: string;
  /** Corpo em texto puro (a UI manda texto; viramos HTML simples). */
  text: string;
  /** Responder a um InboxEmail existente → In-Reply-To/References + herda vínculo. */
  replyToId?: string | null;
  leadId?: string | null;
  ticketId?: string | null;
}

/**
 * Envia um email pela conta SMTP da empresa e registra na pasta ENVIADOS,
 * com vínculo opcional a lead/chamado (usado pelas telas de CRM e chamados).
 */
export async function sendInboxEmail(companyId: string, input: SendInboxEmailInput) {
  const headers: Record<string, string> = {};
  let leadId = input.leadId ?? null;
  let ticketId = input.ticketId ?? null;
  let inReplyTo: string | null = null;

  if (input.replyToId) {
    const original = await prisma.inboxEmail.findFirst({
      where: { id: input.replyToId, companyId },
      select: { messageId: true, leadId: true, ticketId: true },
    });
    if (original?.messageId) {
      inReplyTo = original.messageId;
      headers["In-Reply-To"] = original.messageId;
      headers["References"] = original.messageId;
    }
    leadId = leadId ?? original?.leadId ?? null;
    ticketId = ticketId ?? original?.ticketId ?? null;
  }

  const text = input.text.trim();
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111">${escapeHtml(text).replace(/\n/g, "<br/>")}</div>`;

  const sent = await sendCompanyMail(companyId, {
    to: input.to.trim(),
    subject: input.subject.trim(),
    html,
    text,
    headers: Object.keys(headers).length ? headers : undefined,
  });

  const record = await prisma.inboxEmail.create({
    data: {
      companyId,
      direction: "OUT",
      folder: "SENT" as InboxEmailFolder,
      messageId: sent.messageId,
      fromEmail: sent.fromEmail,
      fromName: sent.fromName,
      toEmail: input.to.trim(),
      subject: input.subject.trim(),
      snippet: makeSnippet(text),
      textBody: text,
      htmlBody: html,
      inReplyTo,
      leadId,
      ticketId,
      seen: true,
      sentAt: new Date(),
    },
  });
  return record;
}
