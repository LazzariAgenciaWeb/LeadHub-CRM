import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { getPageMarketingStats } from "@/lib/bio-page-stats";

// GET /api/companies/[id]/pagina-stats?days=30
// Números da Página do Negócio para o relatório de marketing. Quem enxerga a
// empresa (ela mesma, a agência dona, super admin) pode ler. A própria empresa
// vendo os números dela leva o recorte do plano (no grátis, só totais); a
// agência olhando o cliente vê o detalhe. Visualizando como cliente, o super
// admin vê o que o cliente vê.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const session = await getEffectiveSession();
  const days = Math.max(7, Math.min(365, parseInt(req.nextUrl.searchParams.get("days") || "30", 10) || 30));
  const u = session?.user as { role?: string; companyId?: string } | undefined;
  const viewerIsClient = u?.role !== "SUPER_ADMIN" && u?.companyId === companyId;
  // Só o admin da própria empresa monta/edita a página (mesma regra do editor).
  const canEdit = viewerIsClient && u?.role === "ADMIN";
  return NextResponse.json({ ...(await getPageMarketingStats(companyId, days, viewerIsClient)), canEdit });
}
