/**
 * Sincronização do Google Ads (Google Ads API, GAQL).
 *
 * Para cada integração ativa (provider=GOOGLE_ADS) busca os últimos N dias
 * segmentados por dia + campanha e popula AdCampaignDaily (1 linha por
 * empresa/dia/campanha). Upsert idempotente — roda várias vezes/dia.
 *
 * A Google Ads API NÃO usa só Bearer: exige headers extras
 *   - developer-token: token aprovado no API Center de uma conta MCC
 *   - login-customer-id: id da MCC (sem traços) quando acessamos uma conta-cliente
 * por isso temos um fetch dedicado aqui (o googleFetch genérico só põe o Bearer).
 *
 * Envs:
 *   GOOGLE_ADS_DEVELOPER_TOKEN   (obrigatório)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC, recomendado p/ acesso de gestor)
 *   GOOGLE_ADS_API_VERSION       (opcional, default "v22")
 *
 * NOTA: o Google mantém só as ~3 versões mais recentes; versões antigas viram
 * 404 (HTML). Se um dia der 404, é só bumpar a env GOOGLE_ADS_API_VERSION.
 *
 * Docs: https://developers.google.com/google-ads/api/docs/reporting/overview
 */

import { prisma } from "../prisma";
import { getValidAccessToken } from "./token";

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v22";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;

interface SyncResult {
  campaigns: number;   // nº de campanhas distintas vistas
  rows: number;        // nº de linhas (campanha×dia) gravadas
  searchTerms: number; // nº de linhas de termo de pesquisa gravadas
  ads: number;         // nº de anúncios distintos gravados
  days: number;
}

/** Só dígitos — a API rejeita ids com traços ("123-456-7890"). */
function digits(id: string): string {
  return id.replace(/\D/g, "");
}

function devToken(): string {
  const t = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!t) {
    throw new Error(
      "GOOGLE_ADS_DEVELOPER_TOKEN não configurado — gere no API Center de uma conta MCC do Google Ads"
    );
  }
  return t;
}

