import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { findCopyIds } from "@/lib/email-copies";
import { relatedEmailIds } from "@/lib/email-related";

// POST /api/email/inbox/[id]/resolve-case   { folder?: "ARCHIVE" | "TRASH" }
// Resolve a COISA, não a mensagem. Arquiva (ou descarta) de uma vez:
//   · as cópias do email em outras caixas da empresa;
//   · as outras mensagens do mesmo caso — aviso, lembrete, renovação e fatura
//     do mesmo domínio/boleto (ver email-cases.ts);
//   · a conversa: inclui o encaminhamento que você mandou e a resposta de quem
//     resolveu ("está pronto"), porque elas estão no mesmo fio.
// Só mexe no que está em aberto (Entrada/Importante) — não ressuscita nem
// re-arquiva o que já foi tratado.
const ABERTOS = ["INBOX", "IMPORTANT"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;
  if (allowed && allowed.length === 0) {
    return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const destino = body?.folder === "TRASH" ? "TRASH" : "ARCHIVE";

  const accountScope = allowed ? { accountId: { in: allowed } } : {};
  const email = await prisma.inboxEmail.findFirst({
    where: { id, companyId, ...accountScope },
    select: { id: true, fromEmail: true, subject: true, sentAt: true, messageId: true, accountId: true },
  });
  if (!email) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });

  // Uma fonte só pro que anda junto (conversa + caso + agrupado à mão) —
  // a mesma que o painel do leitor mostra, pra tela e ação não discordarem.
  const ids = new Set<string>([email.id, ...(await relatedEmailIds(companyId, email.id, allowed)).keys()]);

  // Cópias do próprio email em outras caixas, inclusive as que este usuário
  // não enxerga: resolveu pra empresa.
  for (const cid of await findCopyIds(companyId, [email])) ids.add(cid);

  // Cópias das mensagens que entraram pelo caso/conversa também vão junto.
  const extras = await prisma.inboxEmail.findMany({
    where: { id: { in: [...ids] }, companyId },
    select: { id: true, fromEmail: true, subject: true, sentAt: true, messageId: true, accountId: true },
  });
  for (const cid of await findCopyIds(companyId, extras)) ids.add(cid);

  const resultado = await prisma.inboxEmail.updateMany({
    where: { id: { in: [...ids] }, companyId, folder: { in: [...ABERTOS] } },
    data: { folder: destino },
  });

  return NextResponse.json({
    ok: true,
    folder: destino,
    resolvidos: resultado.count,
    considerados: ids.size,
  });
}
