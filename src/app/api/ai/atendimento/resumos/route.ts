import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getOpenAIConfig, chatCompletion } from "@/lib/openai";
import { assertModule } from "@/lib/billing";

interface ConvInput {
  phone: string;
  contactName: string | null;
  instanceName: string | null;
  totalMessages: number;
  inboundCount: number;
  outboundCount: number;
  isAnswered: boolean;
  responseTimeMinutes: number | null;
  lastMessagePreview: string;
}

interface ResumoResult {
  phone: string;
  summary: string;
  quality: "excelente" | "bom" | "regular" | "ruim";
  qualityColor: "green" | "blue" | "yellow" | "red";
}

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // fix A3 — gate de módulo + feature do plano
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const _aiRole = (session.user as any)?.role;
  const _aiPerms = (session.user as any)?.permissions;
  const _canUse = _aiRole === "SUPER_ADMIN" || _aiRole === "ADMIN" || _aiPerms?.canUseAI;
  if (!_canUse) return NextResponse.json({ error: "Sem permissão para usar IA" }, { status: 403 });

  const config = await getOpenAIConfig();
  if (!config) {
    return NextResponse.json(
      { error: "OpenAI não configurada. Acesse Configurações → Integrações → OpenAI." },
      { status: 503 }
    );
  }

  const body = await req.json() as { conversations: ConvInput[]; periodLabel: string };
  const { conversations, periodLabel } = body;

  if (!conversations?.length) return NextResponse.json([]);

  // Limit to 30 conversations to keep token usage reasonable
  const convs = conversations.slice(0, 30);

  const convLines = convs
    .map((c, i) => {
      const name = c.contactName ?? c.phone;
      const resp = c.isAnswered
        ? c.responseTimeMinutes !== null
          ? `respondido em ${c.responseTimeMinutes}min`
          : "respondido"
        : "SEM RESPOSTA";
      const preview = c.lastMessagePreview
        ? ` | última msg: "${c.lastMessagePreview.slice(0, 80)}"`
        : "";
      return `[${i}] phone:"${c.phone}" | ${name} | ${c.totalMessages} msgs (${c.inboundCount}↓ ${c.outboundCount}↑) | ${resp}${preview}`;
    })
    .join("\n");

  const userContent = `Período: ${periodLabel}\n\nConversas:\n${convLines}\n\nRetorne um JSON array, um objeto por conversa:\n[{"index":0,"summary":"resumo direto em 1 frase","quality":"excelente|bom|regular|ruim","qualityColor":"green|blue|yellow|red"}]\nRegra de quality: excelente=respondido <15min, bom=respondido 15-60min, regular=respondido >60min, ruim=SEM RESPOSTA.\nSeja conciso. APENAS o array JSON, sem markdown.`;

  const rawResult = await chatCompletion(
    config,
    [
      {
        role: "system",
        content:
          "Você é um assistente de CRM que resume conversas de WhatsApp. Responda SEMPRE com JSON válido, sem markdown, sem explicações adicionais.",
      },
      { role: "user", content: userContent },
    ],
    { maxTokens: 1200, temperature: 0.3 }
  );

  if (!rawResult) {
    return NextResponse.json({ error: "A IA não retornou resposta." }, { status: 502 });
  }

  try {
    const clean = rawResult.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean) as {
      index: number;
      summary: string;
      quality: string;
      qualityColor: string;
    }[];

    const results: ResumoResult[] = parsed
      .filter((r) => convs[r.index])
      .map((r) => ({
        phone: convs[r.index].phone,
        summary: r.summary,
        quality: r.quality as ResumoResult["quality"],
        qualityColor: r.qualityColor as ResumoResult["qualityColor"],
      }));

    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: "Resposta da IA em formato inválido." }, { status: 502 });
  }
}
