import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { evolutionCheckWhatsappNumbers } from "@/lib/evolution";
import { scrapeSiteEnhanced } from "@/lib/site-scraper";
import { runPageSpeed } from "@/lib/pagespeed";
import { getOpenAIConfig, chatCompletion } from "@/lib/openai";

// ─────────────────────────────────────────────────────────────────────────
// Botão único inteligente. Recebe a lista de prospects selecionados no modal
// e, pra cada um, decide:
//
//   - Não importado          → IMPORT + DIAGNOSE
//   - Importado sem dados    → ENRICH (preenche email/social/WA NULL) + DIAGNOSE (se ainda não tem)
//   - Importado já completo  → SKIP
//
// Retorna agregado pro toast: { created, enriched, diagnosed, skipped, errors }.
// ─────────────────────────────────────────────────────────────────────────

type Prospect = {
  placeId?: string | null;
  name?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  type?: string | null;
};

const SYSTEM_PROMPT = `Você é um consultor de marketing digital sênior brasileiro. Sua tarefa é avaliar a presença digital de uma empresa e identificar oportunidades concretas de melhoria.

REGRAS:
- Responda APENAS em JSON válido, sem markdown, sem texto antes/depois.
- Português do Brasil, tom consultivo e respeitoso (não soberba).
- Seja específico: cite o dado real que viu.
- Se um dado não foi coletado, NÃO mencione.
- Pontos críticos = quick wins ajustáveis em horas, alto impacto.
- Se não tiver dados suficientes pra uma seção, deixe ela vazia.

FORMATO JSON:
{
  "summary": "string — 1 frase",
  "positives":     [{"title": "...", "detail": "..."}],
  "opportunities": [{"title": "...", "detail": "..."}],
  "criticals":     [{"title": "...", "detail": "..."}]
}

2-4 itens por categoria.`;

function buildSitePrompt(lead: { name: string | null; segment: string | null; city: string | null }, scraped: any, pagespeed: any): string {
  return `Empresa: ${lead.name ?? "?"} | Segmento: ${lead.segment ?? "?"} | Cidade: ${lead.city ?? "?"}

SITE (${scraped.url}):
- Title: ${scraped.title ?? "vazio"} | H1: ${scraped.firstH1 ?? "vazio"}
- Meta description: ${scraped.metaDescription ?? "vazia"}
- Mobile viewport: ${scraped.hasViewport ? "sim" : "NÃO"} | Schema.org: ${scraped.hasSchemaOrg ? "sim" : "não"} | Open Graph: ${scraped.hasOpenGraph ? "sim" : "não"}
- Imagens: ${scraped.imageCount} (${scraped.imagesWithoutAlt} sem ALT)
- WhatsApp link no site: ${scraped.hasWhatsappLink ? "sim" : "NÃO"} | Contato visível: ${scraped.hasContactSection ? "sim" : "não"}

${pagespeed?.fetched ? `PAGESPEED: score ${pagespeed.performanceScore}/100, LCP ${pagespeed.lcpMs ? (pagespeed.lcpMs/1000).toFixed(1) + "s" : "n/a"}, mobile-friendly: ${pagespeed.mobileFriendly}` : "PAGESPEED: indisponível"}

CONTEÚDO (amostra): "${scraped.bodyTextSample?.slice(0, 500) ?? "vazio"}"

Gere o diagnóstico.`;
}

function buildInstaPrompt(lead: { name: string | null; segment: string | null; city: string | null; instagram: string }): string {
  return `Empresa: ${lead.name ?? "?"} | Segmento: ${lead.segment ?? "?"} | Cidade: ${lead.city ?? "?"}
Instagram: ${lead.instagram}

SEM SITE — análise LIMITADA, baseada em boas práticas pro segmento.
- positives: fatos prováveis pelo segmento
- opportunities: o que costuma faltar pra quem só tem Instagram
- criticals: 1-2 riscos de ter SÓ Instagram (sem SEO, sem credibilidade, risco de ban)
- summary: sinalize que é limitada.`;
}

function parseDiag(raw: string) {
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    const d = JSON.parse(cleaned);
    if (typeof d !== "object" || !d) return null;
    const np = (p: any) => ({
      title: String(p?.title ?? "").slice(0, 100),
      detail: String(p?.detail ?? "").slice(0, 400),
    });
    return {
      summary: String(d.summary ?? "").slice(0, 500),
      positives: Array.isArray(d.positives) ? d.positives.slice(0, 6).map(np) : [],
      opportunities: Array.isArray(d.opportunities) ? d.opportunities.slice(0, 6).map(np) : [],
      criticals: Array.isArray(d.criticals) ? d.criticals.slice(0, 6).map(np) : [],
    };
  } catch {
    return null;
  }
}

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

function pickCity(address?: string | null, fallback?: string | null): string | null {
  if (fallback) return fallback;
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2].replace(/\s*-\s*[A-Z]{2}\s*$/, "").trim() || null;
  }
  return null;
}

