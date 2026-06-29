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
 *   GOOGLE_ADS_API_VERSION       (opcional, default "v18")
 *
 * Docs: https://developers.google.com/google-ads/api/docs/reporting/overview
 */

import { prisma } from "../prisma";
import { getValidAccessToken } from "./token";

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v18";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;

interface SyncResult {
  campaigns: number; // nº de campanhas distintas vistas
  rows: number;      // nº de linhas (campanha×dia) gravadas
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

/**
 * Roda GAQL via searchStream e devolve todas as linhas (achatadas).
 * `customerId` = conta-cliente alvo (só dígitos). Usa login-customer-id da MCC
 * quando a env existir (acesso de gestor).
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
  // login-customer-id: o override (ex: varrer clientes de uma MCC específica)
  // tem prioridade sobre a env global.
  const loginCid = opts.loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (loginCid) headers["login-customer-id"] = digits(loginCid);

  const r = await fetch(`${API_BASE}/customers/${cid}/googleAds:searchStream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: gaql }),
  });
  if (!r.ok) {
    const txt = await r.text();
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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": devToken(),
  };
  const r = await fetch(`${API_BASE}/customers:listAccessibleCustomers`, { headers });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Google Ads listAccessibleCustomers ${r.status}: ${txt.slice(0, 400)}`);
  }
  const data = await r.json();
  const resourceNames: string[] = data.resourceNames ?? [];

  const out = new Map<string, GoogleAdsAccount>();

  for (const rn of resourceNames) {
    const cid = digits(rn); // "customers/123" → "123"
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

    await prisma.marketingIntegration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastError: null, status: "ACTIVE" },
    });
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

  return { campaigns: campaignIds.size, rows: rowsWritten, days: daysBack };
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
