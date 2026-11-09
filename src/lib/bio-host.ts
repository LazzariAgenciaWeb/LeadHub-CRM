/**
 * Que host é este? Separa os endereços do próprio sistema (painel, gohub.com.br)
 * dos domínios que os clientes apontaram para a Página do Negócio.
 *
 * Fica num módulo próprio porque o `proxy.ts` também usa: lá não pode entrar
 * nada que puxe banco — a decisão tem que sair de string e variável de ambiente.
 */

import { BIO_SYSTEM_HOSTS } from "@/lib/bio-page";

/** "WWW.Loja.com.br:443" → "www.loja.com.br". */
export function cleanHost(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function envHost(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    return cleanHost(new URL(v.includes("://") ? v : `https://${v}`).hostname);
  } catch {
    return null;
  }
}

/**
 * Endereços em que o SISTEMA responde (painel, cadastro, páginas em /p/slug).
 * Tudo o que não está aqui é candidato a domínio de cliente.
 */
export function systemHosts(): string[] {
  const fromEnv = [
    envHost(process.env.NEXT_PUBLIC_BASE_URL),
    envHost(process.env.NEXTAUTH_URL),
    envHost(process.env.BIO_PUBLIC_BASE_URL),
  ].filter((h): h is string => !!h);
  return [...new Set([...BIO_SYSTEM_HOSTS, ...fromEnv, "127.0.0.1", "::1"])];
}

/** Host do painel/sistema (inclui IP puro e localhost). */
export function isSystemHost(raw: string | null | undefined): boolean {
  const host = cleanHost(raw);
  if (!host) return true; // sem Host não há domínio de cliente a servir
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return true;
  return systemHosts().some((h) => host === h || host.endsWith(`.${h}`));
}

/** Host que pode ser um domínio de cliente (ainda não diz se existe no banco). */
export function customHostCandidate(raw: string | null | undefined): string | null {
  const host = cleanHost(raw);
  return host && !isSystemHost(host) ? host : null;
}
