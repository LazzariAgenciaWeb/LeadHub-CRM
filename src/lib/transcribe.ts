import { prisma } from "./prisma";
import { evolutionGetMediaBase64 } from "./evolution";
import { getOpenAIConfig } from "./openai";
import { effectiveFeatures, MODULE_BY_ID } from "./modules";
import type { PlanTier, PlanFeatures } from "./plans";

/**
 * Transcrição de áudio do WhatsApp — INTERNA.
 *
 * O texto fica só no GoHub, embaixo do player: serve pra ler o recado do
 * cliente sem parar tudo pra ouvir, e pra poder buscar/copiar o que foi dito.
 * Nada é enviado de volta ao WhatsApp.
 *
 * Caro? Pouco: ~US$ 0,006 por minuto de áudio (whisper-1). Mesmo assim há
 * trava de duração e só áudio RECEBIDO é transcrito automaticamente.
 */

const MAX_SECONDS = 10 * 60;       // áudio maior que isso: só sob demanda
const MAX_B64_CHARS = 32_000_000;  // ~24MB binário (limite da API é 25MB)
const CACHE_MAX_B64_CHARS = 640_000; // mesmo teto do /media — não voltar ao OOM

export interface TranscribeResult {
  ok: boolean;
  transcript?: string | null;
  error?: string;
}

/** Duração em segundos, quando o payload da Evolution traz (audioMessage.seconds) */
function audioSeconds(rawPayload: unknown): number | null {
  const raw = rawPayload as any;
  const audio = raw?.data?.message?.audioMessage ?? raw?.message?.audioMessage;
  const secs = audio?.seconds;
  return typeof secs === "number" && secs > 0 ? secs : null;
}

export async function transcribeAudioMessage(
  messageId: string,
  opts?: { force?: boolean },
): Promise<TranscribeResult> {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true, direction: true, mediaType: true, mediaBase64: true,
      transcript: true, transcriptAt: true,
      externalId: true, phone: true, participantPhone: true, rawPayload: true,
      instance: { select: { instanceName: true, instanceToken: true } },
    },
  });
  if (!msg) return { ok: false, error: "Mensagem não encontrada" };
  if (!msg.mediaType?.startsWith("audio/")) return { ok: false, error: "A mensagem não é um áudio" };
  if (msg.transcript && !opts?.force) return { ok: true, transcript: msg.transcript };

  const config = await getOpenAIConfig();
  if (!config) return { ok: false, error: "OpenAI não configurada (Configurações → Integrações)" };

  const secs = audioSeconds(msg.rawPayload);
  if (secs && secs > MAX_SECONDS && !opts?.force) {
    return { ok: false, error: `Áudio longo (${Math.round(secs / 60)} min) — transcreva sob demanda` };
  }

  // Bytes do áudio: o que já está no banco, senão busca na Evolution.
  let base64 = msg.mediaBase64;
  let mime = msg.mediaType;
  if (!base64 && msg.instance && msg.externalId) {
    const raw: any = msg.rawPayload as any;
    const rawData = raw?.data ?? (raw?.key && raw?.message ? raw : undefined);
    const fetched = await evolutionGetMediaBase64(
      msg.instance.instanceName,
      {
        id: msg.externalId,
        remoteJid: msg.phone,
        fromMe: msg.direction === "OUTBOUND",
        participant: msg.participantPhone ?? undefined,
      },
      msg.instance.instanceToken,
      rawData,
    );
    if (fetched?.base64) {
      base64 = fetched.base64;
      mime = fetched.mimetype ?? mime;
      if (fetched.base64.length <= CACHE_MAX_B64_CHARS) {
        void prisma.message.update({
          where: { id: msg.id },
          data: { mediaBase64: fetched.base64 },
        }).catch(() => {});
      }
    }
  }
  if (!base64) return { ok: false, error: "Não consegui baixar o áudio da Evolution" };
  if (base64.length > MAX_B64_CHARS) return { ok: false, error: "Áudio grande demais para transcrever" };

  const model = await transcribeModel();
  const buf = Buffer.from(base64, "base64");
  const ext = (mime ?? "audio/ogg").includes("mp4") ? "m4a"
            : (mime ?? "").includes("mpeg") ? "mp3"
            : (mime ?? "").includes("wav") ? "wav"
            : "ogg";

  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: mime ?? "audio/ogg" }), `audio.${ext}`);
    form.append("model", model);
    form.append("language", "pt");
    form.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const err = (await res.text()).slice(0, 300);
      // Marca a tentativa pra não repetir automaticamente em loop; o botão
      // "Transcrever" da conversa continua podendo forçar.
      await prisma.message.update({ where: { id: msg.id }, data: { transcriptAt: new Date() } }).catch(() => {});
      console.warn(`[transcrição] msg ${msg.id}: ${res.status} ${err}`);
      return { ok: false, error: `OpenAI ${res.status}` };
    }
    const data = await res.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";

    await prisma.message.update({
      where: { id: msg.id },
      data: { transcript: text || null, transcriptAt: new Date() },
    });
    console.log(`[transcrição] msg ${msg.id}: ${text.length} caracteres (${model})`);
    return { ok: true, transcript: text || null };
  } catch (err: any) {
    await prisma.message.update({ where: { id: msg.id }, data: { transcriptAt: new Date() } }).catch(() => {});
    return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
  }
}

/** Modelo de transcrição (Setting opcional; whisper-1 é o universalmente disponível) */
async function transcribeModel(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: "openai_transcribe_model" } }).catch(() => null);
  return row?.value?.trim() || "whisper-1";
}

/**
 * Gatilho automático do webhook: áudio RECEBIDO de empresa com o módulo de IA
 * liberado. Roda solto (sem await) — transcrição nunca pode atrasar nem
 * derrubar a ingestão da mensagem.
 */
export async function maybeAutoTranscribe(messageId: string, companyId: string) {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { subscription: { select: { plan: true, customFeatures: true } } },
    });
    const tier = (company?.subscription?.plan as PlanTier) ?? "FREE";
    const custom = (company?.subscription?.customFeatures as Partial<PlanFeatures> | null) ?? null;
    const features = effectiveFeatures(tier, custom);
    const def = MODULE_BY_ID["ai"];
    const keys = [def.primary, ...(def.alsoEnabledBy ?? [])];
    if (!keys.some((k) => features[k])) return; // empresa sem o módulo de IA → não gasta
    await transcribeAudioMessage(messageId);
  } catch (err) {
    console.warn("[transcrição] falha no gatilho automático:", err);
  }
}