/** Contas que a conexão OAuth alcança direto (customers:listAccessibleCustomers). */
async function accessibleCustomers(accessToken: string): Promise<string[]> {
  const r = await fetch(`${API_BASE}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${accessToken}`, "developer-token": devToken() },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Google Ads listAccessibleCustomers ${r.status}: ${txt.slice(0, 400)}`);
  }
  const data = await r.json();
  return ((data.resourceNames ?? []) as string[]).map(digits).filter(Boolean);
}

// Cache do login-customer-id resolvido por (integração, conta). Descobrir a MCC
// custa 1..N chamadas; a hierarquia do Google Ads muda muito pouco.
const LOGIN_CID_CACHE = new Map<string, { value: string | undefined; at: number }>();
const LOGIN_CID_TTL = 60 * 60 * 1000; // 1h

/**
 * Descobre qual login-customer-id usar pra falar com `customerId` NESTA conexão.
 *
 * A env GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC da AZZ) só serve pra quem tem acesso
 * a ela. Quando o cliente conecta a própria conta Google, mandar a MCC da
 * agência no header dá 403 USER_PERMISSION_DENIED ("The caller does not have
 * permission") mesmo com a conta certa selecionada — o erro fala do header, não
 * da conta. Então resolvemos por conexão:
 *   1. acesso direto à conta → sem header;
 *   2. senão, a gestora acessível que enxerga essa conta como cliente;
 *   3. se a descoberta falhar, cai na env (comportamento antigo).
 */
async function resolveLoginCustomerId(
  integrationId: string,
  customerId: string,
  accessToken: string
): Promise<string | undefined> {
  const cid = digits(customerId);
  const key = `${integrationId}:${cid}`;
  const hit = LOGIN_CID_CACHE.get(key);
  if (hit && Date.now() - hit.at < LOGIN_CID_TTL) return hit.value;

  const remember = (value: string | undefined) => {
    LOGIN_CID_CACHE.set(key, { value, at: Date.now() });
    return value;
  };

  let accessible: string[];
  try {
    accessible = await accessibleCustomers(accessToken);
  } catch {
    // Sem a lista não dá pra decidir — mantém o comportamento antigo.
    const env = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    return env ? digits(env) : undefined;
  }

  // Acesso direto: nada de login-customer-id (é o caso do cliente que conecta
  // a própria conta de anúncios).
  if (accessible.includes(cid)) return remember(undefined);

  // Conta acessada via gestora: acha qual das gestoras enxerga esse cliente.
  for (const managerCid of accessible) {
    try {
      const rows = await googleAdsSearch(
        integrationId,
        managerCid,
        `SELECT customer_client.id FROM customer_client WHERE customer_client.id = ${cid}`,
        { loginCustomerId: managerCid }
      );
      if (rows.length > 0) return remember(managerCid);
    } catch {
      // gestora sem permissão de leitura — tenta a próxima
    }
  }

  const env = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  return remember(env ? digits(env) : undefined);
}

/**
 * Roda GAQL via searchStream e devolve todas as linhas (achatadas).
 * `customerId` = conta-cliente alvo (só dígitos). O login-customer-id sai de
 * `opts` (chamada que já sabe a gestora) ou é descoberto pra esta conexão.
 */
export async function googleAdsSearch(
  integrationId: string,
  customerId: string,
  gaql: string,
  opts: { loginCustomerId?: string } = {}
): Promise<any[]> {
  const { accessToken } = await getValidAccessToken(integrationId);
  const cid = digits(customerId);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": devToken(),
    "Content-Type": "application/json",
  };
  const loginCid = opts.loginCustomerId
    ? digits(opts.loginCustomerId)
    : await resolveLoginCustomerId(integrationId, cid, accessToken);
  if (loginCid && loginCid !== cid) headers["login-customer-id"] = loginCid;

  const r = await fetch(`${API_BASE}/customers/${cid}/googleAds:searchStream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: gaql }),
  });
  if (!r.ok) {
    const txt = await r.text();
    // USER_PERMISSION_DENIED é sempre a mesma história: a conta Google que
    // autorizou não administra essa conta de anúncios. O JSON cru da Google não
    // diz isso — quem lê o card da integração precisa da frase, não do stack.
    if (r.status === 403 && txt.includes("USER_PERMISSION_DENIED")) {
      throw new Error(
        `Google Ads negou o acesso à conta ${cid}: a conta Google conectada não tem permissão nela. ` +
        `Confirme no Google Ads que o e-mail conectado é usuário dessa conta (ou da gestora que a administra) e reconecte.`
      );
    }
    throw new Error(`Google Ads API ${r.status}: ${txt.slice(0, 400)}`);
  }
  // searchStream (REST) devolve um ARRAY de respostas; cada uma tem `results`.
  const data = await r.json();
  const batches = Array.isArray(data) ? data : [data];
  const rows: any[] = [];
  for (const b of batches) {
    for (const row of b.results ?? []) rows.push(row);
  }
  return rows;
}

export interface GoogleAdsAccount {
  id: string;       // só dígitos — gravado como accountId
  label: string;    // descriptive_name (ou o próprio id)
  group?: string;   // MCC mãe, quando descoberto via customer_client
  currency?: string;
}

/**
 * Lista as contas-cliente do Google Ads acessíveis pela conexão, pra o usuário
 * escolher qual sincronizar (espelha o picker de propriedade do GA4).
 *
 * 1. listAccessibleCustomers → contas que o usuário OAuth alcança.
 * 2. Pra cada conta gestora (manager), expande os clientes via customer_client.
 *    Só contas NÃO-gestoras entram na lista selecionável (são as que têm campanha).
 */
