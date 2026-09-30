import { prisma } from "@/lib/prisma";
import { evolutionSendText, evolutionGetMediaBase64 } from "@/lib/evolution";
import { getOpenAIConfig, transcribeAudio } from "@/lib/openai";
import { runPersonalAssistant } from "./engine";
import { userCanUseAssistant } from "./access";
import { syncGroupsIgnore } from "./groups";

/**
 * Porta WhatsApp do assistente pessoal.
 *
 * O usuário cria um grupo só com ele, gera um código de pareamento no perfil
 * e manda o código no grupo. A partir daí, tudo que ele mandar ali (texto ou
 * áudio) vai pro engine e a resposta volta no mesmo grupo, prefixada com 🤖.
 *
 * Num grupo só com o dono, TODA mensagem chega como fromMe — inclusive a nossa
 * resposta. Por isso: (1) ids das mensagens que enviamos ficam num Set e
 * (2) toda resposta começa com o marcador. Qualquer um dos dois = eco, ignora.
 */

export const ASSISTANT_MARK = "🤖";
const PAIR_RE = /\bGOHUB-([A-Z0-9]{4,8})\b/i;
const PAIR_TTL_MIN = 15;

const g = globalThis as unknown as { __paSent?: Set<string>; __paQueue?: Map<string, Promise<void>> };
const sentIds: Set<string> = g.__paSent ?? (g.__paSent = new Set());
const queues: Map<string, Promise<void>> = g.__paQueue ?? (g.__paQueue = new Map());

function rememberSent(id: string | null | undefined) {
  if (!id) return;
  sentIds.add(id);
  if (sentIds.size > 500) { const first = sentIds.values().next().value; if (first) sentIds.delete(first); }
}

/** Gera um código de pareamento pro usuário (válido por 15 min). */
export async function createPairingCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  const full = `GOHUB-${code}`;
  const expiresAt = new Date(Date.now() + PAIR_TTL_MIN * 60_000);
  await prisma.setting.upsert({
    where: { key: `assistant_pair:${full}` },
    update: { value: JSON.stringify({ userId, exp: expiresAt.getTime() }) },
    create: { key: `assistant_pair:${full}`, value: JSON.stringify({ userId, exp: expiresAt.getTime() }) },
  });
  return { code: full, expiresAt };
}

async function tryPair(text: string, instanceName: string, groupJid: string): Promise<boolean> {
  const m = text.match(PAIR_RE);
  if (!m) return false;
  const full = `GOHUB-${m[1].toUpperCase()}`;
  const row = await prisma.setting.findUnique({ where: { key: `assistant_pair:${full}` } });
  if (!row) return false;
  let parsed: { userId: string; exp: number } | null = null;
  try { parsed = JSON.parse(row.value); } catch { parsed = null; }
  await prisma.setting.delete({ where: { key: row.key } }).catch(() => {});
  if (!parsed || parsed.exp < Date.now()) return false;

  const inst = await prisma.whatsappInstance.findFirst({ where: { instanceName }, select: { id: true, instanceToken: true, companyId: true } });
  if (!inst) return false;
  const user = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { id: true, name: true, companyId: true, role: true } });
  if (!user) return false;
  // SUPER_ADMIN (Lazzari) não pertence a empresa nenhuma — o assistente não
  // teria onde agir. Quem opera é o usuário ADMIN da empresa-cliente.
  if (!user.companyId) {
    await safeSend(instanceName, groupJid, `${ASSISTANT_MARK} Esse usuário (${user.name}) não está vinculado a nenhuma empresa, então não tenho onde agir. Gere o código logado com o usuário da sua empresa (ex.: o admin da agência) e mande aqui de novo.`, inst.instanceToken);
    return true;
  }
  if (!(await userCanUseAssistant(user.id))) {
    await safeSend(instanceName, groupJid, `${ASSISTANT_MARK} O assistente pessoal não está liberado para a sua empresa.`, inst.instanceToken);
    return true;
  }
  // Instância precisa ser da empresa do usuário (SUPER_ADMIN pode qualquer).
  if (user.role !== "SUPER_ADMIN" && user.companyId !== inst.companyId) {
    await safeSend(instanceName, groupJid, `${ASSISTANT_MARK} Essa instância não pertence à sua empresa. Use uma instância da ${user.companyId ? "sua empresa" : "empresa"}.`, inst.instanceToken);
    return true;
  }
  // Um grupo pertence a UM usuário: parear de novo com outro login (ex.:
  // SUPER_ADMIN antes, admin da empresa depois) desfaz o vínculo anterior —
  // senão o findFirst do dispatcher continua caindo no usuário antigo.
  await prisma.$transaction([
    prisma.user.updateMany({ where: { assistantGroupJid: groupJid, id: { not: user.id } }, data: { assistantGroupJid: null, assistantInstanceId: null } }),
    prisma.user.update({ where: { id: user.id }, data: { assistantGroupJid: groupJid, assistantInstanceId: inst.id } }),
  ]);
  // Garante que a Evolution siga entregando grupos nesta instância mesmo se o
  // toggle "Grupos" for desligado depois (o webhook filtra os demais).
  void syncGroupsIgnore(inst.id);
  await safeSend(instanceName, groupJid,
    `${ASSISTANT_MARK} Pronto, ${user.name.split(" ")[0]}! Este grupo agora é o seu assistente pessoal do GoHub.\n\nPode mandar texto ou áudio:\n• "anota: ideia de campanha pro cliente X"\n• "me lembra amanhã 9h de ligar pro Fulano"\n• "abre chamado pra Padaria: revisar banner, quinta 15h"\n• "o que tenho pra hoje?"`,
    inst.instanceToken);
  return true;
}

