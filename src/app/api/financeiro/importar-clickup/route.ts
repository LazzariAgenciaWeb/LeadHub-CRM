import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import {
  LISTA_CONTRATOS_PADRAO,
  analisarImportacao,
  aplicarImportacao,
  fetchContratos,
} from "@/lib/clickup-contratos";

// A lista tem centenas de tasks e o ClickUp pagina de 100 em 100.
export const maxDuration = 120;

// POST /api/financeiro/importar-clickup
// Body: { listId?, incluirEncerrados?, apply? }
//
// Sem `apply` é PRÉVIA: lê o ClickUp, monta o relatório e não grava nada.
// A prévia existe porque casar cliente por nome erra, e errar aqui cria
// empresa duplicada na carteira — mais fácil conferir antes do que desfazer.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const agencyId = (session.user as any)?.companyId as string | undefined;
  if (!agencyId) {
    return NextResponse.json(
      { error: "Esta sessão não está vinculada a uma empresa. Entre como a agência dona da carteira." },
      { status: 400 }
    );
  }

  const token = (
    await prisma.setting.findUnique({ where: { key: `clickup_api_token:${agencyId}` } })
  )?.value?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "Token do ClickUp não configurado para esta empresa (Configurações → Integrações)." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const listId = String(body?.listId ?? "").trim() || LISTA_CONTRATOS_PADRAO;
  const incluirEncerrados = body?.incluirEncerrados === true;
  const apply = body?.apply === true;

  let tasks;
  try {
    tasks = await fetchContratos(token, listId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const relatorio = await analisarImportacao(agencyId, tasks, incluirEncerrados);

  /**
   * `notes` carrega o descritivo, as anotações E o texto inteiro da task do
   * ClickUp. Multiplicado por centenas de contratos vira uma resposta de
   * megabytes que a tela nem usa — ela mostra cliente, valor, dia e ciclo.
   * O dado completo continua sendo gravado; só não trafega.
   */
  const paraTela = {
    ...relatorio,
    itens: relatorio.itens.map((i) => ({
      taskId: i.taskId,
      codigo: i.codigo,
      taskUrl: i.taskUrl,
      cliente: i.cliente,
      label: i.label,
      amountCents: i.amountCents,
      billingCycle: i.billingCycle,
      billingDay: i.billingDay,
      categoria: i.categoria,
    })),
  };

  if (!apply) return NextResponse.json({ aplicado: false, relatorio: paraTela });

  const resultado = await aplicarImportacao(agencyId, relatorio.itens);
  return NextResponse.json({ aplicado: true, resultado, relatorio: paraTela });
}
