import { prisma } from "./prisma";

/**
 * IPs internos da agência — pra não contar o acesso da equipe como "cliente
 * viu" no link de aprovação. Aprendidos sozinhos: toda vez que alguém da
 * agência usa o LeadHub, o IP da rede dele entra na lista (ver layout do admin).
 */

const TTL_MS = 30 * 86_400_000; // IP sem uso da equipe há 30 dias deixa de ser interno
const TOUCH_MS = 60 * 60_000;   // atualiza lastSeenAt no máximo 1x/hora por IP

/** IP do visitante atrás do proxy (Traefik/Portainer) — 1º do x-forwarded-for. */
export function clientIp(h: Headers): string | null {
  const ip =
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    null;
  return ip ? ip.replace(/^::ffff:/, "").slice(0, 64) : null;
}

/** Registra o IP como da equipe. companyId null = plataforma (SUPER_ADMIN). */
export async function learnInternalIp(companyId: string | null, ip: string | null, userId?: string | null) {
  if (!ip) return;
  const key = { companyId: companyId ?? "", ip };
  try {
    const cur = await prisma.internalIp.findUnique({ where: { companyId_ip: key }, select: { lastSeenAt: true } });
    if (cur && Date.now() - cur.lastSeenAt.getTime() < TOUCH_MS) return;
    await prisma.internalIp.upsert({
      where:  { companyId_ip: key },
      create: { ...key, userId: userId ?? null },
      update: { lastSeenAt: new Date(), userId: userId ?? null },
    });
  } catch { /* nunca atrapalha a navegação */ }
}

/** IP é da equipe desta agência (ou da plataforma)? */
export async function isInternalIp(agencyCompanyId: string, ip: string | null): Promise<boolean> {
  if (!ip) return false;
  const hit = await prisma.internalIp.findFirst({
    where: { ip, companyId: { in: [agencyCompanyId, ""] }, lastSeenAt: { gte: new Date(Date.now() - TTL_MS) } },
    select: { id: true },
  });
  return !!hit;
}
