import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { loadEmailThread } from "@/lib/email-thread";

// GET /api/email/inbox/[id]/thread → a conversa inteira do email, em ordem
// cronológica (só das caixas que o usuário enxerga).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;
  if (allowed && allowed.length === 0) return NextResponse.json({ messages: [] });

  const { id } = await params;
  const messages = await loadEmailThread(companyId, id, allowed);
  if (!messages) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });

  return NextResponse.json({ messages });
}