async function safeSend(instanceName: string, jid: string, text: string, token?: string | null) {
  try {
    const res = await evolutionSendText(instanceName, jid, text, token);
    rememberSent(res?.key?.id ?? res?.id ?? null);
  } catch (e) {
    console.error("[assistente/wa] falha ao enviar:", e);
  }
}

/** Envia uma mensagem do assistente pro grupo do usuário (lembretes, resumo das 8h). */
export async function sendAssistantMessage(userId: string, text: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { assistantGroupJid: true, assistantInstanceId: true } });
  if (!user?.assistantGroupJid || !user.assistantInstanceId) return false;
  const inst = await prisma.whatsappInstance.findUnique({ where: { id: user.assistantInstanceId }, select: { instanceName: true, instanceToken: true, status: true } });
  if (!inst) return false;
  const body = text.startsWith(ASSISTANT_MARK) ? text : `${ASSISTANT_MARK} ${text}`;
  await safeSend(inst.instanceName, user.assistantGroupJid, body, inst.instanceToken);
  return true;
}

/**
 * Chamado pelo webhook pra TODA mensagem de grupo, antes do desvio fromMe.
 * Retorna true se a mensagem era do assistente pessoal (webhook deve parar).
 */
export async function handlePersonalAssistantWebhook(args: {
  instanceName: string;
  groupJid: string;
  messageId: string | null;
  text: string | null;
  isAudio: boolean;
  fromMe: boolean;
  rawData: any;
}): Promise<boolean> {
  const { instanceName, groupJid, messageId, isAudio, fromMe, rawData } = args;
  const text = (args.text ?? "").trim();

  // Eco da nossa própria resposta.
  if (messageId && sentIds.has(messageId)) return true;
  if (text.startsWith(ASSISTANT_MARK)) {
    const owner = await prisma.user.findFirst({ where: { assistantGroupJid: groupJid }, select: { id: true } });
    return !!owner;
  }

  // Pareamento (grupo ainda não vinculado).
  if (text && (await tryPair(text, instanceName, groupJid))) return true;

  const user = await prisma.user.findFirst({
    where: { assistantGroupJid: groupJid },
    select: { id: true, name: true, assistantInstanceId: true },
  });
  if (!user) return false;

  const inst = await prisma.whatsappInstance.findFirst({ where: { instanceName }, select: { id: true, instanceToken: true } });
  if (!inst) return true;
  // Grupo vinculado a outra instância: ignora (evita duas instâncias respondendo).
  if (user.assistantInstanceId && user.assistantInstanceId !== inst.id) return true;
  // Só o dono fala com o assistente. No grupo solo é sempre fromMe; se alguém
  // mais entrar no grupo, a mensagem dessa pessoa é ignorada.
  if (!fromMe) return true;
  // Exceção revogada depois do pareamento: silencia sem quebrar o webhook.
  if (!(await userCanUseAssistant(user.id))) return true;

  const job = async () => {
    let content: string | null = text;
    if (isAudio) {
      content = await transcribeFromWebhook(instanceName, inst.instanceToken, messageId, groupJid, rawData);
      if (!content) {
        await safeSend(instanceName, groupJid, `${ASSISTANT_MARK} Não consegui transcrever o áudio. Pode mandar em texto?`, inst.instanceToken);
        return;
      }
    }
    // Placeholder de mídia sem texto ("🖼️ Imagem", documento etc.)
    if (!content || /^(🖼️|📄|🎥|📎)/.test(content)) return;

    const result = await runPersonalAssistant({ userId: user.id, channel: "WHATSAPP", text: content });
    const prefix = isAudio ? `_🎙️ "${content.slice(0, 120)}${content.length > 120 ? "…" : ""}"_\n\n` : "";
    const reply = result.ok ? result.reply : `Ops: ${result.error}`;
    await safeSend(instanceName, groupJid, `${ASSISTANT_MARK} ${prefix}${reply}`, inst.instanceToken);
  };

  // Fila por usuário: mensagens em sequência não se atropelam.
  const prev = queues.get(user.id) ?? Promise.resolve();
  const next = prev.then(job).catch((e) => console.error("[assistente/wa] job falhou:", e));
  queues.set(user.id, next);
  void next.finally(() => { if (queues.get(user.id) === next) queues.delete(user.id); });
  return true;
}

async function transcribeFromWebhook(instanceName: string, token: string | null, messageId: string | null, groupJid: string, rawData: any): Promise<string | null> {
  if (!messageId) return null;
  const openai = await getOpenAIConfig();
  if (!openai) return null;
  const media = await evolutionGetMediaBase64(instanceName, { id: messageId, remoteJid: groupJid, fromMe: true }, token, rawData);
  if (!media?.base64) return null;
  return transcribeAudio(openai, media.base64, media.mimetype, { prompt: "Mensagem de voz para um assistente pessoal: tarefas, lembretes, clientes, projetos, chamados." });
}
