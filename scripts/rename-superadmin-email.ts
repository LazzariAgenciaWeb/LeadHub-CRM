/**
 * Troca o e-mail de login do super admin JÁ EXISTENTE no banco.
 *
 * O seed (prisma/seed.ts) só cria o usuário quando ele ainda não existe — então
 * mudar o default de lá não renomeia quem já está no banco. Este script faz isso.
 *
 * Rodar UMA vez (idempotente — se já estiver com o e-mail novo, não faz nada):
 *   npx tsx scripts/rename-superadmin-email.ts
 *
 * Pra usar outros valores:
 *   OLD_EMAIL="a@b.com" NEW_EMAIL="c@d.com" npx tsx scripts/rename-superadmin-email.ts
 *
 * A SENHA NÃO MUDA — depois de rodar, faça login com o e-mail novo e a senha atual.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

const OLD = (process.env.OLD_EMAIL ?? "admin@leadhub.com").trim().toLowerCase();
const NEW = (process.env.NEW_EMAIL ?? "adm@azzagencia.com.br").trim().toLowerCase();

async function main() {
  if (OLD === NEW) {
    console.log("E-mail antigo e novo são iguais. Nada a fazer.");
    return;
  }

  const target = await prisma.user.findUnique({
    where: { email: OLD },
    select: { id: true, name: true, role: true },
  });

  if (!target) {
    const already = await prisma.user.findUnique({
      where: { email: NEW },
      select: { id: true, role: true },
    });
    if (already) {
      console.log(`✅ Nada a fazer — já existe usuário com ${NEW} (role ${already.role}).`);
    } else {
      console.log(`⚠️  Nenhum usuário com ${OLD}. Nada alterado.`);
      console.log("    Confira o e-mail atual do super admin e rode de novo com OLD_EMAIL=...");
    }
    return;
  }

  // Trava de segurança: não sobrescreve outro usuário que já use o e-mail novo.
  const collision = await prisma.user.findUnique({ where: { email: NEW }, select: { id: true } });
  if (collision && collision.id !== target.id) {
    console.error(`❌ ABORTADO: já existe OUTRO usuário com ${NEW} (id ${collision.id}).`);
    process.exit(1);
  }

  await prisma.user.update({ where: { id: target.id }, data: { email: NEW } });

  console.log(`✅ E-mail atualizado: ${OLD} → ${NEW}`);
  console.log(`   Usuário: ${target.name} (role ${target.role})`);
  console.log("   A senha continua a mesma — faça login com o e-mail novo.");
}

main()
  .catch((e) => {
    console.error("❌ Erro:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
