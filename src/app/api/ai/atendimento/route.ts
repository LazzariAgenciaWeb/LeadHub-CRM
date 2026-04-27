import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getOpenAIConfig, chatCompletion } from "@/lib/openai";

interface Metrics {
  total: number;
  respondidas: number;
  pendentes: number;
  taxaResposta: number;
  avgResponseMin: number;
}

interface InstanceStat {
  name: string;
  total: number;
  respondidas: number;
  taxaResposta: number;
}

interface PendingConv {
  contactName: string | null;
  phone: string;
  instanceName: string | null;
  minutesSinceLastMsg: number;
}

interface PendingLead {
  id: string;
  name: string | null;
  phone: string;
  expectedReturnAt: string | null;
  pipeline: string | null;
  pipelineStage: string | null;
  attendanceStatus: string | null;
}

interface StalledOpp {
  id: string;
  name: string | null;
  phone: string;
  pipelineStage: string | null;
  updatedAt: string;
  attendanceStatus: string | null;
}

interface OpenTicket {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
}

interface RequestBody {
  periodLabel: string;
  metrics: Metrics;
  instanceStats: InstanceStat[];
  pendingConvs: PendingConv[];
  pendingLeads: PendingLead[];
  stalledOpps: StalledOpp[];
  openTickets: OpenTicket[];
}

function fmtResponseTime(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Verificar módulo IA e permissão canUseAI
  const _aiRole = (session.user as any)?.role;
  const _aiModules = (session.user as any)?.modules;
  const _aiPerms = (session.user as any)?.permissions;
  const _hasAI = _aiRole === "SUPER_ADMIN" || _aiRole === "ADMIN" || (_aiModules?.ai && _aiPerms?.canUseAI);
  if (!_hasAI) return NextResponse.json({ error: "Módulo IA não disponível" }, { status: 403 });

  const config = await getOpenAIConfig();
  if (!config) {
    return NextResponse.json(
      { error: "OpenAI não configurada. Acesse Configurações → Integrações → OpenAI." },
      { status: 503 }
    );
  }

  const body = (await req.json()) as RequestBody;
  const { periodLabel, metrics, instanceStats, pendingConvs, pendingLeads, stalledOpps, openTickets } = body;

  // Build structured text summary
  const lines: string[] = [];

  lines.push(`=== RELATÓRIO DE ATENDIMENTO — ${periodLabel} ===`);
  lines.push("");
  lines.push("MÉTRICAS GERAIS:");
  lines.push(`- Total de conversas: ${metrics.total}`);
  lines.push(`- Respondidas: ${metrics.respondidas} (${metrics.taxaResposta}%)`);
  lines.push(`- Pendentes sem resposta: ${metrics.pendentes}`);
  lines.push(`- Tempo médio de primeira resposta: ${metrics.avgResponseMin > 0 ? fmtResponseTime(metrics.avgResponseMin) : "sem dados"}`);

  if (instanceStats.length > 0) {
    lines.push("");
    lines.push("DESEMPENHO POR INSTÂNCIA:");
    for (const inst of instanceStats) {
      lines.push(`- ${inst.name}: ${inst.total} conversas, ${inst.respondidas} respondidas (${inst.taxaResposta}%)`);
    }
  }

  if (pendingConvs.length > 0) {
    lines.push("");
    lines.push(`CONVERSAS PENDENTES SEM RESPOSTA (${pendingConvs.length}):`);
    for (const c of pendingConvs) {
      const name = c.contactName ?? c.phone;
      const inst = c.instanceName ? ` via ${c.instanceName}` : "";
      lines.push(`- ${name}${inst}: sem resposta há ${fmtResponseTime(c.minutesSinceLastMsg)}`);
    }
  } else {
    lines.push("");
    lines.push("CONVERSAS PENDENTES: nenhuma — todas respondidas.");
  }

  if (pendingLeads.length > 0) {
    lines.push("");
    lines.push(`LEADS COM RETORNO PENDENTE (${pendingLeads.length}):`);
    for (const l of pendingLeads) {
      const name = l.name ?? l.phone;
      const stage = [l.pipeline, l.pipelineStage].filter(Boolean).join(" → ");
      lines.push(`- ${name} | ${stage || "sem etapa"} | Status: ${l.attendanceStatus ?? "—"}`);
    }
  }

  if (stalledOpps.length > 0) {
    lines.push("");
    lines.push(`OPORTUNIDADES PARADAS +7 DIAS (${stalledOpps.length}):`);
    for (const o of stalledOpps) {
      lines.push(`- ${o.name ?? o.phone} | Etapa: ${o.pipelineStage ?? "—"}`);
    }
  }

  if (openTickets.length > 0) {
    lines.push("");
    lines.push(`CHAMADOS ABERTOS (${openTickets.length}):`);
    for (const t of openTickets) {
      lines.push(`- [${t.priority}] ${t.title} | Status: ${t.status}`);
    }
  }

  const userContent = lines.join("\n");

  const rawResult = await chatCompletion(
    config,
    [
      {
        role: "system",
        content:
          'Você é um assistente de qualidade de atendimento de um CRM. Analise os dados de atendimento e responda SEMPRE com JSON válido no formato exato: {"rating":"Excelente|Boa|Atenção|Crítico","ratingEmoji":"🟢|🟡|🟠|🔴","ratingColor":"green|yellow|orange|red","highlights":["...","..."],"attention":["...","..."],"actions":["...","..."]}. highlights = 2-3 pontos positivos. attention = 2-3 pontos que precisam atenção. actions = até 3 ações imediatas recomendadas. Seja direto e objetivo. Escreva em português brasileiro.',
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    { maxTokens: 600, temperature: 0.4 }
  );

  if (!rawResult) {
    return NextResponse.json({ error: "A IA não retornou resposta." }, { status: 502 });
  }

  try {
    const clean = rawResult.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);

    const now = new Date();
    const generatedAt = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    return NextResponse.json({ ...parsed, generatedAt });
  } catch {
    return NextResponse.json({ error: "Resposta da IA em formato inválido." }, { status: 502 });
  }
}
