import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@leadhub.com";
  const password = process.env.ADMIN_PASSWORD ?? "leadhub123";
  const name = process.env.ADMIN_NAME ?? "Diego Lazzari";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`✅ Super admin já existe: ${email}`);
    return;
  }

  const hashed = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      name,
      email,
      password: hashed,
      role: "SUPER_ADMIN",
    },
  });

  console.log(`✅ Super admin criado!`);
  console.log(`   Email: ${email}`);
  console.log(`   Senha: ${password}`);
  console.log(`\n⚠️  Troque a senha após o primeiro login.`);
}

main()
  .catch((e) => {
    console.error("❌ Erro no seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
