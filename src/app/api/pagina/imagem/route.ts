import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { PUBLIC_PREFIX, publicObjectUrl, putObject, storageEnabled } from "@/lib/storage/s3";
import { ensureBioPage, requireBioEditor } from "@/lib/bio-page-server";

// POST /api/pagina/imagem (multipart, campo "file")
// Foto, capa e imagem de serviço da Página do Negócio. Vai pro prefixo público
// do MinIO: a página é aberta por qualquer visitante, sem login, então a URL
// precisa ser permanente (assinada expiraria). O editor já reduz a imagem no
// navegador antes de mandar — o limite aqui é a rede de segurança.

const MAX_BYTES = 1.5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function POST(req: NextRequest) {
  const auth = await requireBioEditor();
  if (!auth.ok) return auth.response;
  if (!storageEnabled()) {
    return NextResponse.json(
      { error: "Envio de imagens ainda não está disponível. Cole o link de uma imagem por enquanto." },
      { status: 503 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Use imagem JPG, PNG ou WebP." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Imagem grande demais (máx. 1,5 MB)." }, { status: 413 });

  const pageId = await ensureBioPage(auth.companyId);
  const key = `${PUBLIC_PREFIX}pagina/${pageId}/${randomUUID()}.${ext}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  return NextResponse.json({ url: publicObjectUrl(key) }, { status: 201 });
}
