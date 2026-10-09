import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveSession, getActingSession } from "@/lib/effective-session";
import { hasModule, can, isSuperAdmin } from "@/lib/permissions";

/**
 * Guarda das rotas do assistente pessoal.
 *
 * O assistente é PESSOAL: age em nome da identidade em vigor — o usuário
 * logado REAL, ou a conta vinculada quando o SUPER_ADMIN impersona uma
 * empresa onde "ele é" alguém (ex.: Diego da AZZ). Impersonar SEM vínculo não
 * vira assistente da empresa. O gate de módulo/permissão respeita a sessão efetiva.
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
  const acting = (await getActingSession()) ?? real;
  const userId = (acting.user as any)?.id as string | undefined;
  if (!userId) return { ok: false, response: NextResponse.json({ error: "Sessão inválida" }, { status: 401 }) };
  return { ok: true, userId, userName: acting.user?.name ?? "Usuário" };
}