// POST /api/prospeccao/process
// Body: { prospects: Prospect[], companyId?: string (SUPER_ADMIN), defaultCity?: string }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const body = await req.json().catch(() => ({}));
  const prospects: Prospect[] = Array.isArray(body.prospects) ? body.prospects : [];
  const requestedCompanyId = body.companyId as string | undefined;
  const defaultCity = (body.defaultCity as string | undefined)?.trim() || null;

  if (prospects.length === 0) {
    return NextResponse.json({ error: "Nenhum prospect selecionado" }, { status: 400 });
  }
  if (prospects.length > 60) {
    return NextResponse.json({ error: "Máximo de 60 prospects por processamento" }, { status: 400 });
  }

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? requestedCompanyId : userCompanyId;
  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
  }

  const openai = await getOpenAIConfig();
  // Sem OpenAI: ainda processa import/enrich, só pula diagnose com aviso.
  const openaiAvailable = !!openai;

  const firstStageProspeccao = await prisma.pipelineStageConfig.findFirst({
    where: { companyId: effectiveCompanyId, pipeline: "PROSPECCAO" },
    orderBy: { order: "asc" },
  });
  const initialStage = firstStageProspeccao?.name ?? null;

  // ── 1) Buscar leads existentes pra decidir ação ─────────────────────
  const placeIds = prospects.map((p) => p.placeId).filter(Boolean) as string[];
  const phones = prospects.map((p) => normalizePhone(p.phone)).filter(Boolean) as string[];
  const dedupOr: any[] = [];
  if (placeIds.length > 0) dedupOr.push({ externalId: { in: placeIds } });
  if (phones.length > 0) dedupOr.push({ phone: { in: phones } });
  const existing = dedupOr.length > 0
    ? await prisma.lead.findMany({
        where: { companyId: effectiveCompanyId, OR: dedupOr },
      })
    : [];
  const existingByPlace = new Map(existing.filter((l) => l.externalId).map((l) => [l.externalId!, l]));
  const existingByPhone = new Map(existing.filter((l) => l.phone).map((l) => [l.phone, l]));

  // ── 2) Pegar instância Evolution CONNECTED (única, uma vez) ────────
  const instance = await prisma.whatsappInstance.findFirst({
    where: { companyId: effectiveCompanyId, status: "CONNECTED" },
    select: { instanceName: true, instanceToken: true },
  });

  // ── 3) Pré-scraping em paralelo (limita custo SerpAPI/PageSpeed) ───
  // Faz scraper + pagespeed pra todos que precisarem (novos OU enrich)
  const phonesToValidate = new Set<string>();
  for (const p of prospects) {
    const phoneD = normalizePhone(p.phone);
    if (phoneD) {
      const lead = existingByPlace.get(p.placeId ?? "") || existingByPhone.get(phoneD);
      if (!lead || lead.hasWhatsapp === null) phonesToValidate.add(phoneD);
    }
  }
  const waMap = instance && phonesToValidate.size > 0
    ? await evolutionCheckWhatsappNumbers(
        instance.instanceName,
        Array.from(phonesToValidate),
        instance.instanceToken
      ).catch(() => new Map<string, boolean>())
    : new Map<string, boolean>();

  // ── 4) Processar cada prospect ─────────────────────────────────────
  let created = 0;
  let enriched = 0;
  let diagnosed = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Limita paralelismo geral (scrape + pagespeed + openai por item).
  const CONCURRENCY = 3;
  for (let i = 0; i < prospects.length; i += CONCURRENCY) {
    const batch = prospects.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (p) => {
      try {
        const phoneD = normalizePhone(p.phone);
        const existingLead = existingByPlace.get(p.placeId ?? "") || (phoneD ? existingByPhone.get(phoneD) : undefined);

        // ─── A. Cria do zero ──────────────────────────────────────
        if (!existingLead) {
          // Scrape + WA validation
          const scraped = p.website ? await scrapeSiteEnhanced(p.website).catch(() => null) : null;
          const waValidated = phoneD ? waMap.get(phoneD) : undefined;
          const hasWa: boolean | null = waValidated === undefined
            ? (scraped?.hasWhatsappLink ? true : null)
            : waValidated;

          const city = pickCity(p.address, defaultCity);
          const token = randomUUID();

          // Diagnóstico (se OpenAI disponível e tem dados)
          let diagnosisJson: any = null;
          let diagnosisAt: Date | null = null;
          let diagnosisSource: string | null = null;
          if (openai && (p.website || scraped?.instagram)) {
            const [pagespeed] = await Promise.all([
              p.website ? runPageSpeed(p.website) : Promise.resolve(null),
            ]);
            const prompt = p.website && scraped
              ? buildSitePrompt({ name: p.name ?? null, segment: p.type ?? null, city }, scraped, pagespeed)
              : buildInstaPrompt({ name: p.name ?? null, segment: p.type ?? null, city, instagram: scraped!.instagram! });
            const raw = await chatCompletion(openai, [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ], { maxTokens: 900, temperature: 0.4 });
            const parsed = raw ? parseDiag(raw) : null;
            if (parsed) {
              diagnosisJson = {
                ...parsed,
                sourceData: p.website
                  ? { site: scraped, pageSpeed: pagespeed?.fetched ? pagespeed : null }
                  : { instagram: scraped?.instagram },
              };
              diagnosisAt = new Date();
              diagnosisSource = p.website ? "website" : "instagram";
              diagnosed++;
            }
          }

          await prisma.lead.create({
            data: {
              name: p.name ?? null,
              phone: phoneD ?? "",
              email: scraped?.email ?? null,
              source: "SerpAPI",
              notes: `Prospect importado via SerpAPI/Google Maps${p.placeId ? ` · place_id=${p.placeId}` : ""}`,
              companyId: effectiveCompanyId,
              pipeline: "PROSPECCAO",
              pipelineStage: initialStage,
              externalId: p.placeId ?? null,
              website: p.website ?? null,
              instagram: scraped?.instagram ?? null,
              facebook: scraped?.facebook ?? null,
              address: p.address ?? null,
              city,
              segment: p.type ?? null,
              hasWhatsapp: hasWa,
              diagnosis: diagnosisJson,
              diagnosisAt,
              diagnosisSource,
              diagnosisToken: token,
            },
          });
          created++;
          return;
        }

        // ─── B. Já existe — decidir entre enrich / diagnose / skip ─
        const needsEnrich =
          (existingLead.email === null && existingLead.website) ||
          (existingLead.instagram === null && existingLead.website) ||
          (existingLead.facebook === null && existingLead.website) ||
          (existingLead.hasWhatsapp === null && existingLead.phone);

        const needsDiagnose = !existingLead.diagnosisAt && openaiAvailable && (existingLead.website || existingLead.instagram);

        if (!needsEnrich && !needsDiagnose) {
          skipped++;
          return;
        }

        const updateData: any = {};

        // Enrich
        if (needsEnrich) {
          const scraped = existingLead.website
            ? await scrapeSiteEnhanced(existingLead.website).catch(() => null)
            : null;
          if (scraped) {
            if (existingLead.email === null && scraped.email) updateData.email = scraped.email;
            if (existingLead.instagram === null && scraped.instagram) updateData.instagram = scraped.instagram;
            if (existingLead.facebook === null && scraped.facebook) updateData.facebook = scraped.facebook;
          }
          if (existingLead.hasWhatsapp === null && existingLead.phone) {
            const v = waMap.get(existingLead.phone);
            if (v !== undefined) updateData.hasWhatsapp = v;
            else if (scraped?.hasWhatsappLink) updateData.hasWhatsapp = true;
          }
          if (Object.keys(updateData).length > 0) enriched++;
        }

        // Diagnose
        if (needsDiagnose && openai) {
          const scraped = existingLead.website
            ? await scrapeSiteEnhanced(existingLead.website).catch(() => null)
            : null;
          if (existingLead.website && scraped) {
            const pagespeed = await runPageSpeed(existingLead.website);
            const prompt = buildSitePrompt(
              { name: existingLead.name, segment: existingLead.segment, city: existingLead.city },
              scraped,
              pagespeed
            );
            const raw = await chatCompletion(openai, [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ], { maxTokens: 900, temperature: 0.4 });
            const parsed = raw ? parseDiag(raw) : null;
            if (parsed) {
              updateData.diagnosis = { ...parsed, sourceData: { site: scraped, pageSpeed: pagespeed.fetched ? pagespeed : null } };
              updateData.diagnosisAt = new Date();
              updateData.diagnosisSource = "website";
              if (!existingLead.diagnosisToken) updateData.diagnosisToken = randomUUID();
              diagnosed++;
            }
          } else if (existingLead.instagram) {
            const prompt = buildInstaPrompt({
              name: existingLead.name,
              segment: existingLead.segment,
              city: existingLead.city,
              instagram: existingLead.instagram,
            });
            const raw = await chatCompletion(openai, [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ], { maxTokens: 900, temperature: 0.4 });
            const parsed = raw ? parseDiag(raw) : null;
            if (parsed) {
              updateData.diagnosis = { ...parsed, sourceData: { instagram: existingLead.instagram } };
              updateData.diagnosisAt = new Date();
              updateData.diagnosisSource = "instagram";
              if (!existingLead.diagnosisToken) updateData.diagnosisToken = randomUUID();
              diagnosed++;
            }
          }
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.lead.update({ where: { id: existingLead.id }, data: updateData });
        } else {
          skipped++;
        }
      } catch (err: any) {
        errors.push(`${p.name ?? p.placeId ?? "?"}: ${err?.message ?? "erro"}`);
      }
    }));
  }

  return NextResponse.json({
    total: prospects.length,
    created,
    enriched,
    diagnosed,
    skipped,
    errors: errors.slice(0, 10),
    openaiAvailable,
  });
}
