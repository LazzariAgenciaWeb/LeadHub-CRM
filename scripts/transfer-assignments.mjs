// Uso:
//   node scripts/transfer-assignments.mjs --check
//   node scripts/transfer-assignments.mjs --apply
//
// Transfere registros atribuídos ao SUPER_ADMIN (diego@lazzari.net.br) pra
// o ADMIN da AZZ Agência (diego@azzagencia.com.br) — mesmo Diego, contas
// separadas. Idempotente: rodar duas vezes não dobra nada.
import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const SUPER_EMAIL = "diego@lazzari.net.br";
const ADMIN_EMAIL = "diego@azzagencia.com.br";
const apply = process.argv.includes("--apply");

const [sup, adm] = await Promise.all([
  prisma.user.findUnique({ where: { email: SUPER_EMAIL } }),
  prisma.user.findUnique({ where: { email: ADMIN_EMAIL } }),
]);
if (!sup || !adm) {
  console.error("Falha: usuário origem ou alvo não encontrado");
  console.error("  super:", sup);
  console.error("  admin:", adm);
  process.exit(1);
}
console.log(`SUPER_ADMIN: ${sup.name} <${sup.email}> id=${sup.id} role=${sup.role}`);
console.log(`ADMIN AZZ:   ${adm.name} <${adm.email}> id=${adm.id} role=${adm.role} companyId=${adm.companyId}`);
console.log("");

const [convs, ticketsA, ticketsC, acts] = await Promise.all([
  prisma.conversation.count({ where: { assigneeId: sup.id } }),
  prisma.ticket.count({ where: { assigneeId: sup.id } }),
  prisma.ticket.count({ where: { createdById: sup.id } }),
  prisma.activity.count({ where: { authorId: sup.id } }),
]);
console.log("Atribuído ao SUPER_ADMIN hoje:");
console.log(`  Conversations.assigneeId : ${convs}`);
console.log(`  Tickets.assigneeId       : ${ticketsA}`);
console.log(`  Tickets.createdById      : ${ticketsC}`);
console.log(`  Activities.authorId      : ${acts}`);

if (!apply) {
  console.log("\n(modo --check) Nada foi alterado. Rode com --apply pra transferir.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\nAplicando transferência…");
const result = await prisma.$transaction([
  prisma.conversation.updateMany({ where: { assigneeId: sup.id }, data: { assigneeId: adm.id } }),
  prisma.ticket.updateMany({ where: { assigneeId: sup.id }, data: { assigneeId: adm.id } }),
  prisma.ticket.updateMany({ where: { createdById: sup.id }, data: { createdById: adm.id } }),
  prisma.activity.updateMany({ where: { authorId: sup.id }, data: { authorId: adm.id, authorName: adm.name } }),
]);
console.log("✅ Transferido:");
console.log(`  Conversations: ${result[0].count}`);
console.log(`  Tickets (assignee): ${result[1].count}`);
console.log(`  Tickets (createdBy): ${result[2].count}`);
console.log(`  Activities: ${result[3].count}`);
await prisma.$disconnect();
