/**
 * Caixa de Email por empresa — grupo Atender.
 *
 * Cada empresa cadastra N contas (EmailAccount): SMTP (envio) + IMAP
 * (recebimento) juntos. O poller (/api/cron/imap-sync) chama
 * `syncAccountInbox()` pra cada conta ativa com IMAP; o envio sai pelo SMTP
 * da conta escolhida. A triagem (importante/spam/lixeira) é local no
 * LeadHub — não escrevemos flags de volta no servidor IMAP.
 *
 * Fallback de envio: empresa sem conta cadastrada mas com CompanyEmailConfig
 * (SMTP do Email Marketing) envia por lá — mantém o botão de email do
 * lead/chamado funcionando.
 */
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
// MailComposer monta o MIME bruto pro APPEND na pasta Enviados do servidor
// (SMTP genérico não guarda cópia do enviado — só o Gmail faz sozinho).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MailComposer = require("nodemailer/lib/mail-composer");
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "./prisma";
import { encryptSecret, tryDecryptSecret } from "./crypto";
import { sendCompanyMail } from "./company-email";
import type { EmailAccount, InboxEmailFolder } from "@/generated/prisma";

export interface EmailAccountInput {
  label?: string | null;
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass?: string; // opcional no update (mantém a antiga se vazio)
  imapHost?: string | null;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string | null;
  imapPass?: string; // idem
  /** Assinatura anexada ao fim de todo envio desta conta. */
  signature?: string | null;
  active?: boolean;
}

/** Quantos emails puxar na primeira sincronização (caixa nova). */
const FIRST_SYNC_COUNT = 50;
/** Máximo de emails importados por tick (não travar o handler do cron). */
const MAX_PER_SYNC = 100;
/** Máximo de anexos referenciados por email. */
const MAX_ATTACHMENTS_PER_EMAIL = 10;

/**
 * Varre a estrutura MIME (bodyStructure do IMAP) e coleta as partes que são
 * anexo: disposition=attachment, ou parte com filename que não é inline
 * (logo de assinatura etc. fica de fora). Só METADADOS — o conteúdo é baixado
 * sob demanda pela rota de download, direto do servidor.
 */
function collectAttachmentParts(
  node: any,
  out: { partId: string; filename: string; contentType: string; size: number }[] = []
): { partId: string; filename: string; contentType: string; size: number }[] {
  if (!node) return out;
  const filename: string | undefined =
    node.dispositionParameters?.filename || node.parameters?.name;
  const isAttachment =
    !!node.part &&
    (node.disposition === "attachment" || (!!filename && node.disposition !== "inline"));
  if (isAttachment) {
    out.push({
      partId: String(node.part),
      filename: filename || "anexo",
      contentType: String(node.type || "application/octet-stream"),
      size: Number(node.size ?? 0),
    });
  }
  for (const child of node.childNodes ?? []) collectAttachmentParts(child, out);
  return out;
}

/** Cria/atualiza uma conta. Senhas em AES-256-GCM. */
export async function upsertEmailAccount(
  companyId: string,
  input: EmailAccountInput,
  accountId?: string | null
) {
  const existing = accountId
    ? await prisma.emailAccount.findFirst({ where: { id: accountId, companyId } })
    : null;
  if (accountId && !existing) throw new Error("Conta não encontrada");

  let smtpPassEnc = existing?.smtpPassEnc ?? "";
  if (input.smtpPass && input.smtpPass.trim()) smtpPassEnc = encryptSecret(input.smtpPass.trim());
  if (!smtpPassEnc) throw new Error("Senha SMTP obrigatória na primeira configuração");

  let imapPassEnc = existing?.imapPassEnc ?? null;
  if (input.imapPass && input.imapPass.trim()) imapPassEnc = encryptSecret(input.imapPass.trim());
  const imapHost = input.imapHost?.trim() || null;
  if (imapHost && !imapPassEnc) throw new Error("Senha IMAP obrigatória quando o servidor IMAP é informado");

  const data = {
    label: input.label?.trim() || null,
    fromName: input.fromName.trim(),
    fromEmail: input.fromEmail.trim().toLowerCase(),
    smtpHost: input.smtpHost.trim(),
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    smtpUser: input.smtpUser.trim(),
    smtpPassEnc,
    imapHost,
    imapPort: input.imapPort ?? 993,
    imapSecure: input.imapSecure ?? true,
    imapUser: input.imapUser?.trim() || null,
    imapPassEnc,
    signature: input.signature?.trim() || null,
    active: input.active ?? true,
  };

  if (existing) {
    return prisma.emailAccount.update({
      where: { id: existing.id },
      // Mudou config → precisa verificar de novo; zera o cursor se trocou a caixa IMAP.
      data: {
        ...data,
        smtpVerified: false,
        imapVerified: false,
        lastError: null,
        ...(existing.imapHost !== data.imapHost || existing.imapUser !== data.imapUser
          ? { lastUid: null, uidValidity: null }
          : {}),
      },
    });
  }
  return prisma.emailAccount.create({ data: { companyId, ...data } });
}

