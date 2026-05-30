import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { scrapeSiteEnhanced } from "@/lib/site-scraper";
import { runPageSpeed } from "@/lib/pagespeed";
import { getOpenAIConfig, chatCompletion } from "@/lib/openai";

export type DiagnosisPoint = {
  title: string;
  detail: string;
};

export type Diagnosis = {
  summary: string;
  positives: DiagnosisPoint[];
  opportunities: DiagnosisPoint[];
  criticals: DiagnosisPoint[];
  sourceData: Record<string, any>;
};

const SYSTEM_PROMPT = `Você é um consultor de marketing digital sênior brasileiro. Sua tarefa é avaliar a presença digital de uma empresa e identificar oportunidades concretas de melhoria.

REGRAS:
- Responda APENAS em JSON válido, sem markdown, sem texto antes/depois.
- Português do Brasil, tom consultivo e respeitoso (não soberba).
- Seja específico: cite o dado real que viu (ex: "site demora 8s pra carregar no mobile", não "site lento").
- Se um dado não foi coletado, NÃO mencione (ex: não fale de PageSpeed se ele falhou).
- Pontos críticos = quick wins de fato (ajustáveis em horas, alto impacto), não problemas estratégicos longos.
- Se não tiver dados suficientes pra uma seção, deixe ela com lista vazia.

FORMATO DE SAÍDA (JSON estrito):
{
  "summary": "string — 1 frase resumindo o estado geral",
  "positives":     [{"title": "Título curto", "detail": "Frase explicativa específica"}],
  "opportunities": [{"title": "...", "detail": "..."}],
  "criticals":     [{"title": "...", "detail": "..."}]
}

Idealmente 2-4 itens por categoria.`;

function buildWebsitePrompt(lead: { name: string | null; segment: string | null; city: string | null }, scraped: any, pagespeed: any): string {
  return `Analise esta empresa:

NOME: ${lead.name ?? "(sem nome)"}
SEGMENTO: ${lead.segment ?? "(não informado)"}
CIDADE: ${lead.city ?? "(não informada)"}

DADOS DO SITE (${scraped.url}):
- Title: ${scraped.title ?? "(vazio)"}
- Meta description: ${scraped.metaDescription ?? "(vazio)"}
- Primeiro H1: ${scraped.firstH1 ?? "(vazio)"}
- Tem meta viewport (mobile): ${scraped.hasViewport ? "sim" : "NÃO"}
- Tem favicon: ${scraped.hasFavicon ? "sim" : "não"}
- Tem Schema.org / dados estruturados: ${scraped.hasSchemaOrg ? "sim" : "não"}
- Tem Open Graph (compartilhamento social): ${scraped.hasOpenGraph ? "sim" : "não"}
- Imagens: ${scraped.imageCount} total, ${scraped.imagesWithoutAlt} sem ALT (acessibilidade/SEO)
- Idioma declarado: ${scraped.language ?? "(não declarado)"}
- Email visível: ${scraped.email ?? "não encontrado"}
- Instagram: ${scraped.instagram ?? "não encontrado"}
- Facebook: ${scraped.facebook ?? "não encontrado"}
- Link WhatsApp (wa.me) no site: ${scraped.hasWhatsappLink ? "sim" : "NÃO"}
- Tem seção/menção de "contato": ${scraped.hasContactSection ? "sim" : "não"}
- Telefone visível no corpo: ${scraped.hasPhoneVisible ? "sim" : "não"}

AMOSTRA DE CONTEÚDO DO SITE (primeiros 800 chars):
"""
${scraped.bodyTextSample ?? "(não capturado)"}
"""

${pagespeed?.fetched ? `PERFORMANCE MOBILE (Google PageSpeed):
- Score performance: ${pagespeed.performanceScore}/100
- LCP (Largest Contentful Paint): ${pagespeed.lcpMs ? (pagespeed.lcpMs / 1000).toFixed(1) + "s" : "n/a"}
- CLS (Cumulative Layout Shift): ${pagespeed.cls ?? "n/a"}
- FCP: ${pagespeed.fcpMs ? (pagespeed.fcpMs / 1000).toFixed(1) + "s" : "n/a"}
- Mobile friendly: ${pagespeed.mobileFriendly ? "sim" : "não"}` : "PERFORMANCE MOBILE: dados não disponíveis (PageSpeed falhou ou não rodou)"}

Gere o diagnóstico em JSON.`;
}

function buildInstagramOnlyPrompt(lead: { name: string | null; segment: string | null; city: string | null; instagram: string | null }): string {
  return `Analise esta empresa:

NOME: ${lead.name ?? "(sem nome)"}
SEGMENTO: ${lead.segment ?? "(não informado)"}
CIDADE: ${lead.city ?? "(não informada)"}
INSTAGRAM: ${lead.instagram}

ATENÇÃO: esta empresa NÃO tem site. Análise será LIMITADA — baseada em boas práticas pro segmento e nome.

Gere um diagnóstico cuidadoso onde:
- "positives": fatos prováveis dado o segmento (NÃO invente — fale do potencial)
- "opportunities": o que costuma faltar em quem só tem Instagram (site, agendamento online, Google Meu Negócio, etc)
- "criticals": riscos de ter SÓ Instagram como presença (Meta pode banir, sem SEO, sem credibilidade visível). 1-2 críticos máximo.
- "summary": sinalize que é análise limitada.

JSON estrito.`;
}

