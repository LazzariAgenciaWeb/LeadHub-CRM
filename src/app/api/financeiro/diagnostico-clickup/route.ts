import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { LISTA_CONTRATOS_PADRAO, fetchContratos, statusNome } from "@/lib/clickup-contratos";

/**
 * Sonda de leitura do ClickUp — abre no navegador e devolve JSON pequeno.
 *
 * POR QUE EXISTE
 * A prévia falhava sem deixar rastro: o navegador só dizia "This page couldn't
 * load", que serve pra qualquer coisa. Esta rota isola UMA pergunta: a leitura
 * do ClickUp termina, e em quanto tempo? Se responder, o problema está depois
 * dela. Se morrer igual, está nela. Não grava nada.
 *
 * GET /api/financeiro/diagnostico-clickup[?lista=...&fechadas=1]
 */
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const agencyId = (session.user as any)?.companyId as string | undefined;
  if (!agencyId) return NextResponse.json({ error: "Sessão sem empresa vinculada" }, { status: 400 });

  const token = (
    await prisma.setting.findUnique({ where: { key: `clickup_api_token:${agencyId}` } })
  )?.value?.trim();
  if (!token) return NextResponse.json({ error: "Token do ClickUp não configurado" }, { status: 400 });

  const listId = req.nextUrl.searchParams.get("lista")?.trim() || LISTA_CONTRATOS_PADRAO;
  const fechadas = req.nextUrl.searchParams.get("fechadas") === "1";

  const t0 = Date.now();
  try {
    const tasks = await fetchContratos(token, listId, fechadas);
    const porStatus: Record<string, number> = {};
    for (const t of tasks) {
      const nome = statusNome(t) || "(sem status)";
      porStatus[nome] = (porStatus[nome] ?? 0) + 1;
    }
    return NextResponse.json({
      ok: true,
      lista: listId,
      incluindoFechadas: fechadas,
      tasks: tasks.length,
      tempoMs: Date.now() - t0,
      porStatus,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, lista: listId, tempoMs: Date.now() - t0, erro: (e as Error).message },
      { status: 200 } // 200 de propósito: o navegador mostra o JSON em vez de página de erro
    );
  }
}