export async function listGoogleAdsAccounts(integrationId: string): Promise<GoogleAdsAccount[]> {
  const { accessToken } = await getValidAccessToken(integrationId);
  const resourceNames = await accessibleCustomers(accessToken);

  const out = new Map<string, GoogleAdsAccount>();

  for (const cid of resourceNames) {
    let info: any = {};
    try {
      const rows = await googleAdsSearch(
        integrationId,
        cid,
        "SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code FROM customer LIMIT 1",
        { loginCustomerId: cid }
      );
      info = rows[0]?.customer ?? {};
    } catch {
      // sem acesso direto de leitura — segue como id puro
    }

    const isManager = info.manager === true;
    if (!isManager) {
      out.set(cid, {
        id: cid,
        label: info.descriptiveName || `Conta ${cid}`,
        currency: info.currencyCode || undefined,
      });
      continue;
    }

    // Conta gestora (MCC): expande os clientes não-gestores.
    try {
      const children = await googleAdsSearch(
        integrationId,
        cid,
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.currency_code, customer_client.status FROM customer_client WHERE customer_client.manager = false",
        { loginCustomerId: cid }
      );
      const managerName = info.descriptiveName || `MCC ${cid}`;
      for (const row of children) {
        const cc = row.customerClient ?? {};
        const childId = digits(String(cc.id ?? ""));
        if (!childId) continue;
        out.set(childId, {
          id: childId,
          label: cc.descriptiveName || `Conta ${childId}`,
          group: managerName,
          currency: cc.currencyCode || undefined,
        });
      }
    } catch {
      // não conseguiu expandir clientes da MCC — ignora essa MCC
    }
  }

  return Array.from(out.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Sync completo de uma integração Google Ads. Default 35 dias.
 */
export async function syncGoogleAds(integrationId: string, daysBack = 35): Promise<SyncResult> {
  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { id: true, companyId: true, accountId: true, provider: true },
  });
  if (!integ) throw new Error("Integração não encontrada");
  if (integ.provider !== "GOOGLE_ADS") throw new Error("Integração não é GOOGLE_ADS");
  if (!integ.accountId) throw new Error("Selecione uma conta do Google Ads antes de sincronizar");

  const customerId = integ.accountId; // só dígitos (gravado pelo picker)
  const { companyId } = integ;

  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - daysBack);
  const startStr = ymd(start);
  const endStr = ymd(end);

  const gaql = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      customer.currency_code
    FROM campaign
    WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
  `.trim();

  let rowsWritten = 0;
  const campaignIds = new Set<string>();

  try {
    const rows = await googleAdsSearch(integrationId, customerId, gaql);

    for (const row of rows) {
      const campaign = row.campaign ?? {};
      const segments = row.segments ?? {};
      const metrics = row.metrics ?? {};
      const customer = row.customer ?? {};

      const externalCampaignId = String(campaign.id ?? "");
      const dateStr = segments.date as string | undefined; // "YYYY-MM-DD"
      if (!externalCampaignId || !dateStr) continue;
      campaignIds.add(externalCampaignId);

      const [y, m, d] = dateStr.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));

      // metrics.costMicros vem como string (int64). 1 unidade = micro da moeda.
      const costMicros = Number(metrics.costMicros ?? 0);
      const cost = costMicros / 1_000_000;
      const conversionValue = Number(metrics.conversionsValue ?? 0);

      const payload = {
        campaignName: String(campaign.name ?? "(sem nome)"),
        campaignStatus: campaign.status ? String(campaign.status) : null,
        impressions: parseInt(String(metrics.impressions ?? "0"), 10) || 0,
        clicks: parseInt(String(metrics.clicks ?? "0"), 10) || 0,
        cost,
        conversions: Number(metrics.conversions ?? 0),
        conversionValue,
        currency: customer.currencyCode ? String(customer.currencyCode) : null,
      };

      await prisma.adCampaignDaily.upsert({
        where: {
          companyId_provider_date_externalCampaignId: {
            companyId,
            provider: "GOOGLE_ADS",
            date,
            externalCampaignId,
          },
        },
        create: { companyId, provider: "GOOGLE_ADS", date, externalCampaignId, ...payload },
        update: payload,
      });
      rowsWritten++;
    }

  } catch (e: any) {
    // Campanhas são a etapa essencial — se falhar, o sync inteiro falha.
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

  // Etapas secundárias (breakdowns) — falha em uma não derruba as campanhas.
  const partialErrors: string[] = [];
  let searchTerms = 0;
  let ads = 0;
  try {
    searchTerms = await syncSearchTerms(integrationId, companyId, customerId, startStr, endStr);
  } catch (e: any) {
    partialErrors.push(`search_terms: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  try {
    ads = await syncAdCreatives(integrationId, companyId, customerId, startStr, endStr);
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

  return { campaigns: campaignIds.size, rows: rowsWritten, searchTerms, ads, days: daysBack };
}