function parseDiagnosisJSON(raw: string): Diagnosis | null {
  // Tenta extrair JSON mesmo se o modelo envolveu em markdown
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    const data = JSON.parse(cleaned);
    if (typeof data !== "object" || !data) return null;
    return {
      summary: String(data.summary ?? "").slice(0, 500),
      positives: Array.isArray(data.positives) ? data.positives.slice(0, 6).map(normalizePoint) : [],
      opportunities: Array.isArray(data.opportunities) ? data.opportunities.slice(0, 6).map(normalizePoint) : [],
      criticals: Array.isArray(data.criticals) ? data.criticals.slice(0, 6).map(normalizePoint) : [],
      sourceData: {},
    };
  } catch {
    return null;
  }
}

function normalizePoint(p: any): DiagnosisPoint {
  return {
    title: String(p?.title ?? p?.point ?? "").slice(0, 100),
    detail: String(p?.detail ?? p?.description ?? "").slice(0, 400),
  };
}

// POST /api/prospeccao/diagnose
// Body: { leadId: string }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const body = await req.json().catch(() => ({}));
  const leadId = String(body.leadId ?? "").trim();
  if (!leadId) {
    return NextResponse.json({ error: "leadId é obrigatório" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }
  if (userRole !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Decidir modo
  const hasSite = !!lead.website && /^https?:\/\//i.test(lead.website);
  const hasInsta = !!lead.instagram;

  if (!hasSite && !hasInsta) {
    const diagnosis: Diagnosis = {
      summary: "Sem dados suficientes para diagnóstico — prospect sem site e sem Instagram cadastrado.",
      positives: [],
      opportunities: [
        { title: "Cadastrar site e redes sociais", detail: "Esta empresa não tem presença digital identificada. Primeira recomendação: criar site institucional simples e perfis em Instagram + Google Meu Negócio." },
      ],
      criticals: [],
      sourceData: {},
    };
    const tokenUpdate = lead.diagnosisToken ? {} : { diagnosisToken: randomUUID() };
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        diagnosis: diagnosis as any,
        diagnosisAt: new Date(),
        diagnosisSource: "none",
        ...tokenUpdate,
      },
    });
    return NextResponse.json({ ok: true, source: "none", diagnosis });
  }

  const openai = await getOpenAIConfig();
  if (!openai) {
    return NextResponse.json(
      { error: "OpenAI não configurada (Configurações → Integrações → OpenAI)" },
      { status: 400 }
    );
  }

  let mode: "website" | "instagram";
  let prompt: string;
  let sourceData: Record<string, any> = {};

  if (hasSite) {
    mode = "website";
    const [scraped, pagespeed] = await Promise.all([
      scrapeSiteEnhanced(lead.website!),
      runPageSpeed(lead.website!),
    ]);
    sourceData = {
      site: {
        url: scraped.url,
        title: scraped.title,
        metaDescription: scraped.metaDescription,
        firstH1: scraped.firstH1,
        hasViewport: scraped.hasViewport,
        hasFavicon: scraped.hasFavicon,
        hasSchemaOrg: scraped.hasSchemaOrg,
        hasOpenGraph: scraped.hasOpenGraph,
        imageCount: scraped.imageCount,
        imagesWithoutAlt: scraped.imagesWithoutAlt,
        hasWhatsappLink: scraped.hasWhatsappLink,
        hasContactSection: scraped.hasContactSection,
        hasPhoneVisible: scraped.hasPhoneVisible,
      },
      pageSpeed: pagespeed.fetched
        ? {
            score: pagespeed.performanceScore,
            lcpMs: pagespeed.lcpMs,
            cls: pagespeed.cls,
            mobileFriendly: pagespeed.mobileFriendly,
            summary: pagespeed.summary,
          }
        : { fetched: false, summary: pagespeed.summary },
    };
    prompt = buildWebsitePrompt(
      { name: lead.name, segment: lead.segment, city: lead.city },
      scraped,
      pagespeed
    );
  } else {
    mode = "instagram";
    sourceData = { instagram: lead.instagram };
    prompt = buildInstagramOnlyPrompt({
      name: lead.name,
      segment: lead.segment,
      city: lead.city,
      instagram: lead.instagram!,
    });
  }

  const raw = await chatCompletion(
    openai,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    { maxTokens: 900, temperature: 0.4 }
  );

  if (!raw) {
    return NextResponse.json({ error: "Falha na OpenAI" }, { status: 502 });
  }

  const parsed = parseDiagnosisJSON(raw);
  if (!parsed) {
    return NextResponse.json(
      { error: "OpenAI retornou resposta em formato inesperado", raw: raw.slice(0, 200) },
      { status: 502 }
    );
  }

  const diagnosis: Diagnosis = { ...parsed, sourceData };
  const tokenUpdate = lead.diagnosisToken ? {} : { diagnosisToken: randomUUID() };

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      diagnosis: diagnosis as any,
      diagnosisAt: new Date(),
      diagnosisSource: mode,
      ...tokenUpdate,
    },
    select: { diagnosisToken: true },
  });

  return NextResponse.json({
    ok: true,
    source: mode,
    diagnosis,
    token: updated.diagnosisToken,
  });
}
