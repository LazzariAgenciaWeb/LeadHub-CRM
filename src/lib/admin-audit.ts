/**
 * admin-audit.ts
 *
 * Helper centralizado para gravar AdminAuditLog. Usado em ações sensíveis
 * executadas por SUPER_ADMIN/ADMIN (impersonation, override de plano, etc.).
 *
 * Fire-and-forget: nunca derruba a request principal se o log falhar.
 */

import { prisma } from "./prisma";

export type AdminAuditAction =
  | "IMPERSONATE_START"
  | "IMPERSONATE_END"
  | "PLAN_OVERRIDE"
  | "MODULE_TOGGLE"
  | "USER_PASSWORD_RESET"
  | "USER_DELETE"
  | "COMPANY_DELETE";

interface RecordAdminActionInput {
  adminUserId: string;
  adminUserName?: string | null;
  adminUserEmail?: string | null;
  action: AdminAuditAction;
  targetCompanyId?: string | null;
  targetUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAdminAction(input: RecordAdminActionInput): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId:    input.adminUserId,
        adminUserName:  input.adminUserName ?? null,
        adminUserEmail: input.adminUserEmail ?? null,
        action:         input.action,
        targetCompanyId: input.targetCompanyId ?? null,
        targetUserId:   input.targetUserId ?? null,
        ip:             input.ip ?? null,
        userAgent:      input.userAgent ?? null,
        metadata:       input.metadata ?? undefined,
      },
    });
  } catch (err) {
    console.warn("[AdminAudit] Falha ao gravar log:", err);
  }
}

/** Extrai IP do request respeitando proxies (cPanel/Railway/Vercel). */
export function extractIp(req: { headers: Headers }): string | null {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    null
  );
}
