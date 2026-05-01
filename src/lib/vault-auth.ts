import { getEffectiveSession } from "./effective-session";
import { prisma } from "./prisma";

/**
 * Regras de acesso ao Cofre:
 *  - SUPER_ADMIN: acesso a qualquer empresa.
 *  - ADMIN da empresa-pai: acesso a sub-empresas que ele gerencia (parentCompanyId match).
 *  - ADMIN da própria empresa: acesso ao cofre da empresa dele.
 *  - CLIENT (cliente final): acesso somente leitura ao cofre da própria empresa.
 *  - Demais: negado.
 */

export type VaultAccess =
  | { ok: true; companyId: string; userId: string; userName: string; userRole: string; canWrite: boolean }
  | { ok: false; status: number; error: string };

export async function authorizeVaultAccess(targetCompanyId: string): Promise<VaultAccess> {
  const session = await getEffectiveSession();
  if (!session) return { ok: false, status: 401, error: "Não autenticado" };

  const u: any = session.user;
  const role = u?.role as string | undefined;
  const userId = u?.id as string | undefined;
  const userCompanyId = u?.companyId as string | undefined;

  if (!userId || !role) return { ok: false, status: 401, error: "Sessão inválida" };

  // SUPER_ADMIN passa direto
  if (role === "SUPER_ADMIN") {
    return { ok: true, companyId: targetCompanyId, userId, userName: u.name ?? u.email ?? "?", userRole: role, canWrite: true };
  }

  // Mesma empresa do usuário
  if (userCompanyId === targetCompanyId) {
    if (role === "ADMIN") {
      return { ok: true, companyId: targetCompanyId, userId, userName: u.name ?? u.email ?? "?", userRole: role, canWrite: true };
    }
    if (role === "CLIENT") {
      // Cliente final lê o cofre da empresa dele, sem escrever
      return { ok: true, companyId: targetCompanyId, userId, userName: u.name ?? u.email ?? "?", userRole: role, canWrite: false };
    }
    return { ok: false, status: 403, error: "Sem permissão para o cofre" };
  }

  // ADMIN da empresa-pai pode acessar sub-empresas
  if (role === "ADMIN" && userCompanyId) {
    const sub = await prisma.company.findUnique({
      where: { id: targetCompanyId },
      select: { parentCompanyId: true },
    });
    if (sub?.parentCompanyId === userCompanyId) {
      return { ok: true, companyId: targetCompanyId, userId, userName: u.name ?? u.email ?? "?", userRole: role, canWrite: true };
    }
  }

  return { ok: false, status: 403, error: "Sem acesso a esta empresa" };
}
