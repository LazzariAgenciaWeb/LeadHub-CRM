import { NextRequest, NextResponse } from "next/server";
import { requireAssistantUser } from "@/lib/personal-assistant/session";
import { getOpenAIConfig, transcribeAudio } from "@/lib/openai";

/**
 * POST /api/assistente/transcrever  (multipart: file=<audio>)
 * Microfone do chat do app → Whisper → texto. Limite 10 MB.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const config = await getOpenAIConfig();
  if (!config) return NextResponse.json({ error: "OpenAI não configurada (transcrição de áudio)." }, { status: 503 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Envie multipart/form-data com o campo file" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "Arquivo ausente" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Áudio muito grande (máx. 10 MB)" }, { status: 413 });

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const text = await transcribeAudio(config, base64, file.type || "audio/webm", { prompt: "Mensagem de voz para um assistente pessoal: tarefas, lembretes, clientes, projetos, chamados." });
  if (!text) return NextResponse.json({ error: "Não foi possível transcrever o áudio." }, { status: 502 });
  return NextResponse.json({ text });
}
