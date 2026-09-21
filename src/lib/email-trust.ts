/**
 * Remetente confiável (whitelist) — regra única pro ingest, triagem e ações.
 *
 * Regra de produto: remetente CONFIÁVEL (regra ALLOW, por email exato ou
 * @domínio) nunca é marcado como golpe nem cai na gaveta Descarte — nem pela
 * heurística do ingest, nem pela triagem IA.
 *
 * O que NÃO desliga: o aviso de anexo executável e de link disfarçado no
 * leitor (calculado na tela, com confirmação no clique). Conta de fornecedor
 * invadida é vetor real — confiar no remetente não pode apagar esse último
 * degrau de proteção.
 */
import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma";

/** Chaves de regra que podem casar com o remetente: email exato + cada sufixo de domínio. */
export function senderRuleCandidates(fromEmail: string): string[] {
  const email = fromEmail.toLowerCase();
  const parts = (email.split("@")[1] ?? "").split(".");
  const out = [email];
  // e.ultrasul1.com → "@e.ultrasul1.com", "@ultrasul1.com"
  for (let i = 0; i <= parts.length - 2; i++) out.push(`@${parts.slice(i).join(".")}`);
  return out;
}

/** Qual regra vale: email exato > domínio mais específico (mais longo). */
export function pickSenderRule<T extends { fromEmail: string }>(rules: T[], fromEmail: string): T | null {
  const exact = rules.find((r) => r.fromEmail === fromEmail.toLowerCase());
  if (exact) return exact;
  return (
    rules
      .filter((r) => r.fromEmail.startsWith("@"))
      .sort((a, b) => b.fromEmail.length - a.fromEmail.length)[0] ?? null
  );
}

/** Carrega as regras da empresa uma vez e devolve "este remetente é confiável?". */
export async function loadTrustMatcher(companyId: string): Promise<(fromEmail: string) => boolean> {
  const rules = await prisma.inboxSenderRule.findMany({
    where: { companyId },
    select: { fromEmail: true, type: true },
  });
  const byKey = new Map(rules.map((r) => [r.fromEmail, r]));
  return (fromEmail: string) => {
    if (!fromEmail) return false;
    const matched = senderRuleCandidates(fromEmail)
      .map((k) => byKey.get(k))
      .filter((r): r is (typeof rules)[number] => !!r);
    return pickSenderRule(matched, fromEmail)?.type === "ALLOW";
  };
}

/**
 * Aplica a confiança nos emails JÁ recebidos dos remetentes que casam com
 * `senderWhere`: tira o alerta de golpe, tira de Descarte (BAIXA → NORMAL) e
 * devolve do Spam pra Entrada. Correção manual (`aiLocked`) é respeitada: se
 * o usuário mandou um email específico pra Descarte, a confiança no
 * remetente não desfaz isso.
 */
export async function applyTrust(companyId: string, senderWhere: Prisma.InboxEmailWhereInput) {
  // AND: senderWhere de domínio usa OR (email e subdomínios) e não pode colidir.
  const base: Prisma.InboxEmailWhereInput = { companyId, direction: "IN", AND: [senderWhere] };
  const [unflagged, promoted, restored] = await prisma.$transaction([
    prisma.inboxEmail.updateMany({
      where: { ...base, suspicious: true },
      data: { suspicious: false, suspiciousReasons: [] },
    }),
    prisma.inboxEmail.updateMany({
      where: { ...base, aiImportance: "BAIXA", aiLocked: false },
      data: { aiImportance: "NORMAL" },
    }),
    prisma.inboxEmail.updateMany({
      where: { ...base, folder: "SPAM" },
      data: { folder: "INBOX" },
    }),
  ]);
  return { unflagged: unflagged.count, promoted: promoted.count, restored: restored.count };
}
