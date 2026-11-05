import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";
import { aggregateConversations } from "@/lib/ig-inbox-stats";

/**
 * GET /api/instagram/inbox/overview?days=30
 *
 * Duas coisas que faltavam na Inbox Social e só existiam em Configurações:
 *   1. SAÚDE DA CONEXÃO — token vencido / conta desautorizada deixa a inbox
 *      muda (nada entra, nada sai) e a tela não dizia nada: parecia "sem
 *      conversas novas". Agora vem com o motivo e o link de reconectar.
 *   2. RESULTADO — quem interagiu, quem retornou a conversa e o que virou
 *      lead. Vide src/lib/ig-inbox-stats.ts pelas definições.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const days = clampDays(new URL(req.url).searchParams.get("days"));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const root = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const reconnectUrl = `${root}/api/integrations/instagram/connect?companyId=${ctx.companyId}`;
  const fbReconnectUrl = `${root}/api/integrations/facebook/connect?companyId=${ctx.companyId}`;

  const [igAccounts, fbPages] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, username: true, name: true, profilePictureUrl: true,
        status: true, lastError: true, tokenExpiresAt: true, accessTokenEnc: true,
      },
    }),
    prisma.facebookPage.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { createdAt: "desc" },
      select: { id: true, pageId: true, name: true, status: true, lastError: true, pageAccessTokenEnc: true },
    }),
  ]);

  const connections = [
    ...igAccounts.map((a) => ({
      kind: "INSTAGRAM" as const,
      id: a.id,
      label: a.username ? `@${a.username}` : a.name || "Instagram",
      avatar: a.profilePictureUrl,
      tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
      reconnectUrl,
      canResubscribe: true,
      ...health(!!a.accessTokenEnc, a.status, a.lastError, a.tokenExpiresAt),
    })),
    ...fbPages.map((p) => ({
      kind: "MESSENGER" as const,
      id: p.id,
      label: p.name || `Página ${p.pageId}`,
      avatar: null as string | null,
      tokenExpiresAt: null,
      reconnectUrl: fbReconnectUrl,
      canResubscribe: false,
      ...health(!!p.pageAccessTokenEnc, p.status, p.lastError, null),
    })),
  ];

  // Conversas ativas no período. Teto alto o bastante pra não cortar empresa
  // movimentada e baixo o bastante pro groupBy não varrer a tabela inteira.
  const convos = await prisma.igConversation.findMany({
    where: { companyId: ctx.companyId, lastMessageAt: { gte: since } },
    orderBy: { lastMessageAt: "desc" },
    take: 2000,
    select: { id: true, channel: true, needsReply: true, hadAutomation: true, leadId: true },
  });

  const aggs = await aggregateConversations(convos.map((c) => c.id));

  const stats = {
    days,
    conversas: convos.length,
    interagiram: 0,
    retornaram: 0,
    responderamProspeccao: 0,
    nossoContatoSemResposta: 0,
    semResposta: 0,
    automacao: 0,
    porCanal: { INSTAGRAM: 0, MESSENGER: 0, FACEBOOK: 0 } as Record<string, number>,
  };

  const leadIds = new Set<string>();
  for (const c of convos) {
    const a = aggs.get(c.id);
    if (a?.interacted) stats.interagiram++;
    if (a?.returned) stats.retornaram++;
    if (a?.repliedToOutreach) stats.responderamProspeccao++;
    if (a?.weStarted && !a.interacted) stats.nossoContatoSemResposta++;
    if (c.needsReply) stats.semResposta++;
    if (c.hadAutomation) stats.automacao++;
    stats.porCanal[c.channel] = (stats.porCanal[c.channel] ?? 0) + 1;
    if (c.leadId) leadIds.add(c.leadId);
  }

  // Leads que saíram daqui: vinculados a uma conversa ativa no período. O
  // vínculo é feito no webhook (promoteIgProspectOnReply) e pelo match do @.
  const leads = leadIds.size
    ? await prisma.lead.findMany({
        where: { id: { in: [...leadIds] }, companyId: ctx.companyId },
        select: { id: true, pipeline: true, wonAt: true, lostAt: true, value: true },
      })
    : [];

  // Automação de comentário também gera lead (conversão no relatório do
  // /instagram) — conta separado porque não nasce de conversa de DM.
  const leadsDeComentario = await prisma.igAutomationRun.count({
    where: { companyId: ctx.companyId, leadId: { not: null }, createdAt: { gte: since } },
  });

  const ganhos = leads.filter((l) => !!l.wonAt);
  const leadStats = {
    total: leads.length,
    prospeccao: leads.filter((l) => l.pipeline === "PROSPECCAO").length,
    leads: leads.filter((l) => l.pipeline === "LEADS").length,
    oportunidades: leads.filter((l) => l.pipeline === "OPORTUNIDADES").length,
    ganhos: ganhos.length,
    perdidos: leads.filter((l) => !l.wonAt && !!l.lostAt).length,
    valorGanho: ganhos.reduce((sum, l) => sum + (l.value ?? 0), 0),
    deComentario: leadsDeComentario,
  };

  // connectUrl/fbConnectUrl soltos: quando NÃO há conexão nenhuma não existe
  // linha em `connections` pra carregar o link de conectar.
  return NextResponse.json({
    connections,
    connectUrl: reconnectUrl,
    fbConnectUrl: fbReconnectUrl,
    stats,
    leads: leadStats,
  });
}

function clampDays(raw: string | null): number {
  const n = Number(raw);
  return [7, 30, 90, 365].includes(n) ? n : 30;
}

/** Estado da conexão em linguagem de usuário: por que a inbox está muda. */
function health(
  hasToken: boolean,
  status: string,
  lastError: string | null,
  tokenExpiresAt: Date | null,
): { state: "ONLINE" | "EXPIRING" | "OFFLINE"; reason: string | null } {
  const fmt = (d: Date) => d.toLocaleDateString("pt-BR");
  if (!hasToken) return { state: "OFFLINE", reason: "Sem token — reconecte a conta." };
  if (status === "DISCONNECTED") return { state: "OFFLINE", reason: "Desconectada manualmente." };
  if (status === "EXPIRED") return { state: "OFFLINE", reason: "Autorização expirada na Meta — reconecte." };
  if (status === "ERROR") {
    return { state: "OFFLINE", reason: lastError?.slice(0, 160) || "A Meta recusou as últimas chamadas." };
  }
  if (tokenExpiresAt && tokenExpiresAt.getTime() < Date.now()) {
    return { state: "OFFLINE", reason: `Token venceu em ${fmt(tokenExpiresAt)} — reconecte.` };
  }
  if (tokenExpiresAt && tokenExpiresAt.getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000) {
    return { state: "EXPIRING", reason: `Token vence em ${fmt(tokenExpiresAt)} — reconecte antes disso.` };
  }
  return { state: "ONLINE", reason: null };
}
