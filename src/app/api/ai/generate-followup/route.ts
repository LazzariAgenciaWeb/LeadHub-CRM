import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { runAssistant, getActiveAssistant, getServicesCatalogBlock } from "@/lib/assistant";

// POST /api/ai/generate-followup  body { leadId }
// Gera uma mensagem PROATIVA de follow-up para reativar a negociação, levando em
// conta o estado dela (tempo parado, quem falou por último, clicou no link de
// diagnóstico). Modo sugestão — devolve a mensagem pronta pra enviar.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const role = (session.user as any)?.role;
  const perms = (session.user as any)?.permissions;
  const canUse = role === "SUPER_ADMIN" || role === "ADMIN" || perms?.canUseAI;
  if (!canUse) return NextResponse.json({ error: "Sem permissão para usar IA" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const leadId = body.leadId as string | undefined;
  if (!leadId) return NextResponse.json({ error: "leadId obrigatório" }, { status: 400 });

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, name: true, phone: true, companyId: true,
      pipeline: true, pipelineStage: true,
      diagnosisClickedAt: true, updatedAt: true,
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  const sessionCompanyId = (session.user as any)?.companyId as string | undefined;
  if (role !== "SUPER_ADMIN" && lead.companyId !== sessionCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const companyId = lead.companyId;

  // Histórico da conversa (por telefone) + sinais de engajamento.
  const messages = await prisma.message.findMany({
    where: { phone: lead.phone, companyId },
    orderBy: { receivedAt: "desc" },
    take: 20,
    select: { body: true, direction: true, receivedAt: true },
  });
  messages.reverse();

  const last = messages[messages.length - 1];
  const daysSince = last
    ? Math.max(0, Math.floor((Date.now() - new Date(last.receivedAt).getTime()) / 86400000))
    : null;
  const lastWasClient = last?.direction === "INBOUND";

  // Monta o diagnóstico do estado da negociação (alimenta o prompt e a UI).
  const estadoLinhas = [
    `Lead: ${lead.name ?? lead.phone}`,
    `Estágio: ${lead.pipeline ?? "—"}${lead.pipelineStage ? ` / ${lead.pipelineStage}` : ""}`,
    daysSince === null
      ? "Sem mensagens registradas na conversa."
      : `Última mensagem há ${daysSince} dia(s) — ${lastWasClient ? "o CLIENTE foi o último a falar (pode estar esperando retorno)" : "NÓS fomos os últimos a falar (cliente ainda não respondeu)"}.`,
    lead.diagnosisClickedAt
      ? "O cliente CLICOU no link de diagnóstico — demonstrou interesse recente."
      : null,
  ].filter(Boolean) as string[];
  const estado = estadoLinhas.join("\n");

  const chatLines = messages
    .map((m) => `${m.direction === "OUTBOUND" ? "Atendente" : "Cliente"}: ${m.body}`)
    .join("\n") || "(sem histórico de mensagens)";

  // Prompt do agente VENDAS (manual + catálogo + link) + instruções de follow-up.
  const assistant = await getActiveAssistant(companyId, "VENDAS");
  const catalogBlock = await getServicesCatalogBlock(companyId);
  const manual = assistant?.manual?.trim()
    || "Você é um assistente comercial que ajuda a retomar negociações via WhatsApp.";
  const link = assistant?.schedulingLink?.trim();
  const linkBlock = link
    ? `\n\n# LINK DE AGENDAMENTO (se for marcar reunião, envie EXATAMENTE este link, sem alterar):\n${link}`
    : "";

  const followupInstr = `\n\n# TAREFA: RESUMIR A NEGOCIAÇÃO + GERAR FOLLOW-UP
Analise a conversa e responda APENAS um JSON válido (sem markdown, sem texto fora do JSON) com EXATAMENTE estas chaves:
{
  "resumo": "1 a 2 frases: o que está sendo negociado, em que estágio, e o sinal mais relevante (ex.: clicou no link, não responde há X dias)",
  "mensagem": "a mensagem de follow-up de WhatsApp pronta pra enviar"
}
Regras da "mensagem": 1 a 2 frases curtas (~130 caracteres), use emoji se o manual pedir, respeite TODAS as proibições do manual (NUNCA informe preço). Se fizer sentido marcar reunião, inclua o link de agendamento. NÃO invente dados que não estejam na conversa.`;

  const systemPrompt = manual + catalogBlock + linkBlock + followupInstr;

  const run = await runAssistant({
    companyId,
    endpoint: "generate-followup",
    assistantId: assistant?.id ?? null,
    userId: (session.user as any)?.id ?? null,
    model: assistant?.model ?? null,
    temperature: assistant?.temperature ?? 0.4,
    maxTokens: 320,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Estado da negociação:\n${estado}\n\nÚltimas mensagens:\n${chatLines}\n\nResponda o JSON (resumo + mensagem):`,
      },
    ],
  });

  if (!run.ok) {
    const status = run.code === "QUOTA" ? 429 : run.code === "NO_CONFIG" ? 503 : 502;
    return NextResponse.json({ error: run.error, code: run.code }, { status });
  }

  // Parse defensivo do JSON {resumo, mensagem}. Se falhar, usa o texto cru como
  // mensagem (não quebra o fluxo).
  const parsed = parseJsonLoose(run.text);
  const resumo = typeof parsed?.resumo === "string" ? parsed.resumo.trim() : null;
  const message = typeof parsed?.mensagem === "string" ? parsed.mensagem.trim() : run.text;

  return NextResponse.json({
    resumo,
    message,
    diagnostico: estadoLinhas,
    phone: lead.phone,
    remaining: run.remaining,
  });
}

function parseJsonLoose(text: string | null): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* tenta extrair {...} */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}
