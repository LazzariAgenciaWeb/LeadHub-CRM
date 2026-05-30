// Helper para Google PageSpeed Insights API v5.
// Endpoint público (rate limit 25k/dia sem key — suficiente pra diagnósticos
// individuais). Se passar disso, criar projeto no GCP e setar PAGESPEED_API_KEY.

export type PageSpeedResult = {
  url: string;
  fetched: boolean;
  // Score 0-100 (performance category). null se a API falhou.
  performanceScore: number | null;
  // Largest Contentful Paint em ms (Core Web Vitals)
  lcpMs: number | null;
  // Cumulative Layout Shift (Core Web Vitals)
  cls: number | null;
  // First Contentful Paint em ms
  fcpMs: number | null;
  // Boolean: passa no critério "Mobile Friendly"
  mobileFriendly: boolean | null;
  // Mensagem amigável pra IA usar (ex: "Página lenta (8.2s no LCP)")
  summary: string | null;
};

const EMPTY: Omit<PageSpeedResult, "url"> = {
  fetched: false,
  performanceScore: null,
  lcpMs: null,
  cls: null,
  fcpMs: null,
  mobileFriendly: null,
  summary: null,
};

/**
 * Roda PageSpeed Mobile pra uma URL. Timeout generoso (15s) porque a API do
 * Google às vezes é lenta. Erros não propagam — retorna PageSpeedResult com
 * fetched=false e summary preenchido com o motivo.
 */
export async function runPageSpeed(targetUrl: string, timeoutMs = 15000): Promise<PageSpeedResult> {
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return { url: targetUrl, ...EMPTY, summary: "URL inválida" };
  }

  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", targetUrl);
  api.searchParams.set("strategy", "mobile");
  api.searchParams.set("category", "PERFORMANCE");
  const key = process.env.PAGESPEED_API_KEY;
  if (key) api.searchParams.set("key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(api.toString(), { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        url: targetUrl,
        ...EMPTY,
        summary: `PageSpeed falhou (HTTP ${res.status})`,
      };
    }
    const data: any = await res.json();
    const lhr = data?.lighthouseResult;
    const audits = lhr?.audits ?? {};
    const score = lhr?.categories?.performance?.score;

    const lcp = Number(audits["largest-contentful-paint"]?.numericValue ?? NaN);
    const cls = Number(audits["cumulative-layout-shift"]?.numericValue ?? NaN);
    const fcp = Number(audits["first-contentful-paint"]?.numericValue ?? NaN);
    const viewport = audits["viewport"]?.score === 1; // proxy de mobile-friendly

    const performanceScore = typeof score === "number" ? Math.round(score * 100) : null;

    // Resumo curto pra alimentar o prompt da IA
    const parts: string[] = [];
    if (performanceScore !== null) {
      const label = performanceScore >= 90 ? "excelente" : performanceScore >= 50 ? "média" : "ruim";
      parts.push(`Performance ${label} (${performanceScore}/100)`);
    }
    if (Number.isFinite(lcp)) {
      const lcpSec = (lcp / 1000).toFixed(1);
      parts.push(`LCP ${lcpSec}s`);
    }
    if (Number.isFinite(cls)) {
      parts.push(`CLS ${cls.toFixed(3)}`);
    }
    if (viewport === false) parts.push("⚠️ sem viewport mobile");

    return {
      url: targetUrl,
      fetched: true,
      performanceScore,
      lcpMs: Number.isFinite(lcp) ? Math.round(lcp) : null,
      cls: Number.isFinite(cls) ? Number(cls.toFixed(3)) : null,
      fcpMs: Number.isFinite(fcp) ? Math.round(fcp) : null,
      mobileFriendly: viewport,
      summary: parts.length > 0 ? parts.join(" · ") : "Sem métricas",
    };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      url: targetUrl,
      ...EMPTY,
      summary: err?.name === "AbortError" ? "PageSpeed timeout (15s)" : "PageSpeed indisponível",
    };
  }
}