function decryptedSmtp(acc: EmailAccount) {
  const pass = tryDecryptSecret(acc.smtpPassEnc) ?? "";
  if (!acc.smtpHost || !acc.smtpUser || !pass) return null;
  return { host: acc.smtpHost, port: acc.smtpPort, secure: acc.smtpSecure, user: acc.smtpUser, pass };
}

function decryptedImap(acc: EmailAccount) {
  if (!acc.imapHost || !acc.imapPassEnc) return null;
  const pass = tryDecryptSecret(acc.imapPassEnc) ?? "";
  const user = acc.imapUser || acc.smtpUser;
  if (!pass || !user) return null;
  return { host: acc.imapHost, port: acc.imapPort, secure: acc.imapSecure, user, pass };
}

function buildImapClient(cfg: { host: string; port: number; secure: boolean; user: string; pass: string }): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
}

/** Testa SMTP e IMAP da conta. Atualiza smtpVerified/imapVerified/lastError. */
export async function verifyEmailAccount(
  companyId: string,
  accountId: string
): Promise<{ smtp: { ok: boolean; error?: string }; imap: { ok: boolean; error?: string } | null }> {
  const acc = await prisma.emailAccount.findFirst({ where: { id: accountId, companyId } });
  if (!acc) throw new Error("Conta não encontrada");

  // SMTP
  let smtp: { ok: boolean; error?: string };
  const smtpCfg = decryptedSmtp(acc);
  if (!smtpCfg) {
    smtp = { ok: false, error: "SMTP incompleto (senha ilegível?)" };
  } else {
    try {
      const t = nodemailer.createTransport({
        host: smtpCfg.host, port: smtpCfg.port, secure: smtpCfg.secure,
        auth: { user: smtpCfg.user, pass: smtpCfg.pass },
      });
      await t.verify();
      smtp = { ok: true };
    } catch (e: any) {
      smtp = { ok: false, error: e?.message ?? "Falha ao conectar no SMTP" };
    }
  }

  // IMAP (se configurado)
  let imap: { ok: boolean; error?: string } | null = null;
  const imapCfg = decryptedImap(acc);
  if (acc.imapHost) {
    if (!imapCfg) {
      imap = { ok: false, error: "IMAP incompleto (senha ilegível?)" };
    } else {
      try {
        const client = buildImapClient(imapCfg);
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        lock.release();
        await client.logout();
        imap = { ok: true };
      } catch (e: any) {
        imap = { ok: false, error: e?.responseText ?? e?.message ?? "Falha ao conectar no IMAP" };
      }
    }
  }

  const errors = [
    smtp.ok ? null : `SMTP: ${smtp.error}`,
    imap && !imap.ok ? `IMAP: ${imap.error}` : null,
  ].filter(Boolean);
  await prisma.emailAccount.update({
    where: { id: acc.id },
    data: {
      smtpVerified: smtp.ok,
      imapVerified: imap?.ok ?? false,
      lastVerifiedAt: new Date(),
      lastError: errors.length ? errors.join(" · ") : null,
    },
  });
  return { smtp, imap };
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
    const original = await prisma.inboxEmail.findFirst({
      where: { companyId, messageId: inReplyTo },
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

/** Primeiro endereço de destinatário do email parseado (lowercase). */
function firstToAddress(parsed: ParsedMail): string {
  const to = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to;
  return (to?.value?.[0]?.address ?? "").toLowerCase();
}

/** Vínculo de email ENVIADO (importado da pasta \Sent): thread → destinatário. */
async function resolveOutgoingLink(
  companyId: string,
  inReplyTo: string | null,
  toEmail: string
): Promise<{ leadId: string | null; ticketId: string | null }> {
  if (inReplyTo) {
    const original = await prisma.inboxEmail.findFirst({
      where: { companyId, messageId: inReplyTo },
      select: { leadId: true, ticketId: true },
    });
    if (original && (original.leadId || original.ticketId)) {
      return { leadId: original.leadId, ticketId: original.ticketId };
    }
  }
  if (toEmail) {
    const lead = await prisma.lead.findFirst({
      where: { companyId, email: { equals: toEmail, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (lead) return { leadId: lead.id, ticketId: null };
  }
  return { leadId: null, ticketId: null };
}

async function storeMessage(
  companyId: string,
  accountId: string,
  uid: number,
  parsed: ParsedMail,
  direction: "IN" | "OUT",
  bodyStructure?: any
) {
  const fromAddr = parsed.from?.value?.[0];
  const fromEmail = (fromAddr?.address ?? "").toLowerCase();
  const toText = Array.isArray(parsed.to)
    ? parsed.to.map((t) => t.text).join(", ")
    : parsed.to?.text ?? "";
  const messageId = parsed.messageId ?? null;
  const inReplyTo = parsed.inReplyTo ?? null;

  // Dedup por Message-ID DENTRO DA MESMA CONTA. Já foi dedup na empresa
  // inteira, mas com caixas restritas por setor isso escondia email: a cópia
  // redirecionada ficava só na primeira caixa sincronizada, e quem só acessa
  // a segunda não via nada. Agora cada caixa guarda a própria cópia (admin
  // vendo "Todas" pode ver o mesmo email 2x — preço da permissão correta).
  // Cobre re-sync após reset de uidValidity e o envio da plataforma na \Sent.
  if (messageId) {
    const dup = await prisma.inboxEmail.findUnique({
      where: { accountId_messageId: { accountId, messageId } },
      select: {
        id: true, imapUid: true, direction: true,
        _count: { select: { attachments: true } },
      },
    });
    if (dup) {
      // Backfill: o registro criado na hora do envio pela plataforma não tem
      // UID nem anexos referenciados — quando a cópia aparece na pasta \Sent
      // do servidor, completamos (habilita o download dos anexos enviados).
      if (direction === "OUT" && dup.direction === "OUT" && !dup.imapUid) {
        await prisma.inboxEmail
          .update({ where: { id: dup.id }, data: { imapUid: uid } })
          .catch(() => null);
        if (dup._count.attachments === 0) {
          const parts = collectAttachmentParts(bodyStructure).slice(0, MAX_ATTACHMENTS_PER_EMAIL);
          for (const a of parts) {
            await prisma.inboxEmailAttachment
              .create({ data: { emailId: dup.id, ...a } })
              .catch(() => null);
          }
        }
      }
      return false;
    }
  }

  let folder: InboxEmailFolder;
  let link: { leadId: string | null; ticketId: string | null };
  if (direction === "IN") {
    link = await resolveIncomingLink(companyId, inReplyTo, fromEmail);
    // Blacklist/whitelist: regra do EMAIL exato tem precedência sobre a regra
    // do DOMÍNIO ("@dominio.com"). Regra de domínio pega SUBDOMÍNIOS também —
    // spammer que manda de a.dominio.com / e.dominio.com cai na regra de
    // "@dominio.com". BLOCK → SPAM; ALLOW/nenhuma → Entrada.
    let ruleType: string | null = null;
    if (fromEmail) {
      const domain = fromEmail.split("@")[1] ?? "";
      // Candidatos: o domínio completo e cada sufixo com ≥2 labels
      // (e.ultrasul1.com → ["@e.ultrasul1.com", "@ultrasul1.com"]).
      const parts = domain.split(".");
      const candidates: string[] = [fromEmail];
      for (let i = 0; i <= parts.length - 2; i++) {
        candidates.push(`@${parts.slice(i).join(".")}`);
      }
      const rules = await prisma.inboxSenderRule.findMany({
        where: { companyId, fromEmail: { in: candidates } },
        select: { fromEmail: true, type: true },
      });
      const exact = rules.find((r) => r.fromEmail === fromEmail);
      // Empate entre domínios: o mais específico (mais longo) decide.
      const domRule = rules
        .filter((r) => r.fromEmail.startsWith("@"))
        .sort((a, b) => b.fromEmail.length - a.fromEmail.length)[0];
      ruleType = (exact ?? domRule)?.type ?? null;
    }
    folder = ruleType === "BLOCK" ? "SPAM" : "INBOX";
  } else {
    link = await resolveOutgoingLink(companyId, inReplyTo, firstToAddress(parsed));
    folder = "SENT";
  }

  const created = await prisma.inboxEmail.create({
    data: {
      companyId,
      accountId,
      direction,
      folder,
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
      seen: direction === "OUT",
      sentAt: parsed.date ?? new Date(),
    },
    select: { id: true },
  });

  // Anexos: só a REFERÊNCIA (parte MIME) — conteúdo fica no servidor e é
  // baixado sob demanda no clique. Best-effort: falha não perde o email.
  const attachments = collectAttachmentParts(bodyStructure).slice(0, MAX_ATTACHMENTS_PER_EMAIL);
  for (const a of attachments) {
    await prisma.inboxEmailAttachment.create({
      data: { emailId: created.id, ...a },
    }).catch((e) => console.warn(`[imap-inbox] anexo falhou (${a.filename})`, e));
  }

  // Auto-tag por histórico. Mesmo remetente NÃO basta (o mesmo fornecedor
  // manda boleto, confirmação de pagamento E nota fiscal — tags diferentes).
  // Regra: aplica as tags de um email anterior do MESMO remetente quando
  //   a) o assunto normalizado bate (Re:/números/datas ignorados) — mesmo
  //      tipo de email, mesmo tratamento; OU
  //   b) o remetente é "monotemático": TODOS os emails tagueados dele têm o
  //      mesmo conjunto de tags (aí não há ambiguidade).
  // Grátis (sem IA). Casos ambíguos ficam pra triagem IA, que decide pelo
  // conteúdo imitando exemplos do usuário.
  if (direction === "IN" && fromEmail) {
    const prevTagged = await prisma.inboxEmail.findMany({
      where: { companyId, fromEmail, tags: { some: {} }, id: { not: created.id } },
      orderBy: { sentAt: "desc" },
      take: 20,
      select: { subject: true, tags: { select: { id: true } } },
    });
    if (prevTagged.length) {
      const norm = (s: string) =>
        s.toLowerCase()
          .replace(/^((re|fwd?|enc|res):\s*)+/g, "")
          .replace(/\d+/g, "#")
          .replace(/\s+/g, " ")
          .trim();
      const target = norm(parsed.subject ?? "");

      let tagsToApply = target
        ? prevTagged.find((p) => norm(p.subject) === target)?.tags
        : undefined;
      if (!tagsToApply) {
        const distinctSets = new Set(
          prevTagged.map((p) => p.tags.map((t) => t.id).sort().join(","))
        );
        if (distinctSets.size === 1) tagsToApply = prevTagged[0].tags;
      }
      if (tagsToApply?.length) {
        await prisma.inboxEmail
          .update({ where: { id: created.id }, data: { tags: { connect: tagsToApply } } })
          .catch(() => null);
      }
    }
  }
  return true;
}

/**
 * Sincroniza UMA mailbox (incremental por UID) já com o client conectado.
 * Retorna o cursor novo + quantos emails foram importados.
 */
async function syncMailbox(
  client: ImapFlow,
  companyId: string,
  accountId: string,
  path: string,
  direction: "IN" | "OUT",
  cursor: { lastUid: number | null; uidValidity: bigint | null }
): Promise<{ imported: number; lastUid: number | null; uidValidity: bigint }> {
  const lock = await client.getMailboxLock(path);
  let imported = 0;
  try {
    const mailbox = client.mailbox;
    if (!mailbox || typeof mailbox === "boolean") throw new Error(`Mailbox ${path} indisponível`);

    const currentValidity = mailbox.uidValidity ?? BigInt(0);
    // uidValidity mudou → UIDs antigos não valem mais; recomeça do fim.
    const validCursor =
      cursor.lastUid != null && cursor.uidValidity != null && cursor.uidValidity === currentValidity;

    // Coleta os UIDs alvo. Primeira sync (ou reset): últimos FIRST_SYNC_COUNT
    // por sequência. Incremental: UID > lastUid.
    const uids: number[] = [];
    if (validCursor) {
      const found = await client.search({ uid: `${cursor.lastUid! + 1}:*` }, { uid: true });
      for (const uid of found || []) {
        // `N:*` sempre inclui a última mensagem mesmo se UID < N — filtra.
        if (uid > cursor.lastUid!) uids.push(uid);
      }
    } else if (mailbox.exists > 0) {
      const startSeq = Math.max(1, mailbox.exists - FIRST_SYNC_COUNT + 1);
      const found = await client.search({ seq: `${startSeq}:*` }, { uid: true });
      for (const uid of found || []) uids.push(uid);
    }
    uids.sort((a, b) => a - b);
    const batch = uids.slice(0, MAX_PER_SYNC);

    let maxUid = validCursor ? cursor.lastUid! : 0;
    for (const uid of batch) {
      const msg = await client.fetchOne(String(uid), { source: true, bodyStructure: true }, { uid: true });
      if (!msg || typeof msg === "boolean" || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const created = await storeMessage(companyId, accountId, uid, parsed, direction, msg.bodyStructure);
      if (created) imported++;
      if (uid > maxUid) maxUid = uid;
    }
    return { imported, lastUid: maxUid || cursor.lastUid || null, uidValidity: currentValidity };
  } finally {
    lock.release();
  }
}

/** Acha a pasta de Enviados do servidor: special-use \Sent ou nome comum. */
async function findSentMailboxPath(client: ImapFlow): Promise<string | null> {
  try {
    const boxes = await client.list();
    const bySpecial = boxes.find((b: any) => b.specialUse === "\\Sent");
    if (bySpecial) return bySpecial.path;
    const byName = boxes.find((b: any) => /(^|[./])(sent( items| messages)?|enviad[oa]s?)$/i.test(b.path));
    return byName?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Sincroniza a conta: INBOX (recebidos) + pasta \Sent do servidor (enviados
 * por fora da plataforma — webmail, celular). Cursores independentes.
 * Retorna quantos emails novos foram importados.
 */
export async function syncAccountInbox(companyId: string, accountId: string): Promise<{ imported: number }> {
  const acc = await prisma.emailAccount.findFirst({ where: { id: accountId, companyId } });
  if (!acc || !acc.active || !acc.imapHost) return { imported: 0 };
  const imapCfg = decryptedImap(acc);
  if (!imapCfg) throw new Error("IMAP não configurado (senha ilegível ou incompleta)");

  const client = buildImapClient(imapCfg);
  let imported = 0;
  try {
    await client.connect();

    const inboxResult = await syncMailbox(client, companyId, acc.id, "INBOX", "IN", {
      lastUid: acc.lastUid,
      uidValidity: acc.uidValidity,
    });
    imported += inboxResult.imported;

    // Pasta de Enviados do servidor (best-effort: nem todo servidor expõe).
    let sentResult: { imported: number; lastUid: number | null; uidValidity: bigint } | null = null;
    const sentPath = await findSentMailboxPath(client);
    if (sentPath) {
      try {
        sentResult = await syncMailbox(client, companyId, acc.id, sentPath, "OUT", {
          lastUid: acc.sentLastUid,
          uidValidity: acc.sentUidValidity,
        });
        imported += sentResult.imported;
      } catch (e) {
        console.warn(`[imap-inbox] sync da pasta ${sentPath} falhou (conta ${acc.fromEmail})`, e);
      }
    }

    await prisma.emailAccount.update({
      where: { id: acc.id },
      data: {
        lastUid: inboxResult.lastUid,
        uidValidity: inboxResult.uidValidity,
        ...(sentResult ? { sentLastUid: sentResult.lastUid, sentUidValidity: sentResult.uidValidity } : {}),
        lastSyncedAt: new Date(),
        imapVerified: true,
        lastVerifiedAt: new Date(),
        lastError: null,
      },
    });
    await client.logout();
  } catch (e: any) {
    try {
      client.close();
    } catch {}
    const error = e?.responseText ?? e?.message ?? "Falha na sincronização";
    await prisma.emailAccount
      .update({ where: { id: acc.id }, data: { lastError: error } })
      .catch(() => null);
    throw e;
  }
  return { imported };
}

/** Sincroniza todas as contas ativas com IMAP da empresa. */
export async function syncCompanyAccounts(companyId: string): Promise<{ imported: number; errors: string[] }> {
  const accounts = await prisma.emailAccount.findMany({
    where: { companyId, active: true, imapHost: { not: null } },
    select: { id: true, fromEmail: true },
  });
  let imported = 0;
  const errors: string[] = [];
  for (const acc of accounts) {
    try {
      const r = await syncAccountInbox(companyId, acc.id);
      imported += r.imported;
    } catch (e: any) {
      errors.push(`${acc.fromEmail}: ${e?.message ?? "erro"}`);
    }
  }
  return { imported, errors };
}

/**
 * Baixa UM anexo direto do servidor IMAP, sob demanda (nada fica no banco).
 * Confere o Message-ID do UID antes (mailbox renumerada → não entrega arquivo
 * errado). Retorna null se o email não está mais no servidor / conta sem IMAP.
 */
export async function downloadEmailAttachment(
  companyId: string,
  attachmentId: string
): Promise<{ filename: string; contentType: string; buffer: Buffer } | null> {
  const att = await prisma.inboxEmailAttachment.findFirst({
    where: { id: attachmentId, email: { companyId } },
    select: {
      filename: true, contentType: true, partId: true,
      email: { select: { imapUid: true, messageId: true, direction: true, accountId: true } },
    },
  });
  if (!att?.email?.accountId || !att.email.imapUid) return null;
  const acc = await prisma.emailAccount.findFirst({ where: { id: att.email.accountId, companyId } });
  if (!acc?.imapHost) return null;
  const imapCfg = decryptedImap(acc);
  if (!imapCfg) return null;

  const client = buildImapClient(imapCfg);
  try {
    await client.connect();
    const path = att.email.direction === "IN" ? "INBOX" : (await findSentMailboxPath(client)) ?? "INBOX";
    const lock = await client.getMailboxLock(path);
    try {
      if (att.email.messageId) {
        const msg = await client.fetchOne(String(att.email.imapUid), { envelope: true }, { uid: true });
        const serverMsgId = msg && typeof msg !== "boolean" ? msg.envelope?.messageId : null;
        if (!serverMsgId || serverMsgId !== att.email.messageId) return null;
      }
      const dl = await client.download(String(att.email.imapUid), att.partId, { uid: true });
      if (!dl?.content) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of dl.content) chunks.push(chunk as Buffer);
      return {
        filename: att.filename,
        contentType: dl.meta?.contentType || att.contentType,
        buffer: Buffer.concat(chunks),
      };
    } finally {
      lock.release();
    }
  } catch (e) {
    console.warn(`[imap-inbox] download de anexo falhou (${attachmentId})`, e);
    return null;
  } finally {
    try {
      await client.logout();
    } catch {
      try { client.close(); } catch {}
    }
  }
}

/**
 * Apaga um email TAMBÉM no servidor IMAP (exclusão definitiva da Lixeira).
 * Segurança: antes de deletar, confere o Message-ID do UID no servidor contra
 * o registrado — se a mailbox foi renumerada (uidValidity reset), o UID pode
 * apontar pra outro email e aí NÃO deletamos.
 * Retorna true se deletou no servidor; false se não foi possível (sem conta,
 * sem UID, Message-ID divergente…) — o registro local é apagado mesmo assim
 * pelo chamador.
 */
export async function deleteEmailFromServer(companyId: string, inboxEmailId: string): Promise<boolean> {
  const email = await prisma.inboxEmail.findFirst({
    where: { id: inboxEmailId, companyId },
    select: { imapUid: true, messageId: true, direction: true, accountId: true },
  });
  if (!email?.accountId || !email.imapUid) return false;
  const acc = await prisma.emailAccount.findFirst({ where: { id: email.accountId, companyId } });
  if (!acc?.imapHost) return false;
  const imapCfg = decryptedImap(acc);
  if (!imapCfg) return false;

  const client = buildImapClient(imapCfg);
  try {
    await client.connect();
    const path = email.direction === "IN" ? "INBOX" : (await findSentMailboxPath(client)) ?? "INBOX";
    const lock = await client.getMailboxLock(path);
    try {
      // Confere identidade do UID antes de deletar.
      if (email.messageId) {
        const msg = await client.fetchOne(String(email.imapUid), { envelope: true }, { uid: true });
        const serverMsgId = msg && typeof msg !== "boolean" ? msg.envelope?.messageId : null;
        if (!serverMsgId || serverMsgId !== email.messageId) return false;
      }
      await client.messageDelete(String(email.imapUid), { uid: true });
      return true;
    } finally {
      lock.release();
    }
  } catch (e) {
    console.warn(`[imap-inbox] exclusão no servidor falhou (email ${inboxEmailId})`, e);
    return false;
  } finally {
    try {
      await client.logout();
    } catch {
      try { client.close(); } catch {}
    }
  }
}

/** Grava o MIME bruto na pasta Enviados (\Sent) do servidor da conta. */
async function appendSentCopy(acc: EmailAccount, raw: Buffer): Promise<void> {
  const imapCfg = decryptedImap(acc);
  if (!imapCfg) return;
  const client = buildImapClient(imapCfg);
  try {
    await client.connect();
    const path = (await findSentMailboxPath(client)) ?? "INBOX.Sent";
    await client.append(path, raw, ["\\Seen"]);
  } finally {
    try {
      await client.logout();
    } catch {
      try { client.close(); } catch {}
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SendAttachmentInput {
  filename: string;
  contentType: string;
  /** Conteúdo em base64 (upload do browser). */
  contentBase64: string;
}

export interface SendInboxEmailInput {
  /** Destinatários To — um ou vários, separados por vírgula. */
  to: string;
  /** Cópia (Cc), separados por vírgula. */
  cc?: string | null;
  /** Cópia oculta (Cco), separados por vírgula. */
  bcc?: string | null;
  subject: string;
  /** Corpo em texto puro (a UI manda texto; viramos HTML simples). */
  text: string;
  attachments?: SendAttachmentInput[];
  /** Conta pela qual enviar. Sem ela: conta da thread (resposta) → 1ª ativa → fallback CompanyEmailConfig. */
  accountId?: string | null;
  /** Responder a um InboxEmail existente → In-Reply-To/References + herda vínculo. */
  replyToId?: string | null;
  leadId?: string | null;
  ticketId?: string | null;
}

/**
 * Envia um email por uma conta da empresa e registra na pasta ENVIADOS,
 * com vínculo opcional a lead/chamado (usado pelas telas de CRM e chamados).
 */
export async function sendInboxEmail(companyId: string, input: SendInboxEmailInput) {
  const headers: Record<string, string> = {};
  let leadId = input.leadId ?? null;
  let ticketId = input.ticketId ?? null;
  let inReplyTo: string | null = null;
  let accountId = input.accountId ?? null;

  if (input.replyToId) {
    const original = await prisma.inboxEmail.findFirst({
      where: { id: input.replyToId, companyId },
      select: { messageId: true, leadId: true, ticketId: true, accountId: true },
    });
    if (original?.messageId) {
      inReplyTo = original.messageId;
      headers["In-Reply-To"] = original.messageId;
      headers["References"] = original.messageId;
    }
    leadId = leadId ?? original?.leadId ?? null;
    ticketId = ticketId ?? original?.ticketId ?? null;
    // Resposta sai pela mesma conta que recebeu, salvo escolha explícita.
    accountId = accountId ?? original?.accountId ?? null;
  }

  // Resolve a conta: explícita e válida → usa; senão 1ª ativa da empresa.
  let account = accountId
    ? await prisma.emailAccount.findFirst({ where: { id: accountId, companyId, active: true } })
    : null;
  if (!account) {
    account = await prisma.emailAccount.findFirst({
      where: { companyId, active: true },
      orderBy: { createdAt: "asc" },
    });
  }

  // Assinatura da conta anexada ao fim do corpo (texto e HTML).
  const signature = account?.signature?.trim();
  const text = signature ? `${input.text.trim()}\n\n--\n${signature}` : input.text.trim();
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111">${escapeHtml(text).replace(/\n/g, "<br/>")}</div>`;

  // Anexos do upload → formato do nodemailer.
  const mailAttachments = (input.attachments ?? []).map((a) => ({
    filename: a.filename,
    contentType: a.contentType || undefined,
    content: Buffer.from(a.contentBase64, "base64"),
  }));

  let messageId: string | null = null;
  let fromEmail: string;
  let fromName: string;

  if (account) {
    const smtpCfg = decryptedSmtp(account);
    if (!smtpCfg) throw new Error(`Conta ${account.fromEmail}: SMTP incompleto (senha ilegível?)`);
    const t = nodemailer.createTransport({
      host: smtpCfg.host, port: smtpCfg.port, secure: smtpCfg.secure,
      auth: { user: smtpCfg.user, pass: smtpCfg.pass },
    });
    const mailOpts = {
      from: `${account.fromName} <${account.fromEmail}>`,
      to: input.to.trim(),
      cc: input.cc?.trim() || undefined,
      bcc: input.bcc?.trim() || undefined,
      subject: input.subject.trim(),
      html,
      text,
      headers: Object.keys(headers).length ? headers : undefined,
      attachments: mailAttachments.length ? mailAttachments : undefined,
    };
    const info = await t.sendMail(mailOpts);
    messageId = info?.messageId ?? null;
    fromEmail = account.fromEmail;
    fromName = account.fromName;

    // Grava a cópia na pasta Enviados do SERVIDOR (APPEND IMAP). SMTP genérico
    // não faz isso sozinho — sem o append, o webmail não mostra o enviado e o
    // LeadHub não consegue referenciar os anexos. Best-effort: falha não
    // derruba o envio (que já aconteceu).
    if (account.imapHost) {
      try {
        const raw: Buffer = await new Promise((resolve, reject) => {
          new MailComposer({ ...mailOpts, messageId: messageId ?? undefined })
            .compile()
            .build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg)));
        });
        await appendSentCopy(account, raw);
      } catch (e) {
        console.warn(`[imap-inbox] append na pasta Enviados falhou (${account.fromEmail})`, e);
      }
    }
  } else {
    // Fallback: SMTP do Email Marketing (CompanyEmailConfig).
    const sent = await sendCompanyMail(companyId, {
      to: input.to.trim(),
      cc: input.cc?.trim() || undefined,
      bcc: input.bcc?.trim() || undefined,
      subject: input.subject.trim(),
      html,
      text,
      headers: Object.keys(headers).length ? headers : undefined,
      attachments: mailAttachments.length ? mailAttachments : undefined,
    });
    messageId = sent.messageId;
    fromEmail = sent.fromEmail;
    fromName = sent.fromName;
  }

  const record = await prisma.inboxEmail.create({
    data: {
      companyId,
      accountId: account?.id ?? null,
      direction: "OUT",
      folder: "SENT" as InboxEmailFolder,
      messageId,
      fromEmail,
      fromName,
      toEmail: input.to.trim(),
      ccEmail: input.cc?.trim() || null,
      bccEmail: input.bcc?.trim() || null,
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
