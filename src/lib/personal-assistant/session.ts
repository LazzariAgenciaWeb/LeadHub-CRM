import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveSession } from "@/lib/effective-session";
import { hasModule, can, isSuperAdmin } from "@/lib/permissions";

/**
 * Guarda das rotas do assistente pessoal.
 *
 * O assistente é PESSOAL: age em nome do usuário logado REAL (sessão real,
 * não a impersonada) — o SUPER_ADMIN impersonando a AZZ não vira assistente
 * da AZZ. O gate de módulo/permissão, porém, respeita a sessão efetiva.
 */
export async function requireAssistantUser(): Promise<
  | { ok: true; userId: string; userName: string }
  | { ok: false; response: NextResponse }
> {
  const real = await getServerSession(authOptions);
  if (!real) return { ok: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const eff = (await getEffectiveSession()) ?? real;
  const allowed = isSuperAdmin(real) || (hasModule(eff, "assistentePessoal") && can(eff, "canUseAI"));
  if (!allowed) return { ok: false, response: NextResponse.json({ error: "Assistente pessoal não liberado para a sua empresa" }, { status: 403 }) };
  const userId = (real.user as any)?.id as string | undefined;
  if (!userId) return { ok: false, response: NextResponse.json({ error: "Sessão inválida" }, { status: 401 }) };
  return { ok: true, userId, userName: real.user?.name ?? "Usuário" };
}
