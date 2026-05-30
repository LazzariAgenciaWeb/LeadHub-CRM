import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionCheckWhatsappNumbers } from "@/lib/evolution";

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

  // Validação WhatsApp via Evolution: bate em /chat/whatsappNumbers usando a
  // primeira instância CONNECTED da empresa. Se a empresa não tem instância
  // ou Evolution falha, hasWhatsappMap fica vazio e gravamos NULL (não-validado).
  const instance = await prisma.whatsappInstance.findFirst({
    where: { companyId: effectiveCompanyId, status: "CONNECTED" },
    select: { instanceName: true, instanceToken: true },
  });
  const phonesToCheck = enriched
    .map((p) => p.phoneDigits)
    .filter((p): p is string => !!p);
  const hasWhatsappMap = instance && phonesToCheck.length > 0
    ? await evolutionCheckWhatsappNumbers(instance.instanceName, phonesToCheck, instance.instanceToken).catch(() => new Map<string, boolean>())
    : new Map<string, boolean>();

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

      // Validação WhatsApp: se Evolution respondeu, usa o resultado real;
      // se não respondeu (sem instância CONNECTED/falha), fica NULL.
      // hasWhatsappLink (achou wa.me no site) eleva a confiança mas não
      // substitui a checagem real.
      const waValidated = p.phoneDigits ? hasWhatsappMap.get(p.phoneDigits) : undefined;
      const hasWhatsapp: boolean | null = waValidated === undefined
        ? (p.hasWhatsappLink ? true : null) // não validado, mas site tem wa.me → presume true
        : waValidated;

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
          hasWhatsapp,
        },
      });
      imported++;
      if (p.website) withSite++;
      if (p.email) withEmail++;
      // Conta como "com WhatsApp" só quando Evolution confirmou OU site tem
      // wa.me. Não conta NULL (não-validado) nem false (validado e não tem).
      if (hasWhatsapp === true) withWhatsapp++;
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
