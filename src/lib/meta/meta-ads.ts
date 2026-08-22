/**
 * Meta Ads (Marketing API) — OAuth + sync de insights.
 *
 * Espelha o par google-oauth.ts + google/google-ads-sync.ts, mas num arquivo só
 * porque o fluxo da Meta é bem menor: não há refresh token — trocamos o code por
 * um token de usuário LONGO (~60 dias) e guardamos cifrado. Quando expira, o
 * usuário reconecta (a integração vai pra EXPIRED e a UI mostra "Reconectar").
 *
 * Usa o MESMO Meta app do Inbox Social (FACEBOOK_APP_ID/SECRET) — não há env de
 * token de desenvolvedor como no Google Ads. O que precisa ser liberado no app:
 *   - produto "Marketing API" adicionado
 *   - permissões `ads_read` (leitura) e `business_management` (contas via BM)
 *   - Acesso Avançado em `ads_read` pra conectar conta de quem NÃO tem papel no
 *     app (Standard Access só funciona p/ admin/dev/testador do app)
 *   - a redirect URI abaixo em "URIs de redirecionamento do OAuth válidos"
 *
 * Envs:
 *   FACEBOOK_APP_ID / FACEBOOK_APP_SECRET  (obrigatórias, já usadas pelo Inbox)
 *   META_ADS_API_VERSION                   (opcional, default "v21.0")
 *   META_ADS_LOGIN_CONFIG_ID               (opcional — só se o app usar
 *                                           "Login do Facebook para Empresas";
 *                                           tem que ser uma config COM ads_read,
 *                                           NÃO a mesma do Inbox)
 *   META_ADS_CONVERSION_ACTIONS            (opcional — sobrescreve a lista de
 *                                           action_types contados como conversão)
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/insights
 */

import { prisma } from "../prisma";
import { encryptSecret, decryptSecret } from "../crypto";

const APP_ID = process.env.FACEBOOK_APP_ID || "";
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
const API_VERSION = process.env.META_ADS_API_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const CONFIG_ID = process.env.META_ADS_LOGIN_CONFIG_ID || "";

export const META_ADS_REDIRECT_URI = `${BASE_URL.replace(/\/$/, "")}/api/integrations/meta-ads/callback`;
export const META_ADS_SCOPES = ["ads_read", "business_management"];

export function assertMetaAdsConfigured() {
  if (!APP_ID || !APP_SECRET) {
    throw new Error("Meta Ads não configurado. Defina FACEBOOK_APP_ID e FACEBOOK_APP_SECRET no .env");
  }
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

export function buildMetaAdsAuthorizeUrl(state: string): string {
  assertMetaAdsConfigured();
  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: META_ADS_REDIRECT_URI,
    response_type: "code",
    state,
  });
  if (CONFIG_ID) {
    // Login for Business: as permissões vêm da configuração, `scope` é ignorado.
    params.set("config_id", CONFIG_ID);
  } else {
    params.set("scope", META_ADS_SCOPES.join(","));
  }
  return `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params.toString()}`;
}

/** Troca o code por um token curto e já converte pro token longo (~60 dias). */
export async function metaAdsExchangeCode(code: string): Promise<{ token: string; expiresIn: number }> {
  assertMetaAdsConfigured();
  const short = await graphJson(`${GRAPH}/oauth/access_token?${new URLSearchParams({
    client_id: APP_ID,
    client_secret: APP_SECRET,
    redirect_uri: META_ADS_REDIRECT_URI,
    code,
  })}`);
  if (!short.access_token) throw new Error("Meta não devolveu access_token");

  const long = await graphJson(`${GRAPH}/oauth/access_token?${new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: APP_ID,
    client_secret: APP_SECRET,
    fb_exchange_token: short.access_token,
  })}`);
  const token = long.access_token || short.access_token;
  // A Meta às vezes omite expires_in no token longo — assume 60 dias.
  const expiresIn = Number(long.expires_in ?? 0) || 60 * 24 * 3600;
  return { token, expiresIn };
}

/** Quem autorizou (pra gravar em googleName/googleEmail — campos genéricos). */
export async function metaAdsMe(token: string): Promise<{ id: string; name?: string; email?: string }> {
  return graphJson(`${GRAPH}/me?fields=id,name,email&access_token=${encodeURIComponent(token)}`);
}

