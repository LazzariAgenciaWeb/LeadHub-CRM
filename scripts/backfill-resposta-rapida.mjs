// Uso:
//   node scripts/backfill-resposta-rapida.mjs --check
//   node scripts/backfill-resposta-rapida.mjs --apply
//   node scripts/backfill-resposta-rapida.mjs --apply --company=<companyId>
//
// Cria ScoreEvents retroativos de RESPOSTA_RAPIDA_5MIN/_30MIN pra conversas
// que tiveram primeira resposta dentro da janela. Idempotente — pode rodar
// quantas vezes precisar. Crédito vai pro assigneeId atual da conversa
// (skip se null ou SUPER_ADMIN).
//
// Sem --company: detecta a AZZ via diego@azzagencia.com.br.
//
// Backdata o ScoreEvent pra createdAt = firstResponseAt e atualiza o
// UserScore do mês/ano DA ÉPOCA em que aconteceu — não infla o mês atual.
import { PrismaClient } from "../src/generated/prisma/index.js";
import {
  businessMinutesBetweenWithConfig,
  loadCompanyHours,
} from "../src/lib/business-hours.ts";
import { SCORE_TABLE } from "../src/lib/gamification.ts";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

// Resolve companyId
const companyArg = process.argv.find((a) => a.startsWith("--company="));
let companyId = companyArg ? companyArg.split("=")[1] : null;
if (!companyId) {
  const adm = await prisma.user.findUnique({
    where: { email: "diego@azzagencia.com.br" },
    select: { companyId: true },
  });
  if (!adm?.companyId) {
    console.error("Não achei AZZ via diego@azzagencia.com.br — passe --company=<id>");
    process.exit(1);
  }
  companyId = adm.companyId;
}

const company = await prisma.company.findUnique({
  where: { id: companyId },
  select: { id: true, name: true },
});
if (!company) {
  console.error(`Empresa ${companyId} não encontrada`);
  process.exit(1);
}

console.log(`Empresa: ${company.name} (id=${company.id})`);
console.log(`Modo:    ${apply ? "APPLY (cria eventos)" : "DRY-RUN (só conta)"}`);
console.log("");

const hours = await loadCompanyHours(companyId);

const convs = await prisma.conversation.findMany({
  where: { companyId },
  select: {
    id: true, createdAt: true, firstResponseAt: true, phone: true,
    assignee: { select: { id: true, role: true, name: true } },
  },
});

const hits = [];
let scanned = 0;
let skNoResp = 0, skNoAssg = 0, skSuper = 0, skSlow = 0, skDup = 0;

for (const conv of convs) {
  scanned++;

  let firstTs = conv.firstResponseAt;
  if (!firstTs) {
    const firstOut = await prisma.message.findFirst({
      where: { conversationId: conv.id, direction: "OUTBOUND" },
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true },
    });
    if (firstOut) firstTs = firstOut.receivedAt;
  }
  if (!firstTs) { skNoResp++; continue; }
  if (!conv.assignee) { skNoAssg++; continue; }
  if (conv.assignee.role === "SUPER_ADMIN") { skSuper++; continue; }

  const minutes = businessMinutesBetweenWithConfig(conv.createdAt, firstTs, hours);
  let reason = null;
  if (minutes <= 5)        reason = "RESPOSTA_RAPIDA_5MIN";
  else if (minutes <= 30)  reason = "RESPOSTA_RAPIDA_30MIN";
  else                     { skSlow++; continue; }

  const exists = await prisma.scoreEvent.findFirst({
    where: { userId: conv.assignee.id, reason, referenceId: conv.id },
    select: { id: true },
  });
  if (exists) { skDup++; continue; }

  hits.push({
    convId:    conv.id,
    phone:     conv.phone,
    userId:    conv.assignee.id,
    userName:  conv.assignee.name,
    minutes,
    reason,
    points:    SCORE_TABLE[reason],
    eventDate: firstTs,
  });
}

const total5  = hits.filter((h) => h.reason === "RESPOSTA_RAPIDA_5MIN").length;
const total30 = hits.filter((h) => h.reason === "RESPOSTA_RAPIDA_30MIN").length;
const totalPts = hits.reduce((acc, h) => acc + h.points, 0);

console.log(`Conversas escaneadas: ${scanned}`);
console.log(`Skip — sem resposta:        ${skNoResp}`);
console.log(`Skip — sem assignee:        ${skNoAssg}`);
console.log(`Skip — assignee SUPER:      ${skSuper}`);
console.log(`Skip — resposta > 30min:    ${skSlow}`);
console.log(`Skip — já tem ScoreEvent:   ${skDup}`);
console.log("");
console.log(`Hits totais:        ${hits.length}`);
console.log(`  RESPOSTA_RAPIDA_5MIN:  ${total5} (×10 pts)`);
console.log(`  RESPOSTA_RAPIDA_30MIN: ${total30} (×5 pts)`);
console.log(`  Pontos a creditar:     ${totalPts}`);
console.log("");

if (hits.length > 0) {
  console.log("Amostra (10 primeiros):");
  for (const h of hits.slice(0, 10)) {
    console.log(`  ${h.eventDate.toISOString().slice(0, 16)} | ${h.userName.padEnd(20)} | ${h.minutes.toString().padStart(3)}min → ${h.reason} (+${h.points})`);
  }
  console.log("");
}

if (!apply) {
  console.log("Dry-run — nada gravado. Rode com --apply pra aplicar.");
  await prisma.$disconnect();
  process.exit(0);
}

let created = 0;
for (const h of hits) {
  const month = h.eventDate.getMonth() + 1;
  const year  = h.eventDate.getFullYear();
  await prisma.$transaction([
    prisma.scoreEvent.create({
      data: {
        userId:      h.userId,
        companyId,
        points:      h.points,
        reason:      h.reason,
        referenceId: h.convId,
        createdAt:   h.eventDate,
      },
    }),
    prisma.userScore.upsert({
      where:  { userId_month_year: { userId: h.userId, month, year } },
      create: {
        userId:           h.userId,
        companyId,
        month,
        year,
        monthPoints:      h.points,
        totalPoints:      h.points,
        redeemablePoints: h.points,
      },
      update: {
        monthPoints:      { increment: h.points },
        totalPoints:      { increment: h.points },
        redeemablePoints: { increment: h.points },
      },
    }),
  ]);
  created++;
}
console.log(`Criados: ${created} ScoreEvents`);
await prisma.$disconnect();
