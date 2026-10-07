import { S3Client, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand, CopyObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Storage de arquivos no MinIO (API S3-compatível).
//
// Dois clientes porque a assinatura da URL inclui o host:
//   - interno (S3_ENDPOINT): o servidor fala direto com o MinIO (HEAD/DELETE),
//     pode ser o hostname da rede Docker (ex.: http://minio:9000);
//   - público (S3_PUBLIC_ENDPOINT): gera as URLs assinadas que o NAVEGADOR usa
//     pra subir/baixar — precisa ser o domínio HTTPS exposto.
// O binário nunca passa pelo Next: upload vai direto do browser pro bucket.

const endpoint       = process.env.S3_ENDPOINT;
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint;
const region         = process.env.S3_REGION || "us-east-1";
const accessKeyId    = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false";

export const S3_BUCKET = process.env.S3_BUCKET || "gohub";

/** Tamanho máximo por arquivo (MB). */
export const MAX_FILE_BYTES = Number(process.env.S3_MAX_FILE_MB || 50) * 1024 * 1024;

/** Validade das URLs assinadas. */
const UPLOAD_TTL_SEC   = 5 * 60;
const DOWNLOAD_TTL_SEC = 10 * 60;

export function storageEnabled(): boolean {
  return !!(endpoint && accessKeyId && secretAccessKey);
}

let internalClient: S3Client | null = null;
let publicClient: S3Client | null = null;

function makeClient(url: string) {
  return new S3Client({
    endpoint: url,
    region,
    forcePathStyle,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
}

function internal() {
  if (!storageEnabled()) throw new Error("Storage (S3) não configurado");
  return (internalClient ??= makeClient(endpoint!));
}

function pub() {
  if (!storageEnabled()) throw new Error("Storage (S3) não configurado");
  return (publicClient ??= makeClient(publicEndpoint!));
}

/**
 * URL + campos pra upload via POST multipart direto do navegador. A policy
 * trava tamanho máximo e Content-Type — o browser não consegue mandar outro
 * arquivo com a mesma assinatura.
 */
export async function presignUpload(key: string, mimeType: string) {
  return createPresignedPost(pub(), {
    Bucket: S3_BUCKET,
    Key: key,
    Conditions: [
      ["content-length-range", 1, MAX_FILE_BYTES],
      ["eq", "$Content-Type", mimeType],
    ],
    Fields: { "Content-Type": mimeType },
    Expires: UPLOAD_TTL_SEC,
  });
}

/** URL temporária de leitura. `download` força "salvar como". */
export async function presignDownload(key: string, fileName: string, opts: { download?: boolean } = {}) {
  const disposition = `${opts.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  return getSignedUrl(
    pub(),
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key, ResponseContentDisposition: disposition }),
    { expiresIn: DOWNLOAD_TTL_SEC },
  );
}

/** Tamanho real do objeto no bucket, ou null se não existe. */
export async function headObjectSize(key: string): Promise<number | null> {
  try {
    const res = await internal().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return Number(res.ContentLength ?? 0);
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
    throw e;
  }
}

export async function deleteObject(key: string) {
  await internal().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/** Lê o objeto inteiro pro servidor (ex.: reenviar o anexo pro ClickUp). */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const r = await internal().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  if (!r.Body) throw new Error("Objeto vazio");
  return Buffer.from(await r.Body.transformToByteArray());
}

/** Copia um objeto dentro do bucket (ex.: anexo de chamado → biblioteca do cliente). */
export async function copyObject(fromKey: string, toKey: string) {
  const source = `${S3_BUCKET}/${fromKey.split("/").map(encodeURIComponent).join("/")}`;
  await internal().send(new CopyObjectCommand({ Bucket: S3_BUCKET, Key: toKey, CopySource: source }));
}

// ─── Objeto público (imagem de assinatura de email) ─────────────────────────
// Anexo usa URL assinada, que expira — serve pro navegador de quem está
// logado. Imagem de assinatura é outra história: ela é buscada pelo cliente
// de email de quem RECEBEU, meses depois, sem login. Por isso vai num prefixo
// de leitura anônima e a URL é direta, sem assinatura.

/** Prefixo com leitura pública (precisa da policy anônima no MinIO). */
export const PUBLIC_PREFIX = "public/";

/** Sobe um arquivo pequeno direto pelo servidor (sem passo no navegador). */
export async function putObject(key: string, body: Buffer, contentType: string) {
  await internal().send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType })
  );
}

/** URL direta e permanente do objeto (só funciona no prefixo público). */
export function publicObjectUrl(key: string): string {
  const base = (publicEndpoint ?? "").replace(/\/+$/, "");
  return forcePathStyle ? `${base}/${S3_BUCKET}/${key}` : `${base.replace("://", `://${S3_BUCKET}.`)}/${key}`;
}

/**
 * Confere se a URL abre SEM autenticação — é o que o cliente de email vai
 * fazer. Falso quando falta a policy anônima no bucket/prefixo.
 */
export async function isPubliclyReadable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, cache: "no-store" });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}