// ─── Termos de pesquisa (search_term_view) ──────────────────────────────────
async function syncSearchTerms(
  integrationId: string, companyId: string, customerId: string, startStr: string, endStr: string
): Promise<number> {
  const gaql = `
    SELECT
      search_term_view.search_term,
      ad_group.id,
      ad_group.name,
      campaign.name,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
  `.trim();

  const rows = await googleAdsSearch(integrationId, customerId, gaql);
  let count = 0;
  for (const row of rows) {
    const stv = row.searchTermView ?? {};
    const adGroup = row.adGroup ?? {};
    const campaign = row.campaign ?? {};
    const metrics = row.metrics ?? {};
    const searchTerm = String(stv.searchTerm ?? "").trim();
    const dateStr = row.segments?.date as string | undefined;
    if (!searchTerm || !dateStr) continue;

    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const adGroupId = String(adGroup.id ?? "");

    const payload = {
      adGroupName: adGroup.name ? String(adGroup.name) : null,
      campaignName: campaign.name ? String(campaign.name) : null,
      impressions: parseInt(String(metrics.impressions ?? "0"), 10) || 0,
      clicks: parseInt(String(metrics.clicks ?? "0"), 10) || 0,
      cost: Number(metrics.costMicros ?? 0) / 1_000_000,
      conversions: Number(metrics.conversions ?? 0),
      conversionValue: Number(metrics.conversionsValue ?? 0),
    };

    await prisma.adSearchTermDaily.upsert({
      where: {
        companyId_provider_date_searchTerm_adGroupId: {
          companyId, provider: "GOOGLE_ADS", date, searchTerm, adGroupId,
        },
      },
      create: { companyId, provider: "GOOGLE_ADS", date, searchTerm, adGroupId, ...payload },
      update: payload,
    });
    count++;
  }
  return count;
}

// ─── Anúncios (ad_group_ad) — conteúdo p/ prévia + métricas diárias ──────────
async function syncAdCreatives(
  integrationId: string, companyId: string, customerId: string, startStr: string, endStr: string
): Promise<number> {
  const gaql = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.path1,
      ad_group_ad.ad.responsive_search_ad.path2,
      ad_group_ad.status,
      ad_group.name,
      campaign.name,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
  `.trim();

  const rows = await googleAdsSearch(integrationId, customerId, gaql);
  const seenContent = new Set<string>();
  let count = 0;

  for (const row of rows) {
    const aga = row.adGroupAd ?? {};
    const ad = aga.ad ?? {};
    const rsa = ad.responsiveSearchAd ?? {};
    const metrics = row.metrics ?? {};
    const externalAdId = String(ad.id ?? "");
    const dateStr = row.segments?.date as string | undefined;
    if (!externalAdId || !dateStr) continue;

    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));

    const dailyPayload = {
      impressions: parseInt(String(metrics.impressions ?? "0"), 10) || 0,
      clicks: parseInt(String(metrics.clicks ?? "0"), 10) || 0,
      cost: Number(metrics.costMicros ?? 0) / 1_000_000,
      conversions: Number(metrics.conversions ?? 0),
      conversionValue: Number(metrics.conversionsValue ?? 0),
    };
    await prisma.adCreativeDaily.upsert({
      where: {
        companyId_provider_date_externalAdId: { companyId, provider: "GOOGLE_ADS", date, externalAdId },
      },
      create: { companyId, provider: "GOOGLE_ADS", date, externalAdId, ...dailyPayload },
      update: dailyPayload,
    });

    // Conteúdo estático: grava só uma vez por anúncio neste sync.
    if (!seenContent.has(externalAdId)) {
      seenContent.add(externalAdId);
      const headlines = Array.isArray(rsa.headlines)
        ? rsa.headlines.map((h: any) => String(h.text ?? "")).filter(Boolean)
        : undefined;
      const descriptions = Array.isArray(rsa.descriptions)
        ? rsa.descriptions.map((h: any) => String(h.text ?? "")).filter(Boolean)
        : undefined;
      const finalUrl = Array.isArray(ad.finalUrls) && ad.finalUrls.length ? String(ad.finalUrls[0]) : null;

      const contentPayload = {
        campaignName: row.campaign?.name ? String(row.campaign.name) : null,
        adGroupName: row.adGroup?.name ? String(row.adGroup.name) : null,
        adType: ad.type ? String(ad.type) : null,
        status: aga.status ? String(aga.status) : null,
        headlines,
        descriptions,
        finalUrl,
        path1: rsa.path1 ? String(rsa.path1) : null,
        path2: rsa.path2 ? String(rsa.path2) : null,
      };
      await prisma.adCreative.upsert({
        where: { companyId_provider_externalAdId: { companyId, provider: "GOOGLE_ADS", externalAdId } },
        create: { companyId, provider: "GOOGLE_ADS", externalAdId, ...contentPayload },
        update: contentPayload,
      });
      count++;
    }
  }
  return count;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
