// Backfill: copia ConversationNote existentes que ainda não estão em Lead.notes
//
// Uso:
//   node scripts/backfill-conversation-notes.mjs --check
//   node scripts/backfill-conversation-notes.mjs --apply
//
// Por que existe: até o commit b17c883, POST /api/conversations/[id]/notes
// salvava em ConversationNote + Activity, mas NÃO appendava em Lead.notes
// (campo legado que o chat do WhatsApp parseia). Notas de transferência
// e outras criadas via API ficaram invisíveis no chat.
//
// Idempotente: detecta entries já presentes em Lead.notes pelo body+autor
// e pula. Rodar duas vezes não duplica.
import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtStamp(d) {
  // "DD/MM/AA HH:MM" no timezone do servidor — bate com formatBrazilDateTimeShort
  // quando TZ=America/Sao_Paulo. Em UTC dá um shift mas o parser ignora data
  // pra ordenação principal (usa createdAt da Activity quando disponível).
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${pad2(d.getFullYear() % 100)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const notes = await prisma.conversationNote.findMany({
  orderBy: { createdAt: "asc" },
  select: { id: true, conversationId: true, body: true, authorName: true, createdAt: true, type: true },
});
console.log(`Total ConversationNote encontradas: ${notes.length}`);

// Indexa leads por conversationId
const conversationIds = [...new Set(notes.map((n) => n.conversationId))];
const leads = await prisma.lead.findMany({
  where: { conversationId: { in: conversationIds } },
  select: { id: true, conversationId: true, notes: true },
});
const leadByConv = new Map(leads.map((l) => [l.conversationId, l]));
console.log(`Leads vinculados encontrados: ${leads.length} (de ${conversationIds.length} conversas)`);

let alreadyIn = 0, missingLead = 0, scheduled = 0, toBackfill = 0, applied = 0;
const updates = new Map(); // leadId -> { current, append: [] }

for (const n of notes) {
  // Notas tipo SCHEDULED já são appendadas pelo leads PATCH com formato "📅 ..."
  // — pulamos pra não duplicar bolhas roxas.
  if (n.type === "SCHEDULED") { scheduled++; continue; }

  const lead = leadByConv.get(n.conversationId);
  if (!lead) { missingLead++; continue; }

  const body = n.body.trim();
  const author = (n.authorName ?? "Usuário").trim();
  // Detecta "já está em notes" — busca pelo body simples (com ou sem stamp/autor).
  // Conservador: se o body inteiro aparece como substring, considera já registrado.
  const current = updates.get(lead.id)?.current ?? lead.notes ?? "";
  if (current.includes(body)) { alreadyIn++; continue; }

  const stamp = fmtStamp(n.createdAt);
  const entry = `[${stamp}] ${body} — ${author}`;
  const next = current ? `${entry}\n\n${current}` : entry;
  updates.set(lead.id, { current: next, count: (updates.get(lead.id)?.count ?? 0) + 1 });
  toBackfill++;
}

console.log("");
console.log(`Pulou (SCHEDULED já registrado pelo leads PATCH): ${scheduled}`);
console.log(`Pulou (sem Lead vinculado à conversa)            : ${missingLead}`);
console.log(`Pulou (já presente em Lead.notes)                : ${alreadyIn}`);
console.log(`Pra backfill                                      : ${toBackfill}`);
console.log(`Leads afetados                                    : ${updates.size}`);

if (!apply) {
  console.log("\n(modo --check) Nada foi alterado. Rode com --apply pra escrever.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\nAplicando…");
for (const [leadId, { current }] of updates) {
  await prisma.lead.update({ where: { id: leadId }, data: { notes: current } });
  applied++;
}
console.log(`✅ Atualizados ${applied} leads.`);
await prisma.$disconnect();
