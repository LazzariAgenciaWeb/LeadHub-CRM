/**
 * Helper de envio de e-mails via SMTP.
 *
 * Configuração:
 *   1ª prioridade: tabela Setting (chaves smtp.*) — editado via UI em /configuracoes
 *   2ª prioridade: variáveis de ambiente (SMTP_HOST, SMTP_USER, SMTP_PASS, etc.)
 *      — usadas como bootstrap quando o banco ainda não tem config
 *
 * Senha SMTP é guardada criptografada (AES-256-GCM via crypto.ts) na chave
 * "smtp.passEnc". Outras chaves ficam em texto claro porque são metadados.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "./prisma";
import { tryDecryptSecret } from "./crypto";

let cached: { transport: Transporter; signature: string } | null = null;

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  configured: boolean;
}

/** Lê a config SMTP — banco primeiro, env como fallback. */
export async function getSmtpConfig(): Promise<SmtpConfig> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: "smtp." } },
    select: { key: true, value: true },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const fromDb = !!map["smtp.host"];
  if (fromDb) {
    const passEnc = map["smtp.passEnc"];
    const pass = passEnc ? (tryDecryptSecret(passEnc) ?? "") : "";
    return {
      host:   map["smtp.host"],
      port:   parseInt(map["smtp.port"] || "465", 10),
      secure: (map["smtp.secure"] ?? "true") === "true",
      user:   map["smtp.user"] || "",
      pass,
      from:   map["smtp.from"] || `LeadHub <${map["smtp.user"] || ""}>`,
      configured: !!(map["smtp.host"] && map["smtp.user"] && pass),
    };
  }

  // Fallback env (bootstrap quando banco não tem)
  const host = process.env.SMTP_HOST || "";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  return {
    host,
    port:   parseInt(process.env.SMTP_PORT || "465", 10),
    secure: (process.env.SMTP_SECURE ?? "true").toLowerCase() === "true",
    user,
    pass,
    from:   process.env.SMTP_FROM || (user ? `LeadHub <${user}>` : ""),
    configured: !!(host && user && pass),
  };
}

/** Reusa o Transporter quando a config não mudou (cache simples por hash). */
async function getTransporter(): Promise<Transporter> {
  const cfg = await getSmtpConfig();
  if (!cfg.configured) {
    throw new Error("SMTP não configurado. Vá em Configurações → E-mail (SMTP) e preencha.");
  }
  const sig = `${cfg.host}|${cfg.port}|${cfg.secure}|${cfg.user}|${cfg.pass.length}`;
  if (cached && cached.signature === sig) return cached.transport;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  cached = { transport, signature: sig };
  return transport;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const cfg = await getSmtpConfig();
  const transport = await getTransporter();
  await transport.sendMail({
    from: cfg.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? opts.html.replace(/<[^>]+>/g, ""),
  });
}

/** Testa o SMTP — usado pelo botão "Testar conexão" da UI. */
export async function verifySmtp(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const transport = await getTransporter();
    await transport.verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Erro desconhecido" };
  }
}

/** Limpa o cache do Transporter — usar após editar config via UI. */
export function resetSmtpCache(): void {
  cached = null;
}

/** Template HTML para o código de verificação do cofre. */
export function vaultChallengeEmail(opts: {
  recipientName: string;
  code: string;
  credentialName?: string;
  expiresInMinutes: number;
}): { subject: string; html: string; text: string } {
  const credLine = opts.credentialName
    ? `<p style="margin:8px 0;color:#94a3b8;font-size:13px">Credencial: <strong style="color:#e2e8f0">${opts.credentialName}</strong></p>`
    : "";

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:32px 16px;background:#0a0e16;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:480px;width:100%;background:#0f1623;border:1px solid #1e2d45;border-radius:16px;overflow:hidden">
      <tr><td style="padding:24px 28px 8px">
        <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);width:32px;height:32px;border-radius:9px;text-align:center;line-height:32px;color:#fff;font-weight:700">⚡</div>
        <span style="margin-left:10px;color:#fff;font-weight:700;font-size:16px;vertical-align:middle">LeadHub</span>
      </td></tr>
      <tr><td style="padding:8px 28px 0">
        <p style="margin:0;color:#64748b;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600">Cofre · Verificação</p>
        <h1 style="margin:8px 0 4px;color:#fff;font-size:20px;font-weight:700">Olá, ${opts.recipientName}</h1>
        <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.5">Você solicitou ver uma senha do cofre. Use o código abaixo pra confirmar.</p>
        ${credLine}
      </td></tr>
      <tr><td style="padding:24px 28px">
        <div style="background:#080b12;border:1px solid #1e2d45;border-radius:12px;padding:20px;text-align:center">
          <p style="margin:0 0 8px;color:#64748b;font-size:11px;letter-spacing:1px;text-transform:uppercase">Seu código</p>
          <p style="margin:0;color:#fff;font-size:36px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,monospace">${opts.code}</p>
          <p style="margin:8px 0 0;color:#64748b;font-size:11px">Válido por ${opts.expiresInMinutes} minutos</p>
        </div>
      </td></tr>
      <tr><td style="padding:0 28px 28px">
        <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6">
          Não foi você? Ignore este e-mail. O código expira em ${opts.expiresInMinutes} min e cada acesso ao cofre é registrado em log de auditoria.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = `LeadHub · Cofre

Olá, ${opts.recipientName}

Seu código de verificação: ${opts.code}
Válido por ${opts.expiresInMinutes} minutos.

Se não foi você, ignore este e-mail.`;

  return {
    subject: `[LeadHub] Código de acesso ao cofre: ${opts.code}`,
    html,
    text,
  };
}
