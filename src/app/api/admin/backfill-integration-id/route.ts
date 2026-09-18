import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { IntegrationProvider } from "@/generated/prisma";

/**
 * Backfill idempotente: adota o histórico de marketing na conexão que o gerou.
 *
 * Contexto — antes, toda tabela de dados (AnalyticsSnapshot, SearchConsoleQuery,
 * GbpInsight…) era chaveada só por `companyId`. Isso limitava a empresa a UMA
 * propriedade GA4 / site do Search Console / perfil do Meu Negócio: a segunda
 * sobrescrevia a primeira no upsert, e cada sync fazia `deleteMany` por
 * companyId antes de gravar, apagando o que a outra tinha acabado de escrever.
 *
 * Agora cada linha carrega `integrationId`. O deploy roda `prisma db push`, que
 * cria a coluna com o default 'legacy' mas não sabe de quem é o histórico —
 * este endpoint sabe: onde a empresa tem UMA única conexão daquele provider, é
 * dela. Sem isso, o relatório continuaria certo no modo "Todas" mas o seletor
 * por propriedade viria vazio para todo cliente antigo.
 *
 * Regras:
 *   - empresa com 1 conexão do provider → adota tudo que está em 'legacy';
 *   - empresa com 0 conexões           → deixa em 'legacy' (histórico puro, sem
 *     conexão viva; aparece no modo "Todas" e não duplica nada);
 *   - empresa com 2+ conexões          → AMBÍGUO, não toca. Só existe se alguém
 *     já tinha duas conexões antes desta mudança — caso em que o histórico é o
 *     resultado de dois syncs se atropelando, ou seja, já estava errado. Fica
 *     reportado em `ambiguas` pra decisão manual (ver nota no fim do arquivo).
 *
 * Roda no BOOT do container (start.sh). Seguro repetir: só toca em 'legacy'.
 * Protegido por CRON_SECRET, igual aos demais jobs internos.
 */

// provider → tabelas que guardam dados gerados por ele.
const TABELAS: Record<string, { provider: IntegrationProvider; modelos: string[] }> = {
  ga4: {
    provider: "GA4",
    modelos: [
      "analyticsSnapshot",
      "analyticsTopPage",
      "analyticsTrafficSource",
      "analyticsGeoData",
      "analyticsEventDaily",
      "analyticsEventParamDaily",
    ],
  },
  sc: {
    provider: "SEARCH_CONSOLE",
    modelos: ["searchConsoleQuery"],
  },
  gbp: {
    provider: "BUSINESS_PROFILE",
    modelos: ["gbpInsight", "gbpReview", "gbpSearchKeyword", "gbpProfileSnapshot"],
  },
};

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  const adotadas: Record<string, number> = {};
  const ambiguas: { companyId: string; provider: string; conexoes: number }[] = [];
  let empresasTocadas = 0;

  for (const [chave, { provider, modelos }] of Object.entries(TABELAS)) {
    // Conexões com propriedade escolhida — as sem accountId nunca sincronizaram
    // nada, então não podem ser donas de histórico nenhum.
    const conexoes = await prisma.marketingIntegration.findMany({
      where: { provider, accountId: { not: null } },
      select: { id: true, companyId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const porEmpresa = new Map<string, string[]>();
    for (const c of conexoes) {
      if (!porEmpresa.has(c.companyId)) porEmpresa.set(c.companyId, []);
      porEmpresa.get(c.companyId)!.push(c.id);
    }

    for (const [companyId, ids] of porEmpresa) {
      if (ids.length > 1) {
        ambiguas.push({ companyId, provider, conexoes: ids.length });
        continue;
      }
      const integrationId = ids[0];
      let tocou = false;

      for (const modelo of modelos) {
        // Acesso dinâmico: os 11 modelos têm o mesmo shape pro que interessa
        // aqui (companyId + integrationId), e escrever 11 updateMany à mão só
        // multiplicaria a chance de esquecer um.
        const delegate = (prisma as unknown as Record<string, {
          updateMany: (args: unknown) => Promise<{ count: number }>;
        }>)[modelo];
        const r = await delegate.updateMany({
          where: { companyId, integrationId: "legacy" },
          data: { integrationId },
        });
        if (r.count > 0) {
          adotadas[`${chave}.${modelo}`] = (adotadas[`${chave}.${modelo}`] ?? 0) + r.count;
          tocou = true;
        }
      }
      if (tocou) empresasTocadas++;
    }
  }

  const totalLinhas = Object.values(adotadas).reduce((a, b) => a + b, 0);

  return NextResponse.json({
    ok: true,
    totalLinhas,
    empresasTocadas,
    adotadas,
    // Empresas que já tinham 2+ conexões do mesmo provider antes da mudança.
    // O histórico delas é fruto de syncs se sobrescrevendo — não dá pra saber
    // qual linha é de qual propriedade. Some no modo "Todas" e some no seletor.
    // Para limpar: apagar as linhas 'legacy' dessa empresa e forçar um sync
    // (Integrações → "Sync agora" em cada conexão) repopula os últimos 35 dias
    // já carimbados. Feito à mão de propósito: é destrutivo.
    ambiguas,
  });
}
