import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/prospeccao/search
// Body: { query: string, city?: string, limit?: number, companyId?: string (SUPER_ADMIN) }
// Retorna lista de prospects do Google Maps via SerpAPI. Não salva nada —
// o usuário escolhe quais importar e dispara /api/prospeccao/import.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const body = await req.json().catch(() => ({}));
  const requestedCompanyId = body.companyId as string | undefined;

  // Resolve key: empresa do usuário (ou empresa passada se SUPER_ADMIN) →
  // fallback pra env apenas pro SUPER_ADMIN, pra ele conseguir testar global.
  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? requestedCompanyId : userCompanyId;

  let apiKey: string | null = null;
  if (effectiveCompanyId) {
    const company = await prisma.company.findUnique({
      where: { id: effectiveCompanyId },
      select: { moduleProspeccao: true, serpapiKey: true },
    });
    if (!company) {
      return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
    }
    // Cliente comum: precisa do módulo ligado E da própria key cadastrada.
    if (userRole !== "SUPER_ADMIN" && !company.moduleProspeccao) {
      return NextResponse.json({ error: "Módulo Prospecção não habilitado para esta empresa" }, { status: 403 });
    }
    apiKey = company.serpapiKey ?? null;
  }
  if (!apiKey && userRole === "SUPER_ADMIN") {
    apiKey = process.env.SERPAPI_KEY ?? null;
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: "SerpAPI key não configurada. Configure em Empresas → editar → Prospecção via SerpAPI." },
      { status: 400 }
    );
  }

  const query = String(body.query ?? "").trim();
  const city = String(body.city ?? "").trim();
  const limit = Math.min(Math.max(parseInt(String(body.limit ?? 20)) || 20, 1), 60);
  // SerpAPI Google Maps usa `start` como offset (0, 20, 40…) pra paginar.
  // UI chama com results.length pra próxima página.
  const start = Math.max(parseInt(String(body.start ?? 0)) || 0, 0);

  if (!query) {
    return NextResponse.json({ error: "Informe o nicho/termo de busca" }, { status: 400 });
  }

  // SerpAPI Google Maps engine — `q` aceita "nicho cidade" em texto livre.
  // `type=search` retorna múltiplos locais; ll/coordenadas opcional.
  const fullQuery = city ? `${query} ${city}` : query;
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("q", fullQuery);
  url.searchParams.set("type", "search");
  url.searchParams.set("hl", "pt-br");
  url.searchParams.set("google_domain", "google.com.br");
  if (start > 0) url.searchParams.set("start", String(start));
  url.searchParams.set("api_key", apiKey);

  let data: any;
  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `SerpAPI retornou ${res.status}`, detail: text.slice(0, 200) },
        { status: 502 }
      );
    }
    data = await res.json();
  } catch (err: any) {
    return NextResponse.json(
      { error: "Falha ao consultar SerpAPI", detail: err?.message ?? String(err) },
      { status: 502 }
    );
  }

  if (data?.error) {
    return NextResponse.json({ error: data.error }, { status: 502 });
  }

  const local = Array.isArray(data?.local_results) ? data.local_results : [];
  const results = local.slice(0, limit).map((r: any) => ({
    placeId: r.place_id ?? r.data_id ?? null,
    name: r.title ?? null,
    phone: r.phone ?? null,
    website: r.website ?? null,
    address: r.address ?? null,
    rating: r.rating ?? null,
    reviews: r.reviews ?? null,
    type: r.type ?? null, // segmento principal
    types: r.types ?? null,
    gps: r.gps_coordinates ?? null,
  }));

  // Marca quais resultados já estão no banco — UI mostra tag "Já importado"
  // e libera botão "🔄 Atualizar dados" (precisa do leadId pra chamar /enrich).
  const existingByPlace = new Map<string, string>(); // placeId → leadId
  const existingByPhone = new Map<string, string>(); // phone → leadId
  if (effectiveCompanyId && results.length > 0) {
    const placeIds = results.map((r: any) => r.placeId).filter(Boolean) as string[];
    const phoneDigits = results
      .map((r: any) => (r.phone ? String(r.phone).replace(/\D/g, "") : null))
      .filter((p: string | null): p is string => !!p && p.length >= 8);
    const dedupOr: any[] = [];
    if (placeIds.length > 0) dedupOr.push({ externalId: { in: placeIds } });
    if (phoneDigits.length > 0) dedupOr.push({ phone: { in: phoneDigits } });
    if (dedupOr.length > 0) {
      const existing = await prisma.lead.findMany({
        where: { companyId: effectiveCompanyId, OR: dedupOr },
        select: { id: true, externalId: true, phone: true },
      });
      for (const lead of existing) {
        if (lead.externalId) existingByPlace.set(lead.externalId, lead.id);
        if (lead.phone) existingByPhone.set(lead.phone, lead.id);
      }
    }
  }

  const annotated = results.map((r: any) => {
    const phoneDigits = r.phone ? String(r.phone).replace(/\D/g, "") : null;
    const existingLeadId =
      (r.placeId && existingByPlace.get(r.placeId)) ||
      (phoneDigits && existingByPhone.get(phoneDigits)) ||
      null;
    return { ...r, alreadyImported: !!existingLeadId, existingLeadId };
  });

  // `hasMore` heurístico: SerpAPI retorna 20 por página. Se veio batch cheio,
  // assume que pode ter mais; se veio menos, é o fim. Também respeita
  // `serpapi_pagination.next` quando disponível.
  const hasMore =
    local.length >= 20 ||
    !!data?.serpapi_pagination?.next ||
    !!data?.serpapi_pagination?.next_page_token;
  const nextStart = hasMore ? start + (annotated.length || 20) : null;

  return NextResponse.json({
    query: fullQuery,
    count: annotated.length,
    start,
    nextStart,
    hasMore,
    results: annotated,
  });
}