/** Lista as permissões efetivamente concedidas (pra detectar ads_read negado). */
export async function metaAdsGrantedScopes(token: string): Promise<string[]> {
  try {
    const j = await graphJson(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`);
    return (j.data ?? [])
      .filter((p: any) => p.status === "granted")
      .map((p: any) => String(p.permission));
  } catch {
    return [];
  }
}

export const metaTokenCrypto = {
  encrypt: (s: string) => (s ? encryptSecret(s) : ""),
  decrypt: (s: string | null | undefined) => (s ? decryptSecret(s) : ""),
};

/**
 * Token válido da integração. Sem refresh token: se passou da validade,
 * marca EXPIRED e devolve erro pedindo reconexão.
 */
export async function getValidMetaToken(integrationId: string): Promise<string> {
  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { accessTokenEnc: true, tokenExpiresAt: true, status: true },
  });
  if (!integ?.accessTokenEnc) throw new Error("Integração Meta Ads sem token — reconecte");

  if (integ.tokenExpiresAt && integ.tokenExpiresAt.getTime() < Date.now()) {
    await prisma.marketingIntegration.update({
      where: { id: integrationId },
      data: { status: "EXPIRED", lastError: "Token do Meta expirou — reconecte a integração" },
    });
    throw new Error("Token do Meta expirou — clique em Reconectar");
  }
  return metaTokenCrypto.decrypt(integ.accessTokenEnc);
}

// ─── Graph helpers ───────────────────────────────────────────────────────────

async function graphJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  const txt = await r.text();
  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`Meta Graph ${r.status}: ${txt.slice(0, 300)}`);
  }
  if (!r.ok || json.error) {
    const e = json.error ?? {};
    throw new Error(`Meta Graph ${r.status}: ${e.message ?? txt.slice(0, 300)}${e.error_user_msg ? ` — ${e.error_user_msg}` : ""}`);
  }
  return json;
}

/** GET paginado — segue paging.next até acabar (teto de páginas por segurança). */
async function graphGetAll(
  token: string,
  path: string,
  params: Record<string, string>,
  maxPages = 40
): Promise<any[]> {
  let url = `${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: token })}`;
  const out: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const json = await graphJson(url);
    for (const row of json.data ?? []) out.push(row);
    const next = json.paging?.next;
    if (!next) break;
    url = next; // já vem com access_token e cursor
  }
  return out;
}

// ─── Contas de anúncio (picker) ──────────────────────────────────────────────

export interface MetaAdAccount {
  id: string;       // "act_123456789" — é o que gravamos em accountId
  label: string;
  group?: string;   // Business Manager dono, quando descoberto
  currency?: string;
}

const AD_ACCOUNT_FIELDS = "account_id,name,currency,account_status,business{name}";

/**
 * Contas de anúncio acessíveis pela conexão:
 *   1. /me/adaccounts — contas em que o usuário tem papel direto
 *   2. para cada Business Manager: owned_ad_accounts + client_ad_accounts
 *      (o caso da agência: contas do cliente compartilhadas com o BM da AZZ).
 *      Precisa de business_management; falha silenciosa se não houver.
 */
export async function listMetaAdAccounts(integrationId: string): Promise<MetaAdAccount[]> {
  const token = await getValidMetaToken(integrationId);
  const out = new Map<string, MetaAdAccount>();

  const add = (row: any, group?: string) => {
    const accountId = String(row.account_id ?? "").trim();
    if (!accountId) return;
    const id = `act_${accountId}`;
    // Contas do BM têm nome melhor — só sobrescreve se ainda não tiver group.
    if (out.has(id) && !group) return;
    out.set(id, {
      id,
      label: row.name || `Conta ${accountId}`,
      group,
      currency: row.currency || undefined,
    });
  };

  const direct = await graphGetAll(token, "me/adaccounts", { fields: AD_ACCOUNT_FIELDS, limit: "100" });
  for (const row of direct) add(row, row.business?.name);

  try {
    const businesses = await graphGetAll(token, "me/businesses", { fields: "id,name", limit: "50" });
    for (const biz of businesses) {
      for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
        try {
          const rows = await graphGetAll(token, `${biz.id}/${edge}`, { fields: AD_ACCOUNT_FIELDS, limit: "100" });
          for (const row of rows) add(row, biz.name);
        } catch {
          // sem permissão nesse edge — segue
        }
      }
    }
  } catch {
    // sem business_management — fica só com as contas diretas
  }

  return Array.from(out.values()).sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Conversões ──────────────────────────────────────────────────────────────

/**
 * A Meta não expõe a coluna "Resultados" do gerenciador via API — ela depende do
 * objetivo da campanha. O padrão de mercado é escolher, por linha, o PRIMEIRO
 * action_type de uma lista de prioridade (evita somar `lead` + `fb_pixel_lead`
 * e dobrar a contagem). Dá pra fixar a lista por conta via env quando o cliente
 * tem um evento específico.
 */
const CONVERSION_PRIORITY = (
  process.env.META_ADS_CONVERSION_ACTIONS ||
  [
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
    "purchase",
    "offsite_conversion.fb_pixel_lead",
    "onsite_conversion.lead_grouped",
    "lead",
    "offsite_conversion.fb_pixel_complete_registration",
    "complete_registration",
    "onsite_conversion.messaging_conversation_started_7d",
    "offsite_conversion.fb_pixel_custom",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function pickConversions(actions: any[] | undefined, actionValues: any[] | undefined) {
  if (!Array.isArray(actions) || actions.length === 0) return { conversions: 0, conversionValue: 0 };
  for (const type of CONVERSION_PRIORITY) {
    const hit = actions.find((a) => a.action_type === type);
    if (!hit) continue;
    const val = Array.isArray(actionValues) ? actionValues.find((v) => v.action_type === type) : null;
    return { conversions: Number(hit.value ?? 0) || 0, conversionValue: Number(val?.value ?? 0) || 0 };
  }
  return { conversions: 0, conversionValue: 0 };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

interface SyncResult {
  campaigns: number;
  rows: number;
  ads: number;
  days: number;
}

const INSIGHT_METRICS = "spend,impressions,clicks,actions,action_values";

/** Sync completo de uma integração Meta Ads. Default 35 dias. */
export async function syncMetaAds(integrationId: string, daysBack = 35): Promise<SyncResult> {
  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { id: true, companyId: true, accountId: true, provider: true },
  });
  if (!integ) throw new Error("Integração não encontrada");
  if (integ.provider !== "META_ADS") throw new Error("Integração não é META_ADS");
  if (!integ.accountId) throw new Error("Selecione uma conta de anúncios do Meta antes de sincronizar");

  const token = await getValidMetaToken(integrationId);
  const actId = integ.accountId.startsWith("act_") ? integ.accountId : `act_${integ.accountId}`;
  const { companyId } = integ;

  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - daysBack);
  const timeRange = JSON.stringify({ since: ymd(start), until: ymd(end) });

  let currency: string | null = null;
  try {
    const acc = await graphJson(`${GRAPH}/${actId}?fields=currency&access_token=${encodeURIComponent(token)}`);
    currency = acc.currency ?? null;
  } catch {
    // segue sem moeda — o relatório cai no default BRL
  }

  // Status das campanhas (insights não devolve status).
  const statusById = new Map<string, string>();
  try {
    const campaigns = await graphGetAll(token, `${actId}/campaigns`, {
      fields: "id,name,effective_status",
      limit: "200",
    });
    for (const c of campaigns) if (c.id) statusById.set(String(c.id), String(c.effective_status ?? ""));
  } catch {
    // sem status — grava null
  }

  let rowsWritten = 0;
  const campaignIds = new Set<string>();

  try {
    const rows = await graphGetAll(token, `${actId}/insights`, {
      level: "campaign",
      time_increment: "1",
      time_range: timeRange,
      fields: `campaign_id,campaign_name,${INSIGHT_METRICS}`,
      limit: "500",
    });

    for (const row of rows) {
      const externalCampaignId = String(row.campaign_id ?? "");
      const dateStr = row.date_start as string | undefined; // "YYYY-MM-DD"
      if (!externalCampaignId || !dateStr) continue;
      campaignIds.add(externalCampaignId);

      const { conversions, conversionValue } = pickConversions(row.actions, row.action_values);
      const payload = {
        campaignName: String(row.campaign_name ?? "(sem nome)"),
        campaignStatus: statusById.get(externalCampaignId) || null,
        impressions: parseInt(String(row.impressions ?? "0"), 10) || 0,
        clicks: parseInt(String(row.clicks ?? "0"), 10) || 0,
        cost: Number(row.spend ?? 0) || 0,
        conversions,
        conversionValue,
        currency,
      };

      await prisma.adCampaignDaily.upsert({
        where: {
          companyId_provider_date_externalCampaignId: {
            companyId,
            provider: "META_ADS",
            date: toUtcDate(dateStr),
            externalCampaignId,
          },
        },
        create: { companyId, provider: "META_ADS", date: toUtcDate(dateStr), externalCampaignId, ...payload },
        update: payload,
      });
      rowsWritten++;
    }
  } catch (e: any) {
    await prisma.marketingIntegration.update({
      where: { id: integrationId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: "error",
        lastError: String(e?.message ?? e).slice(0, 1000),
      },
    });
    throw e;
  }

  // Anúncios (métricas + criativo) — falha aqui não derruba as campanhas.
  const partialErrors: string[] = [];
  let ads = 0;
  try {
    ads = await syncMetaAdCreatives(token, companyId, actId, timeRange);
  } catch (e: any) {
    partialErrors.push(`ads: ${String(e?.message ?? e).slice(0, 200)}`);
  }

  await prisma.marketingIntegration.update({
    where: { id: integrationId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: partialErrors.length ? "warning" : "ok",
      lastError: partialErrors.length ? partialErrors.join(" | ").slice(0, 1000) : null,
      status: "ACTIVE",
    },
  });

  return { campaigns: campaignIds.size, rows: rowsWritten, ads, days: daysBack };
}

/**
 * Métricas diárias por anúncio (AdCreativeDaily) + conteúdo do criativo
 * (AdCreative) pra montar a prévia do "anúncio destaque".
 */
async function syncMetaAdCreatives(
  token: string,
  companyId: string,
  actId: string,
  timeRange: string
): Promise<number> {
  const rows = await graphGetAll(token, `${actId}/insights`, {
    level: "ad",
    time_increment: "1",
    time_range: timeRange,
    fields: `ad_id,ad_name,adset_name,campaign_name,${INSIGHT_METRICS}`,
    limit: "500",
  });

  const seen = new Set<string>();
  for (const row of rows) {
    const externalAdId = String(row.ad_id ?? "");
    const dateStr = row.date_start as string | undefined;
    if (!externalAdId || !dateStr) continue;
    seen.add(externalAdId);

    const { conversions, conversionValue } = pickConversions(row.actions, row.action_values);
    const payload = {
      impressions: parseInt(String(row.impressions ?? "0"), 10) || 0,
      clicks: parseInt(String(row.clicks ?? "0"), 10) || 0,
      cost: Number(row.spend ?? 0) || 0,
      conversions,
      conversionValue,
    };
    await prisma.adCreativeDaily.upsert({
      where: {
        companyId_provider_date_externalAdId: {
          companyId, provider: "META_ADS", date: toUtcDate(dateStr), externalAdId,
        },
      },
      create: { companyId, provider: "META_ADS", date: toUtcDate(dateStr), externalAdId, ...payload },
      update: payload,
    });
  }

  if (seen.size === 0) return 0;

  // Conteúdo dos criativos — uma chamada só pra conta inteira.
  const adRows = await graphGetAll(token, `${actId}/ads`, {
    fields:
      "id,name,effective_status,adset{id,name},campaign{id,name}," +
      "creative{title,body,object_type,link_url,object_story_spec,asset_feed_spec{titles,bodies,link_urls}}",
    limit: "200",
  });

  let count = 0;
  for (const ad of adRows) {
    const externalAdId = String(ad.id ?? "");
    if (!externalAdId || !seen.has(externalAdId)) continue; // só anúncios com métrica no período
    const c = ad.creative ?? {};
    const link = c.object_story_spec?.link_data ?? c.object_story_spec?.video_data ?? {};

    const headlines = uniqStrings([
      c.title,
      link.name,
      ...(c.asset_feed_spec?.titles ?? []).map((t: any) => t?.text),
    ]);
    const descriptions = uniqStrings([
      c.body,
      link.message,
      link.description,
      ...(c.asset_feed_spec?.bodies ?? []).map((b: any) => b?.text),
    ]);
    const finalUrl =
      c.link_url ||
      link.link ||
      c.asset_feed_spec?.link_urls?.[0]?.website_url ||
      null;

    const contentPayload = {
      externalCampaignId: ad.campaign?.id ? String(ad.campaign.id) : null,
      externalAdSetId: ad.adset?.id ? String(ad.adset.id) : null,
      campaignName: ad.campaign?.name ? String(ad.campaign.name) : null,
      // Meta não tem "grupo de anúncios" — o equivalente é o conjunto (ad set).
      adGroupName: ad.adset?.name ? String(ad.adset.name) : null,
      adType: c.object_type ? String(c.object_type) : null,
      status: ad.effective_status ? String(ad.effective_status) : null,
      headlines,
      descriptions,
      finalUrl,
      path1: null,
      path2: null,
    };

    await prisma.adCreative.upsert({
      where: { companyId_provider_externalAdId: { companyId, provider: "META_ADS", externalAdId } },
      create: { companyId, provider: "META_ADS", externalAdId, ...contentPayload },
      update: contentPayload,
    });
    count++;
  }
  return count;
}

// ─── util ────────────────────────────────────────────────────────────────────

function uniqStrings(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function toUtcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
