import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { linkEmailsByAddress } from "@/lib/lead-email-link";

/**
 * POST /api/leads/[id]/link-emails  { address? }
 *
 * Vincula ao lead todos os emails SEM vínculo trocados com `address`
 * (default: o email cadastrado no lead). Emails avulsos são vinculados um a
 * um pelo PATCH /api/email/inbox/[id] { leadId }, que já respeita as caixas
 * que o usuário pode ver e propaga pras cópias do mesmo email.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, email: true, companyId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  if (role !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const address = (typeof body.address === "string" && body.address.trim()) || lead.email;
  if (!address) {
    return NextResponse.json({ error: "Informe um endereço de email" }, { status: 400 });
  }

  const linked = await linkEmailsByAddress(lead.companyId, lead.id, address);
  return NextResponse.json({ ok: true, linked });
}
