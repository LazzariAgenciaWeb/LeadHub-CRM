/**
 * SMTP por empresa — usado pelo módulo de Email Marketing.
 *
 * Diferente do `src/lib/email.ts` (SMTP GLOBAL do sistema, pra 2FA do cofre e
 * convites de portal), aqui cada empresa-cliente configura o próprio servidor.
 * As campanhas saem do email DA EMPRESA, não do Lazzari — melhor deliverability
 * e isolamento de reputação.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "./prisma";
import { encryptSecret, tryDecryptSecret } from "./crypto";

export interface CompanyEmailConfigInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string; // opcional no update (mantém a antiga se vazio)
  fromEmail: string;
  fromName: string;
  /** Opcional. Quando preenchido, vira o header Reply-To. */
  replyTo?: string | null;
}

/** Salva/atualiza a config SMTP da empresa. Senha criptografada em AES-256-GCM. */
export async function upsertCompanyEmailConfig(
  companyId: string,
  input: CompanyEmailConfigInput
) {
  const existing = await prisma.companyEmailConfig.findUnique({ where: { companyId } });

  // Senha: se veio nova, criptografa; senão mantém a existente.
  let passEnc = existing?.passEnc ?? "";
  if (input.pass && input.pass.trim()) {
    passEnc = encryptSecret(input.pass.trim());
  }
  if (!passEnc) throw new Error("Senha SMTP obrigatória na primeira configuração");

  const replyTo = input.replyTo?.trim() || null;
  return prisma.companyEmailConfig.upsert({
    where: { companyId },
    create: {
      companyId,
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      user: input.user.trim(),
      passEnc,
      fromEmail: input.fromEmail.trim(),
      fromName: input.fromName.trim(),
      replyTo,
    },
    update: {
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      user: input.user.trim(),
      passEnc,
      fromEmail: input.fromEmail.trim(),
      fromName: input.fromName.trim(),
      replyTo,
      // Reset de verificação: mudou config → precisa testar de novo
      verified: false,
      lastError: null,
    },
  });
}

interface ResolvedCompanySmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
}

/** Lê + descriptografa a config da empresa. null se não configurada. */
export async function getCompanyEmailConfig(companyId: string): Promise<ResolvedCompanySmtp | null> {
  const cfg = await prisma.companyEmailConfig.findUnique({ where: { companyId } });
  if (!cfg) return null;
  const pass = tryDecryptSecret(cfg.passEnc) ?? "";
  if (!cfg.host || !cfg.user || !pass) return null;
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    pass,
    fromEmail: cfg.fromEmail,
    fromName: cfg.fromName,
    replyTo: cfg.replyTo ?? null,
  };
}

/** Cria transporter pra empresa (sem cache — campanhas são esporádicas). */
function buildTransporter(cfg: ResolvedCompanySmtp): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

/** Testa conexão SMTP da empresa. Atualiza verified/lastError. */
export async function verifyCompanyEmail(companyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await getCompanyEmailConfig(companyId);
  if (!cfg) return { ok: false, error: "SMTP não configurado" };
  try {
    const t = buildTransporter(cfg);
    await t.verify();
    await prisma.companyEmailConfig.update({
      where: { companyId },
      data: { verified: true, lastVerifiedAt: new Date(), lastError: null },
    });
    return { ok: true };
  } catch (e: any) {
    const error = e?.message ?? "Falha ao conectar";
    await prisma.companyEmailConfig.update({
      where: { companyId },
      data: { verified: false, lastError: error },
    }).catch(() => null);
    return { ok: false, error };
  }
}

/** Envia 1 email pela conta da empresa. Lança em erro (worker captura). */
export async function sendCompanyMail(
  companyId: string,
  opts: {
    to: string; subject: string; html: string; text?: string;
    headers?: Record<string, string>;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
  }
): Promise<{ messageId: string | null; fromEmail: string; fromName: string }> {
  const cfg = await getCompanyEmailConfig(companyId);
  if (!cfg) throw new Error("SMTP da empresa não configurado");
  const t = buildTransporter(cfg);
  const info = await t.sendMail({
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    headers: opts.headers,
    attachments: opts.attachments,
  });
  return { messageId: info?.messageId ?? null, fromEmail: cfg.fromEmail, fromName: cfg.fromName };
}
