import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanyPlan } from "@/lib/limits";
import { PLANS } from "@/lib/plans";

/**
 * Backfill idempotente: alinha `Company.modoAtendimento` ao default do plano.
 *
 * O modo virou cache derivado do plano (como `Company.module*`), mas por um
 * tempo ele também era editável à mão no cadastro da empresa — e essa edição
 * NUNCA salvava: o PATCH lia o campo do corpo e não o gravava. Resultado:
 * empresa cujo plano dá Caixa de Entrada completa continuava presa em VISAO,
 * e o cliente não conseguia enviar mensagem pelo painel.
 *
 * A aplicação no salvar da assinatura só acontecia quando o PLANO mudava, então
 * ninguém se desprendia do estado antigo sem trocar de plano. Este backfill
 * corrige a base existente no boot do container (start.sh).
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

  const companies = await prisma.company.findMany({
    select: { id: true, name: true, modoAtendimento: true },
  });

  const ajustadas: { nome: string; de: string; para: string }[] = [];
  for (const c of companies) {
    let esperado: "VISAO" | "ATENDE";
    try {
      const ctx = await getCompanyPlan(c.id);
      esperado = PLANS[ctx.tier].modoAtendimentoDefault;
    } catch {
      continue; // empresa sem contexto de plano resolvível — deixa como está
    }
    if (esperado !== c.modoAtendimento) {
      await prisma.company.update({ where: { id: c.id }, data: { modoAtendimento: esperado } });
      ajustadas.push({ nome: c.name, de: c.modoAtendimento, para: esperado });
    }
  }

  return NextResponse.json({ ok: true, total: companies.length, ajustadas });
}
