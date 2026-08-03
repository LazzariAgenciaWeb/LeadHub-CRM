import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { downloadEmailAttachment } from "@/lib/imap-inbox";

// Tipos seguros pra abrir inline no navegador; o resto força download.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/i;

// GET /api/email/inbox/attachments/[id]
// Baixa o anexo SOB DEMANDA direto do servidor IMAP — nada fica armazenado
// no LeadHub. Requer o email ainda existir na caixa do servidor.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const { id } = await params;

  // Restrição por setor: anexo de caixa não liberada → 404.
  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;
  if (allowed) {
    const att = await prisma.inboxEmailAttachment.findFirst({
      where: { id, email: { companyId } },
      select: { email: { select: { accountId: true } } },
    });
    if (!att?.email.accountId || !allowed.includes(att.email.accountId)) {
      return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
    }
  }

  const result = await downloadEmailAttachment(companyId, id);
  if (!result) {
    return NextResponse.json(
      { error: "Anexo indisponível — o email pode ter sido removido do servidor." },
      { status: 404 }
    );
  }

  const disposition = INLINE_TYPES.test(result.contentType) ? "inline" : "attachment";
  // filename* (RFC 5987) preserva acentos; filename simples como fallback.
  const safeName = result.filename.replace(/["\\\r\n]/g, "_");
  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
