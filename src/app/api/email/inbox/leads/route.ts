import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

// GET /api/email/inbox/leads?q=&take=
// Busca enxuta de leads/oportunidades da empresa pra vincular a um email
// (seletor do leitor da caixa). Não é a listagem do CRM: devolve só o que
// o seletor mostra e no máximo 15 linhas.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const take = Math.min(Math.max(parseInt(searchParams.get("take") ?? "15") || 15, 1), 30);

  const where: Prisma.LeadWhereInput = { companyId };
  // Lead interno é coisa da Lazzari — não aparece pro cliente.
  if ((session.user as any).role !== "SUPER_ADMIN") where.isInternal = false;
  if (q) {
    const ci = "insensitive" as const;
    where.OR = [
      { name: { contains: q, mode: ci } },
      { email: { contains: q, mode: ci } },
      { phone: { contains: q } },
    ];
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true, name: true, email: true, phone: true,
      pipeline: true, pipelineStage: true, value: true, updatedAt: true,
    },
  });

  return NextResponse.json({ leads });
}
