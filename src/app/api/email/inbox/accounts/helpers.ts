// Helpers compartilhados das rotas de contas de email (não é rota).

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function resolveCompanyId(session: any, explicit?: string | null): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return explicit ?? session.user.companyId ?? null;
  return session.user.companyId ?? null;
}

// Campos públicos da conta — senhas (smtpPassEnc/imapPassEnc) NUNCA saem pela API.
export const ACCOUNT_SELECT = {
  id: true, label: true, fromName: true, fromEmail: true,
  smtpHost: true, smtpPort: true, smtpSecure: true, smtpUser: true,
  imapHost: true, imapPort: true, imapSecure: true, imapUser: true,
  active: true, smtpVerified: true, imapVerified: true,
  lastVerifiedAt: true, lastSyncedAt: true, lastError: true,
} as const;

export function validateAccountBody(body: any, opts: { requireSmtpPass: boolean }): string | null {
  if (!body?.fromName?.trim() || !body?.fromEmail?.trim()) return "Nome e email do remetente são obrigatórios";
  if (!EMAIL_RE.test(body.fromEmail.trim())) return "Email do remetente inválido";
  if (!body?.smtpHost?.trim() || !body?.smtpUser?.trim()) return "Servidor e usuário SMTP são obrigatórios";
  if (opts.requireSmtpPass && !body?.smtpPass?.trim()) return "Senha SMTP obrigatória";
  return null;
}

export function bodyToInput(body: any) {
  return {
    label: body.label ?? null,
    fromName: body.fromName,
    fromEmail: body.fromEmail,
    smtpHost: body.smtpHost,
    smtpPort: parseInt(String(body.smtpPort ?? 465), 10) || 465,
    smtpSecure: body.smtpSecure !== false,
    smtpUser: body.smtpUser,
    smtpPass: body.smtpPass,
    imapHost: body.imapHost ?? null,
    imapPort: parseInt(String(body.imapPort ?? 993), 10) || 993,
    imapSecure: body.imapSecure !== false,
    imapUser: body.imapUser ?? null,
    imapPass: body.imapPass,
    active: body.active !== false,
  };
}
