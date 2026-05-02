import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getRanking } from "@/lib/gamification";

// GET /api/gamificacao/ranking?month=5&year=2026
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole      = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  if (!userCompanyId && userRole !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });
  }

  const companyId = userCompanyId ?? "__none__";

  const sp    = req.nextUrl.searchParams;
  const month = sp.get("month") ? parseInt(sp.get("month")!, 10) : undefined;
  const year  = sp.get("year")  ? parseInt(sp.get("year")!,  10) : undefined;

  const ranking = await getRanking(companyId, month, year);
  return NextResponse.json({ ranking });
}
