import { type ToolDef, ok, fail } from "./types";

/**
 * Avisar o usuário no grupo do WhatsApp. Pensado pro MCP: uma rotina do
 * Claude (ex.: varredura do Gmail, pauta de reels) manda o resumo direto pro
 * grupo, sem o usuário precisar abrir o Claude. No chat/WhatsApp o modelo não
 * precisa dela (a resposta já vai pro canal) — por isso só entra na lista do
 * MCP (ver registry).
 */
export const avisarNoWhatsapp: ToolDef<{ text: string }> = {
  name: "avisar_no_whatsapp",
  description:
    "Envia uma mensagem para o grupo pessoal do usuário no WhatsApp (o canal do assistente). Use para entregar resumos, alertas ou resultados de rotinas (ex.: 'resumo do Gmail', 'reels novo pra gravar'). Formatação do WhatsApp: *negrito*, sem markdown. Máx. 8000 caracteres (mensagens longas, como roteiros, são divididas em partes).",
  input_schema: {
    type: "object",
    properties: { text: { type: "string", description: "Texto da mensagem" } },
    required: ["text"],
  },
  mutating: true,
  run: async ({ text }, ctx) => {
    const t = (text ?? "").trim();
    if (!t) return fail("Texto vazio.");
    const { sendAssistantMessage } = await import("@/lib/personal-assistant/whatsapp");
    const sent = await sendAssistantMessage(ctx.userId, t.slice(0, 8000));
    if (!sent) return fail("Usuário sem grupo do WhatsApp vinculado (Meu Perfil → Assistente pessoal).");
    return ok("Mensagem enviada no WhatsApp.");
  },
};
