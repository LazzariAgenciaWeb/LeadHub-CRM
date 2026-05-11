import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Prospect = {
  placeId?: string | null;
  name?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  type?: string | null;
  city?: string | null;
};

// Regex pra extrair contatos do HTML do site. Conservadoras pra evitar
// falso positivo (ex: "wixstudio.com" sendo lido como email).
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const INSTAGRAM_RE = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/i;
const FACEBOOK_RE = /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9_.\-]+)/i;
const WHATSAPP_RE = /https?:\/\/(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/[^\s"'<>]+/i;
// Emails de plataformas/CDN/imagens que não são de contato real.
const EMAIL_BLOCKLIST = /@(sentry\.io|wixpress\.com|wix\.com|cloudflare|googleapis|gstatic|example\.com|sentry-next\.wixpress)/i;

function extractContacts(html: string) {
  const emailMatches = html.match(EMAIL_RE) ?? [];
  const email =
    emailMatches.find((e) => !EMAIL_BLOCKLIST.test(e)) ?? null;

  const ig = html.match(INSTAGRAM_RE);
  const fb = html.match(FACEBOOK_RE);
  const wa = html.match(WHATSAPP_RE);

  return {
    email: email?.toLowerCase() ?? null,
    instagram: ig ? `https://instagram.com/${ig[1]}` : null,
    facebook: fb ? `https://facebook.com/${fb[1]}` : null,
    hasWhatsappLink: !!wa,
  };
}

async function scrapeSite(url: string, timeoutMs = 6000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadHubProspector/1.0; +https://leadhub.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    // Limita pra não estourar memória em sites muito grandes.
    return extractContacts(html.slice(0, 500_000));
  } catch {
    return null;
  }
}

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits;
}

function pickCity(address?: string | null, fallback?: string | null): string | null {
  if (fallback) return fallback;
  if (!address) return null;
  // Heurística: pega o penúltimo segmento ("Rua X, 123 - Bairro, Cidade - UF, CEP")
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 2];
    // remove " - UF" no final
    return candidate.replace(/\s*-\s*[A-Z]{2}\s*$/, "").trim() || null;
  }
  return null;
}

// POST /api/prospeccao/import
// Body: { prospects: Prospect[], companyId?: string, defaultCity?: string }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const body = await req.json().catch(() => ({}));
  const prospects: Prospect[] = Array.isArray(body.prospects) ? body.prospects : [];
  const requestedCompanyId = body.companyId as string | undefined;
  const defaultCity = (body.defaultCity as string | undefined)?.trim() || null;

  if (prospects.length === 0) {
    return NextResponse.json({ error: "Nenhum prospect selecionado" }, { status: 400 });
  }
  if (prospects.length > 100) {
    return NextResponse.json({ error: "Máximo de 100 prospects por importação" }, { status: 400 });
  }

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? requestedCompanyId : userCompanyId;
  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
  }

  // Etapa inicial do pipeline PROSPECCAO (primeira na ordem)
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId: effectiveCompanyId, pipeline: "PROSPECCAO" },
    orderBy: { order: "asc" },
  });
  const initialStage = firstStage?.name ?? null;

  // Scraping em paralelo (com pequena janela pra não sobrecarregar).
  const CONCURRENCY = 6;
  const enriched: Array<Prospect & ReturnType<typeof extractContacts> & { phoneDigits: string | null }> = [];
  for (let i = 0; i < prospects.length; i += CONCURRENCY) {
    const slice = prospects.slice(i, i + CONCURRENCY);
    const out = await Promise.all(
      slice.map(async (p) => {
        const phoneDigits = normalizePhone(p.phone);
        const scraped = p.website
          ? await scrapeSite(p.website).catch(() => null)
          : null;
        return {
          ...p,
          phoneDigits,
          email: scraped?.email ?? null,
          instagram: scraped?.instagram ?? null,
          facebook: scraped?.facebook ?? null,
          hasWhatsappLink: scraped?.hasWhatsappLink ?? false,
        };
      })
    );
    enriched.push(...out);
  }

  let imported = 0;
  let duplicates = 0;
  let withSite = 0;
  let withEmail = 0;
  let withWhatsapp = 0;
  const errors: string[] = [];

  for (const p of enriched) {
    try {
      if (!p.phoneDigits) {
        // Sem telefone não dá pra usar como WhatsApp; ainda assim importa
        // com placeholder pra não perder o registro. Telefone fica vazio.
      }

      // Dedup: por placeId (externalId) ou por (phone+company)
      const dedupChecks: any[] = [];
      if (p.placeId) dedupChecks.push({ externalId: p.placeId, companyId: effectiveCompanyId });
      if (p.phoneDigits) dedupChecks.push({ phone: p.phoneDigits, companyId: effectiveCompanyId });
      const exists = dedupChecks.length > 0
        ? await prisma.lead.findFirst({ where: { OR: dedupChecks } })
        : null;
      if (exists) {
        duplicates++;
        continue;
      }

      const city = pickCity(p.address, defaultCity);

      await prisma.lead.create({
        data: {
          name: p.name ?? null,
          phone: p.phoneDigits ?? "",
          email: p.email ?? null,
          source: "SerpAPI",
          notes: `Prospect importado via SerpAPI/Google Maps${p.placeId ? ` · place_id=${p.placeId}` : ""}`,
          companyId: effectiveCompanyId,
          pipeline: "PROSPECCAO",
          pipelineStage: initialStage,
          externalId: p.placeId ?? null,
          website: p.website ?? null,
          instagram: p.instagram ?? null,
          facebook: p.facebook ?? null,
          address: p.address ?? null,
          city,
          segment: p.type ?? null,
        },
      });
      imported++;
      if (p.website) withSite++;
      if (p.email) withEmail++;
      // Considera "tem WhatsApp" se: existe telefone (assumimos número de Maps = WhatsApp)
      // OU se achou link wa.me/api.whatsapp no site.
      if (p.phoneDigits || p.hasWhatsappLink) withWhatsapp++;
    } catch (err: any) {
      errors.push(`${p.name ?? p.placeId ?? "?"}: ${err?.message ?? "erro"}`);
    }
  }

  return NextResponse.json({
    imported,
    duplicates,
    withSite,
    withEmail,
    withWhatsapp,
    total: prospects.length,
    errors: errors.slice(0, 10),
  });
}
