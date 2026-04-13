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

  return NextResponse.json({ ok: true, results });
}
