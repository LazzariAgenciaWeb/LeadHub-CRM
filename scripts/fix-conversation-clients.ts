/**
 * Correção em lote do cliente das conversas do WhatsApp (ver
 * src/lib/conversation-client.ts). Simulação por padrão — só lista.
 *
 * Uso:
 *   npx tsx scripts/fix-conversation-clients.ts                    # simula, todas as agências
 *   npx tsx scripts/fix-conversation-clients.ts --agency=<id>      # simula, uma agência
 *   npx tsx scripts/fix-conversation-clients.ts --agency=<id> --apply
 *     [--skip=<convId|telefone>,...]  pula linhas da simulação
 *     [--only-strong]                 não grava as "?" (só nome parcial)
 *
 * Em produção dá pra rodar o mesmo pelo navegador (logado como super admin):
 *   GET /api/admin/fix-conversation-clients?companyId=<id>   (simulação)
 */
import { prisma } from "@/lib/prisma";
import { applyConversationClientFix, formatPlan, planConversationClientFix } from "@/lib/conversation-client";

const APPLY = process.argv.includes("--apply");
const skip = (process.argv.find((a) => a.startsWith("--skip="))?.split("=")[1] ?? "").split(",").filter(Boolean);
const onlyStrong = process.argv.includes("--only-strong");
const agencyArg = process.argv.find((a) => a.startsWith("--agency="))?.split("=")[1] ?? null;

async function main() {
  const ids = agencyArg
    ? [agencyArg]
    : (await prisma.company.findMany({ where: { subCompanies: { some: {} } }, select: { id: true } })).map((c) => c.id);
  console.log(APPLY ? "GRAVANDO.\n" : "SIMULAÇÃO — nada será gravado (use --apply).\n");
  for (const id of ids) {
    const plan = await planConversationClientFix(id);
    console.log(formatPlan(plan.agency, plan.rows, plan.alreadyLinked));
    if (APPLY) {
      const r = await applyConversationClientFix(id, plan.rows, { skip, onlyStrong });
      console.log(`  ✓ ${r.linked} conversa(s) ligadas.\n`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
