import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import {
  PUBLIC_PREFIX, isPubliclyReadable, publicObjectUrl, putObject, storageEnabled,
} from "@/lib/storage/s3";

/** Imagem de assinatura é logo/foto: pequena de propósito (email tem limite). */
const MAX_BYTES = 1024 * 1024;
const TIPOS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

async function requireAdmin() {
  const session = await getEffectiveSession();
  if (!session) return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return { ok: false as const, res: gate.response };
  if ((session.user as any).role === "CLIENT") {
    return { ok: false as const, res: NextResponse.json({ error: "Somente administradores editam a assinatura" }, { status: 403 }) };
  }
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return { ok: false as const, res: NextResponse.json({ error: "Sem empresa" }, { status: 400 }) };
  return { ok: true as const, companyId };
}

// GET → a tela pergunta se o upload está disponível antes de mostrar o botão.
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx.ok) return ctx.res;
  return NextResponse.json({ enabled: storageEnabled() });
}

// POST { filename, contentType, contentBase64 } → sobe a imagem e devolve a
// URL permanente pra usar na assinatura.
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (!ctx.ok) return ctx.res;
  if (!storageEnabled()) {
    return NextResponse.json(
      { error: "Armazenamento de arquivos não configurado — use a URL de uma imagem já publicada." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const contentType = String(body?.contentType ?? "");
  const ext = TIPOS[contentType];
  if (!ext) return NextResponse.json({ error: "Use PNG, JPG, GIF ou WEBP" }, { status: 400 });

  const base64 = String(body?.contentBase64 ?? "");
  if (!base64) return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 });
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "Imagem muito grande (máx 1 MB) — assinatura pede logo leve" }, { status: 400 });
  }

  const key = `${PUBLIC_PREFIX}assinaturas/${ctx.companyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    await putObject(key, buffer, contentType);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha ao enviar a imagem" }, { status: 500 });
  }

  // A imagem vai ser buscada pelo cliente de email de quem recebeu, sem
  // login. Se o prefixo não estiver com leitura anônima, ela chega quebrada —
  // melhor avisar agora do que o cliente descobrir depois.
  const url = publicObjectUrl(key);
  const publicOk = await isPubliclyReadable(url);

  return NextResponse.json({
    url,
    publicOk,
    ...(publicOk
      ? {}
      : {
          aviso:
            "A imagem subiu, mas o servidor de arquivos ainda não libera leitura pública — ela apareceria quebrada pra quem receber. " +
            "Libere o prefixo (no MinIO: mc anonymous set download LOCAL/<bucket>/public) ou use a URL de uma imagem do site.",
        }),
  });
}
