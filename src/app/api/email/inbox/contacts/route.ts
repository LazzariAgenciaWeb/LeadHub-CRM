import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { JANELA_HISTORICO, mergeContacts } from "@/lib/email-contacts";

/**
 * GET /api/email/inbox/contacts?q=  → sugestões de destinatário.
 *
 * Junta quatro origens, do mais provável pro menos: quem você já enviou,
 * clientes cadastrados, leads com email e quem te escreveu. O histórico
 * respeita a restrição de caixas por setor; Spam e Lixeira ficam de fora
 * (não faz sentido sugerir quem você bloqueou).
 */
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ contacts: [] });

  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;
  if (allowed && allowed.length === 0) return NextResponse.json({ contacts: [] });
  const accountScope = allowed ? { accountId: { in: allowed } } : {};

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const like = { contains: q, mode: "insensitive" as const };

  const [enviados, recebidos, clientes, leads] = await Promise.all([
    prisma.inboxEmail.findMany({
      where: {
        companyId, direction: "OUT", ...accountScope,
        ...(q ? { OR: [{ toEmail: like }, { ccEmail: like }] } : {}),
      },
      select: { toEmail: true, ccEmail: true },
      orderBy: { sentAt: "desc" },
      take: JANELA_HISTORICO,
    }),
    prisma.inboxEmail.findMany({
      where: {
        companyId, direction: "IN", suspicious: false,
        folder: { notIn: ["SPAM", "TRASH"] }, ...accountScope,
        ...(q ? { OR: [{ fromEmail: like }, { fromName: like }] } : {}),
      },
      select: { fromEmail: true, fromName: true },
      orderBy: { sentAt: "desc" },
      take: JANELA_HISTORICO,
    }),
    // Clientes da agência (sub-empresas) com email cadastrado.
    prisma.company.findMany({
      where: {
        parentCompanyId: companyId, email: { not: null },
        ...(q ? { OR: [{ email: like }, { name: like }] } : {}),
      },
      select: { name: true, email: true },
      orderBy: { name: "asc" },
      take: 50,
    }),
    prisma.lead.findMany({
      where: {
        companyId, email: { not: null },
        ...(q ? { OR: [{ email: like }, { name: like }] } : {}),
      },
      select: { name: true, email: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);

  const contacts = mergeContacts({ enviados, recebidos, clientes, leads }, q);

  return NextResponse.json({ contacts });
}
