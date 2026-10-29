import { type ToolDef, ok, fail } from "./types";

/**
 * Avisar o usuário no grupo do WhatsApp. Pensado pro MCP: uma rotina do
 * Claude (ex.: varredura do Gmail, pauta de reels) manda o resumo direto pro
 * grupo, sem o usuário precisar abrir o Claude. No chat/WhatsApp o modelo não
 * precisa dela (a resposta já vai pro canal) — por isso só entra na lista do
 * MCP (ver registry).
 */
const URGENT_PER_DAY = 3;

/**
 * Rotinas mandando aviso a toda hora lotam o WhatsApp e o usuário para de olhar.
 * Por isso só o URGENTE sai na hora (até 3 por dia); o resto entra na fila e vai
 * junto, numa mensagem só, no resumo da manhã (ou no das 17h).
 */
export const avisarNoWhatsapp: ToolDef<{ text: string; urgente?: boolean }> = {
  name: "avisar_no_whatsapp",
  description:
    "Avisa o usuário no grupo pessoal do WhatsApp (o canal do assistente). Por padrão o aviso NÃO sai na hora: entra no resumo único da manhã (8h) ou das 17h, junto com os das outras rotinas — o usuário pediu menos mensagens. Só marque urgente=true quando algo quebra HOJE se ele não agir (site fora do ar, cliente bravo esperando, pagamento que corta serviço hoje); urgentes passam de 3 no dia também vão pro resumo. Roteiros/reels/pautas NUNCA são urgentes. Escreva curto: a 1ª linha é o título que aparece no resumo. Formatação do WhatsApp: *negrito*, sem markdown.",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Texto da mensagem (1ª linha = título curto)" },
      urgente: { type: "boolean", description: "true só se não pode esperar o próximo resumo. Padrão false." },
    },
    required: ["text"],
  },
  mutating: true,
  run: async ({ text, urgente }, ctx) => {
    const t = (text ?? "").trim();
    if (!t) return fail("Texto vazio.");
    const { prisma } = await import("@/lib/prisma");
    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const urgentSent = urgente
      ? await prisma.setting.findUnique({ where: { key: `assistant_urgent:${ctx.userId}` } }).then((r) => (r?.value ?? "").split(",").filter((ts) => Number(ts) > dayAgo.getTime()))
      : [];
    if (!urgente || urgentSent.length >= URGENT_PER_DAY) {
      await prisma.assistantDigestItem.create({ data: { userId: ctx.userId, text: t.slice(0, 8000) } });
      return ok(urgente
        ? "Limite de avisos urgentes do dia atingido — guardado pro próximo resumo (17h ou 8h). Não reenvie."
        : "Guardado pro próximo resumo do WhatsApp (8h ou 17h), junto com os outros avisos. Não reenvie.");
    }
    await prisma.setting.upsert({
      where: { key: `assistant_urgent:${ctx.userId}` },
      update: { value: [...urgentSent, String(Date.now())].join(",") },
      create: { key: `assistant_urgent:${ctx.userId}`, value: String(Date.now()) },
    });
    const { sendAssistantMessage } = await import("@/lib/personal-assistant/whatsapp");
    const sent = await sendAssistantMessage(ctx.userId, t.slice(0, 8000));
    if (!sent) return fail("Usuário sem grupo do WhatsApp vinculado (Meu Perfil → Assistente pessoal).");
    return ok("Aviso urgente enviado no WhatsApp.");
  },
};
