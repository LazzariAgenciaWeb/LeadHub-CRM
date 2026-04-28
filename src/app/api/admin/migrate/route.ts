import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/migrate
 * Aplica migrações pendentes via SQL raw. Apenas SUPER_ADMIN.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const userRole = (session.user as any).role;
  if (userRole !== "SUPER_ADMIN") return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });

  const results: Record<string, string> = {};

  // Adicionar coluna instanceToken na tabela WhatsappInstance (se não existir)
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "WhatsappInstance" ADD COLUMN IF NOT EXISTS "instanceToken" TEXT;`
    );
    results.instanceToken = "✓ Coluna instanceToken adicionada (ou já existia)";
  } catch (e: any) {
    results.instanceToken = `✗ Erro: ${e.message}`;
  }

  // Backfill: popular CompanyContact com nomes de Leads existentes
  // Garante que contatos nomeados apareçam nas buscas e tenham telefone formatado na inbox
  try {
    const namedLeads = await prisma.lead.findMany({
      where: { name: { not: null } },
      select: { phone: true, name: true, companyId: true },
      orderBy: { createdAt: "asc" }, // mais antigos primeiro → mais recentes sobrescrevem
    });

    let created = 0;
    let updated = 0;

    for (const lead of namedLeads) {
      if (!lead.name || lead.phone.includes("@g.us") || lead.phone.includes("@lid")) continue;

      const existing = await prisma.companyContact.findUnique({
        where: { companyId_phone: { companyId: lead.companyId, phone: lead.phone } },
        select: { id: true, name: true },
      });

      if (!existing) {
        await prisma.companyContact.create({
          data: { phone: lead.phone, name: lead.name, isGroup: false, companyId: lead.companyId },
        }).catch(() => {}); // ignora race condition
        created++;
      } else if (!existing.name) {
        await prisma.companyContact.update({
          where: { id: existing.id },
          data: { name: lead.name },
        });
        updated++;
      }
      // Se já tem nome → respeitar o nome existente (pode ter sido customizado)
    }

    results.backfillContacts = `✓ Backfill de nomes: ${created} criados, ${updated} atualizados (de ${namedLeads.length} leads com nome)`;
  } catch (e: any) {
    results.backfillContacts = `✗ Erro no backfill: ${e.message}`;
  }

  return NextResponse.json({ ok: true, results });
}
