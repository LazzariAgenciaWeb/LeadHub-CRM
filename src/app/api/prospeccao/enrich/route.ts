import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionCheckWhatsappNumbers } from "@/lib/evolution";

// Regex compartilhadas com /import — duplicadas aqui pra deixar o endpoint
// auto-contido (se mudar uma, atualize as duas). Pequeno custo de duplicação
// vs criar um lib que ninguém vai achar.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const INSTAGRAM_RE = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/i;
const FACEBOOK_RE = /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9_.\-]+)/i;
const WHATSAPP_RE = /https?:\/\/(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/[^\s"'<>]+/i;
const EMAIL_BLOCKLIST = /@(sentry\.io|wixpress\.com|wix\.com|cloudflare|googleapis|gstatic|example\.com|sentry-next\.wixpress)/i;

function extractContacts(html: string) {
  const emailMatches = html.match(EMAIL_RE) ?? [];
  const email = emailMatches.find((e) => !EMAIL_BLOCKLIST.test(e)) ?? null;
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
        "User-Agent": "Mozilla/5.0 (compatible; LeadHubProspector/1.0; +https://leadhub.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    return extractContacts(html.slice(0, 500_000));
  } catch {
    return null;
  }
}

// POST /api/prospeccao/enrich
// Body: { leadId: string }
// Re-roda scraper no website + valida WhatsApp via Evolution. Preenche
// APENAS campos que estão NULL no Lead — nunca sobrescreve dado existente
// (operador pode ter editado à mão). Retorna lista de campos preenchidos.
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
  // Ownership: ADMIN só pode enriquecer leads da própria empresa.
  if (userRole !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão pra esse lead" }, { status: 403 });
  }

  const filled: string[] = [];
  const update: Record<string, any> = {};

  // 1) Scraper do site (só se tem website e algum campo NULL pra preencher).
  const needsScrape =
    !!lead.website &&
    (lead.email === null || lead.instagram === null || lead.facebook === null);
  let hasWhatsappLink = false;

  if (needsScrape && lead.website) {
    const scraped = await scrapeSite(lead.website);
    if (scraped) {
      hasWhatsappLink = scraped.hasWhatsappLink;
      if (lead.email === null && scraped.email) {
        update.email = scraped.email;
        filled.push("email");
      }
      if (lead.instagram === null && scraped.instagram) {
        update.instagram = scraped.instagram;
        filled.push("instagram");
      }
      if (lead.facebook === null && scraped.facebook) {
        update.facebook = scraped.facebook;
        filled.push("facebook");
      }
    }
  }

  // 2) Validação WhatsApp via Evolution (só se hasWhatsapp ainda é NULL e
  // temos telefone + instância CONNECTED).
  if (lead.hasWhatsapp === null && lead.phone) {
    const instance = await prisma.whatsappInstance.findFirst({
      where: { companyId: lead.companyId, status: "CONNECTED" },
      select: { instanceName: true, instanceToken: true },
    });
    if (instance) {
      const map = await evolutionCheckWhatsappNumbers(
        instance.instanceName,
        [lead.phone],
        instance.instanceToken
      ).catch(() => new Map<string, boolean>());
      const validated = map.get(lead.phone);
      if (validated !== undefined) {
        update.hasWhatsapp = validated;
        filled.push("WhatsApp");
      } else if (hasWhatsappLink) {
        // Fallback: scraper achou wa.me. Não é tão confiável quanto a
        // validação real, mas é melhor que NULL.
        update.hasWhatsapp = true;
        filled.push("WhatsApp (via site)");
      }
    } else if (hasWhatsappLink) {
      update.hasWhatsapp = true;
      filled.push("WhatsApp (via site)");
    }
  }

  if (filled.length === 0) {
    return NextResponse.json({
      filled: [],
      message: "Nenhum dado novo encontrado — todos os campos já estavam preenchidos ou o site não retornou contatos.",
    });
  }

  await prisma.lead.update({ where: { id: leadId }, data: update });

  return NextResponse.json({
    filled,
    message: `Adicionados: ${filled.join(", ")}`,
  });
}
