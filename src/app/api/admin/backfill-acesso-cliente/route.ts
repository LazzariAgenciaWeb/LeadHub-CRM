import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Backfill idempotente: liga o acesso ao sistema nas empresas já cadastradas.
 *
 * Em 2026-08-26 `hasSystemAccess`/`fullSystemAccess` viraram default `true` —
 * liberar cliente deixou de ser um par de toggles a lembrar; quem limita o que
 * ele vê lá dentro é o plano. O deploy roda `prisma db push`, que aplica o novo
 * default mas NÃO mexe nas linhas existentes: sem este backfill, todo cliente
 * cadastrado antes continuaria preso ao Meu Espaço.
 *
 * Roda no BOOT do container (start.sh). Seguro repetir: só toca em quem está
 * com o campo `false`.
 *
 * Protegido por CRON_SECRET, igual aos demais jobs internos.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  const [espaco, sistema] = await Promise.all([
    prisma.company.updateMany({ where: { hasSystemAccess: false }, data: { hasSystemAccess: true } }),
    prisma.company.updateMany({ where: { fullSystemAccess: false }, data: { fullSystemAccess: true } }),
  ]);

  return NextResponse.json({
    ok: true,
    hasSystemAccessLigado: espaco.count,
    fullSystemAccessLigado: sistema.count,
  });
}
