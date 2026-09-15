/**
 * Redatar a entrega de uma venda move a bonificação junto.
 *
 * O lançamento de bonificação guarda a própria competência (`month`), gravada
 * no dia em que foi lançado. Corrigir só `Sale.deliveredAt` deixaria o
 * lançamento preso no mês errado: a venda sairia da lista do mês antigo, mas o
 * valor continuaria somando lá.
 *
 * Só move o que NÃO foi pago. Bonificação paga é registro de dinheiro que já
 * saiu naquele fechamento — reescrever o mês dela apagaria o histórico.
 */

import { prisma } from "./prisma";

export interface ResultadoRedatacao {
  movidos: number;
  pagosMantidos: number;
  /** Nomes que não foram movidos por já terem lançamento desta venda no mês novo. */
  conflitos: string[];
}

const competencia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** `undefined` quando a competência não mudou — não há o que mover. */
export async function moverBonificacaoDaVenda(
  saleId: string,
  entregaAntes: Date | null,
  entregaDepois: Date
): Promise<ResultadoRedatacao | undefined> {
  if (!entregaAntes) return undefined;
  const mesAntigo = competencia(entregaAntes);
  const mesNovo = competencia(entregaDepois);
  if (mesAntigo === mesNovo) return undefined;

  const doMesAntigo = await prisma.bonus.findMany({
    where: { saleId, month: mesAntigo },
    select: { id: true, userId: true, name: true, paidAt: true },
  });

  const r: ResultadoRedatacao = { movidos: 0, pagosMantidos: 0, conflitos: [] };
  for (const b of doMesAntigo) {
    if (b.paidAt) { r.pagosMantidos++; continue; }
    // Mesma trava anti-duplicidade da API de bonificação: a mesma pessoa não
    // pode ter dois lançamentos desta venda na mesma competência.
    const jaExiste = await prisma.bonus.findFirst({
      where: { saleId, month: mesNovo, ...(b.userId ? { userId: b.userId } : { name: b.name }) },
      select: { id: true },
    });
    if (jaExiste) { r.conflitos.push(b.name); continue; }
    await prisma.bonus.update({ where: { id: b.id }, data: { month: mesNovo } });
    r.movidos++;
  }
  return r;
}

export { competencia };
