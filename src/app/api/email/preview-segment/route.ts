import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { buildLeadWhereFromSegment, sanitizeSegmentFilter } from "@/lib/email-segment";

// POST /api/email/preview-segment  { segmentFilter, companyId? }
// Retorna { count, sample[] } — quantos leads batem no filtro + amostra de 5.
// Usado pela UI ao vivo conforme o usuário mexe nos filtros.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  const body = await req.json();
  const companyId = role === "SUPER_ADMIN"
    ? (body.companyId ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ count: 0, sample: [] });

  const filter = sanitizeSegmentFilter(body.segmentFilter);
  const where = buildLeadWhereFromSegment(companyId, filter);

  // Exclui quem já descadastrou (suppression list)
  const unsubscribed = await prisma.emailUnsubscribe.findMany({
    where: { companyId },
    select: { email: true },
  });
  const suppressedEmails = unsubscribed.map((u) => u.email.toLowerCase());

  const [count, sample] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, phone: true },
    }),
  ]);

  // Estima quantos serão pulados pela suppression (aproximação no count total)
  const suppressedInSegment = suppressedEmails.length > 0
    ? await prisma.lead.count({
        where: { ...where, email: { in: unsubscribed.map((u) => u.email) } },
      })
    : 0;

  return NextResponse.json({
    count,
    deliverable: Math.max(0, count - suppressedInSegment),
    suppressed: suppressedInSegment,
    sample,
  });
}
