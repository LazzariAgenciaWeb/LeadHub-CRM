import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { loadRelatedEmails } from "@/lib/email-related";
import { groupEmailCopies } from "@/lib/email-group";

// GET /api/email/inbox/[id]/thread → tudo que anda junto com o email, em
// ordem cronológica e só das caixas que o usuário enxerga: a conversa
// (resposta/encaminhamento), as mensagens do mesmo caso (aviso, lembrete,
// fatura do mesmo domínio) e o que foi agrupado à mão. Cada uma vem com o
// motivo, que a tela mostra como etiqueta.
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
  const relacionados = await loadRelatedEmails(companyId, id, allowed);
  if (!relacionados) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });

  // Cópias do mesmo email em caixas diferentes viram uma linha só aqui também.
  const messages = groupEmailCopies(relacionados, 60);
  return NextResponse.json({ messages });
}
