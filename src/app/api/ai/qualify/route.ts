import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { runAssistant } from "@/lib/assistant";

// Bloco marcado dentro de Lead.notes — substituído a cada nova qualificação
// (evita crescer sem fim). Conteúdo do usuário fora do bloco é preservado.
const MARK_START = "[Qualificação IA]";
const MARK_END = "[/Qualificação IA]";

function upsertQualBlock(existing: string | null, block: string): string {
  const base = (existing ?? "").trim();
  const re = new RegExp(`${escapeRe(MARK_START)}[\\s\\S]*?${escapeRe(MARK_END)}`);
  const wrapped = `${MARK_START}\n${block}\n${MARK_END}`;
  if (re.test(base)) return base.replace(re, wrapped).trim();
  return base ? `${base}\n\n${wrapped}` : wrapped;
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJsonLoose(text: string): any | null {
  if (!text) return null;
  // remove cercas de código se vierem
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // tenta achar o primeiro objeto {...}
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

// POST /api/ai/qualify?phone=&companyId=  → extrai dados de qualificação da
// conversa e preenche o Lead (campos fixos). Retorna o resumo estruturado.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const role = (session.user as any)?.role;
  const perms = (session.user as any)?.permissions;
  const canUse = role === "SUPER_ADMIN" || role === "ADMIN" || perms?.canUseAI;
  if (!canUse) return NextResponse.json({ error: "Sem permissão para usar IA" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone");
  const companyId = searchParams.get("companyId");
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });
  if (!companyId) return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });

  const messages = await prisma.message.findMany({
    where: { phone, companyId },
    orderBy: { receivedAt: "desc" },
    take: 40,
    select: { body: true, direction: true },
  });
  messages.reverse();
  if (!messages.length) {
    return NextResponse.json({ error: "Sem mensagens nesta conversa." }, { status: 400 });
  }

  const chatLines = messages
    .map((m) => `${m.direction === "OUTBOUND" ? "Atendente" : "Cliente"}: ${m.body}`)
    .join("\n");

  const systemPrompt = `Você extrai dados de QUALIFICAÇÃO de uma conversa de atendimento comercial.
Leia o histórico e devolva APENAS um JSON válido (sem markdown, sem texto antes ou depois) com EXATAMENTE estas chaves:
{
  "nome": "nome do cliente, ou null",
  "servicoInteresse": "serviço/produto que ele demonstrou interesse, ou null",
  "objetivo": "objetivo ou dor principal do cliente, ou null",
  "observacoes": "detalhes relevantes coletados (prazo, contexto, links), ou null",
  "proximoPasso": "a ação mais útil agora para o atendente (ex.: enviar link de agendamento, fazer follow-up amanhã, aguardar resposta do cliente)",
  "resumo": "1 a 2 frases resumindo a demanda e o estágio da conversa"
}
Regras: use null quando a informação NÃO estiver clara na conversa. NUNCA invente dados. Responda só o JSON.`;

  const run = await runAssistant({
    companyId,
    endpoint: "qualify",
    userId: (session.user as any)?.id ?? null,
    temperature: 0.2,
    maxTokens: 400,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Histórico da conversa:\n${chatLines}\n\nExtraia o JSON de qualificação:` },
    ],
  });

  if (!run.ok) {
    const status = run.code === "QUOTA" ? 429 : run.code === "NO_CONFIG" ? 503 : 502;
    return NextResponse.json({ error: run.error, code: run.code }, { status });
  }

  const data = parseJsonLoose(run.text);
  if (!data) {
    return NextResponse.json({ error: "Não consegui estruturar os dados. Tente novamente." }, { status: 502 });
  }

  const nome = typeof data.nome === "string" ? data.nome.trim() : null;
  const servicoInteresse = typeof data.servicoInteresse === "string" ? data.servicoInteresse.trim() : null;
  const objetivo = typeof data.objetivo === "string" ? data.objetivo.trim() : null;
  const observacoes = typeof data.observacoes === "string" ? data.observacoes.trim() : null;
  const proximoPasso = typeof data.proximoPasso === "string" ? data.proximoPasso.trim() : null;
  const resumo = typeof data.resumo === "string" ? data.resumo.trim() : null;

  // Aplica no Lead (se existir). Atualiza nome se vazio + bloco de qualificação
  // em notes (não destrói conteúdo do usuário).
  const lead = await prisma.lead.findFirst({
    where: { phone, companyId },
    select: { id: true, name: true, notes: true },
  });

  let leadUpdated = false;
  if (lead) {
    const blockLines = [
      servicoInteresse && `Serviço de interesse: ${servicoInteresse}`,
      objetivo && `Objetivo: ${objetivo}`,
      observacoes && `Observações: ${observacoes}`,
      proximoPasso && `Próximo passo: ${proximoPasso}`,
      resumo && `Resumo: ${resumo}`,
    ].filter(Boolean).join("\n");

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        name: (!lead.name || !lead.name.trim()) && nome ? nome : undefined,
        notes: blockLines ? upsertQualBlock(lead.notes, blockLines) : undefined,
      },
    });
    leadUpdated = true;
  }

  return NextResponse.json({
    leadUpdated,
    hasLead: !!lead,
    data: { nome, servicoInteresse, objetivo, observacoes, proximoPasso, resumo },
    remaining: run.remaining,
  });
}
