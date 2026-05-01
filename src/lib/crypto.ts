/**
 * Criptografia simétrica para o Cofre de Credenciais.
 *
 * Algoritmo: AES-256-GCM (autenticado, evita tampering).
 * Chave mestra: variável de ambiente ENCRYPTION_KEY (32 bytes / 256 bits).
 *   - Aceita formato hex (64 chars) ou base64 (44 chars).
 *   - Gere com: `openssl rand -hex 32` ou `openssl rand -base64 32`.
 *
 * Formato armazenado no banco (string base64):
 *   base64( IV[12] || AUTH_TAG[16] || CIPHERTEXT[N] )
 *
 * NUNCA logar texto claro. NUNCA enviar a chave para o cliente.
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;       // recomendado para GCM
const AUTH_TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY ausente no .env. Gere com: openssl rand -hex 32"
    );
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    // assume base64
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      throw new Error("ENCRYPTION_KEY inválida (esperado hex ou base64).");
    }
  }
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY deve ter 32 bytes (256 bits). Recebido: ${key.length} bytes.`
    );
  }
  cachedKey = key;
  return key;
}

/** Criptografa string em texto claro. Retorna base64 (IV|TAG|CIPHER). */
export function encryptSecret(plaintext: string): string {
  if (plaintext === "" || plaintext == null) return "";
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decriptografa string base64 (IV|TAG|CIPHER) para texto claro. */
export function decryptSecret(encoded: string): string {
  if (!encoded) return "";
  const key = loadKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + AUTH_TAG_LEN) {
    throw new Error("Payload criptografado inválido (curto demais).");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ct = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/** Versão "soft": tenta decriptar, retorna null em caso de erro (chave trocada, payload corrompido, etc.) */
export function tryDecryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  try {
    return decryptSecret(encoded);
  } catch {
    return null;
  }
}

/** Mascara uma senha pra exibição segura (•••• com últimos 2 chars opcionais). */
export function maskSecret(plaintext: string, showLast = 0): string {
  if (!plaintext) return "";
  const len = plaintext.length;
  if (showLast <= 0 || len <= showLast) return "•".repeat(Math.min(len, 12));
  return "•".repeat(Math.min(len - showLast, 10)) + plaintext.slice(-showLast);
}
