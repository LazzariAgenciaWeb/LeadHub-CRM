import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getOpenAIConfig, chatCompletion } from "@/lib/openai";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Conv {
  phone: string;
  contactName: string | null;
  instanceName: string | null;
  totalMessages: number;
  inboundCount: number;
  outboundCount: number;
  isAnswered: boolean;
  responseTimeMinutes: number | null;
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
}

interface OpenTicket {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
}

interface InstanceStat {
  name: string;
  total: number;
  respondidas: number;
  taxaResposta: number;
}

interface ChatContext {
  yesterdayConvs: Conv[];
  pendingLeads: PendingLead[];
  stalledOpps: StalledOpp[];
  openTickets: OpenTicket[];
  instanceStats: InstanceStat[];
  periodLabel: string;
}

function buildContextText(ctx: ChatContext): string {
  const lines: string[] = ["=== DADOS ATUAIS DO SISTEMA ==="];
  lines.push(`Referência: ${ctx.periodLabel}`);

  const totalConvs = ctx.yesterdayConvs.length;
  const answered = ctx.yesterdayConvs.filter((c) => c.isAnswered).length;
  const pending = totalConvs - answered;
  const taxaMedia =
    totalConvs > 0 ? Math.round((answered / totalConvs) * 100) : 0;

  lines.push(
    `\nRESUMO DE ONTEM: ${totalConvs} conversas | ${answered} respondidas (${taxaMedia}%) | ${pending} sem resposta`
  );

  if (ctx.yesterdayConvs.length > 0) {
    lines.push(`\nCONVERSAS DE ONTEM (${ctx.yesterdayConvs.length}):`);
    for (const c of ctx.yesterdayConvs.slice(0, 25)) {
      const name = c.contactName ?? c.phone;
      const resp = c.isAnswered
        ? c.responseTimeMinutes !== null
          ? `respondido em ${c.responseTimeMinutes}min`
          : "respondido"
        : "SEM RESPOSTA";
      const inst = c.instanceName ? ` | via ${c.instanceName}` : "";
      lines.push(`- ${name}${inst} | ${c.totalMessages} msgs | ${resp}`);
    }
  }

  if (ctx.pendingLeads.length > 0) {
    lines.push(`\nRETORNOS PENDENTES (${ctx.pendingLeads.length}):`);
    for (const l of ctx.pendingLeads.slice(0, 15)) {
      const name = l.name ?? l.phone;
      const stage =
        [l.pipeline, l.pipelineStage].filter(Boolean).join(" → ") ||
        "sem etapa";
      const ret = l.expectedReturnAt
        ? new Date(l.expectedReturnAt).toLocaleDateString("pt-BR")
        : "data não definida";
      lines.push(
        `- ${name} | ${stage} | Status: ${l.attendanceStatus ?? "—"} | Retorno: ${ret}`
      );
    }
  }

  if (ctx.stalledOpps.length > 0) {
    lines.push(`\nOPORTUNIDADES PARADAS +7 DIAS (${ctx.stalledOpps.length}):`);
    for (const o of ctx.stalledOpps.slice(0, 10)) {
      const name = o.name ?? o.phone;
      lines.push(`- ${name} | Etapa: ${o.pipelineStage ?? "—"}`);
    }
  }

  if (ctx.openTickets.length > 0) {
    lines.push(`\nCHAMADOS ABERTOS (${ctx.openTickets.length}):`);
    for (const t of ctx.openTickets.slice(0, 10)) {
      lines.push(`- [${t.priority}] ${t.title} | ${t.status}`);
    }
  }

  if (ctx.instanceStats.length > 0) {
    lines.push(`\nINSTÂNCIAS WhatsApp (últimos 30 dias):`);
    for (const s of ctx.instanceStats) {
      lines.push(
        `- ${s.name}: ${s.total} conversas, ${s.taxaResposta}% respondidas`
      );
    }
  }

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const config = await getOpenAIConfig();
  if (!config) {
    return NextResponse.json(
      { error: "OpenAI não configurada. Acesse Configurações → Integrações → OpenAI." },
      { status: 503 }
    );
  }

  const body = await req.json() as {
    question: string;
    context: ChatContext;
    history?: ChatMessage[];
  };

  const { question, context, history } = body;

  if (!question?.trim()) {
    return NextResponse.json({ error: "Pergunta vazia." }, { status: 400 });
  }

  const contextText = buildContextText(context);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    {
      role: "system",
      content: `Você é o assistente de atendimento de um CRM. Responda perguntas sobre os dados abaixo de forma direta e útil, em português brasileiro. Se não encontrar informação suficiente nos dados, diga claramente. Não invente dados.\n\n${contextText}`,
    },
  ];

  // Include recent conversation history (last 6 messages)
  if (history?.length) {
    for (const msg of history.slice(-6)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: "user", content: question });

  const rawResult = await chatCompletion(config, messages, {
    maxTokens: 500,
    temperature: 0.5,
  });

  if (!rawResult) {
    return NextResponse.json({ error: "A IA não retornou resposta." }, { status: 502 });
  }

  return NextResponse.json({ answer: rawResult });
}
